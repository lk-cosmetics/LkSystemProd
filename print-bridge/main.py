"""TP80BE thermal-printer bridge.

Local FastAPI service that prints receipts to the Windows printer "TP80BE"
(or whatever name is configured) using ESC/POS over the Win32 spooler.

This bridge is completely independent of the LED display bridge — different
port, different config file, different exe.

Endpoints (all POST require header ``X-Print-Token``):

    GET  /health           -> {ok, printer_name, available}
    GET  /printers         -> list of installed Windows printers
    POST /print/test       -> prints a self-test ticket and cuts
    POST /print/receipt    -> prints a receipt from a JSON payload
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from textwrap import wrap as textwrap_wrap
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# python-escpos for ESC/POS rendering, win32print for spooler queries.
from escpos.printer import Win32Raw  # type: ignore
from PIL import Image, ImageOps  # type: ignore
import win32print  # type: ignore


# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [print-bridge] %(message)s",
)
log = logging.getLogger("print-bridge")


# ─── Config ──────────────────────────────────────────────────────────────────

DEFAULT_ORIGINS = [
    "*",
  
]


@dataclass(frozen=True)
class BridgeConfig:
    host: str = "127.0.0.1"
    port: int = 8788
    printer_name: str = "TP80BE"
    print_token: str = "change-me"
    paper_width_mm: int = 80
    printable_width_mm: int = 72
    chars_per_line: int = 48
    logo_path: str = ""
    logo_width_px: int = 384
    cash_register: str = "01"
    allowed_origins: list[str] = field(default_factory=lambda: list(DEFAULT_ORIGINS))


def _app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _coerce_origins(value: Any) -> list[str]:
    if value is None:
        return list(DEFAULT_ORIGINS)
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return list(DEFAULT_ORIGINS)


def load_config() -> BridgeConfig:
    cfg_path = _app_dir() / "config.json"
    raw: dict[str, Any] = {}
    if cfg_path.exists():
        try:
            raw = json.loads(cfg_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("Could not read %s: %s — using defaults", cfg_path, exc)

    def pick(key: str, default: Any) -> Any:
        env = os.getenv(key.upper())
        if env not in (None, ""):
            return env
        if key in raw and raw[key] not in (None, ""):
            return raw[key]
        return default

    return BridgeConfig(
        host=str(pick("host", "127.0.0.1")),
        port=int(pick("port", 8788)),
        printer_name=str(pick("printer_name", "TP80BE")),
        print_token=str(pick("print_token", "change-me")),
        paper_width_mm=int(pick("paper_width_mm", 80)),
        printable_width_mm=int(pick("printable_width_mm", 72)),
        chars_per_line=int(pick("chars_per_line", 48)),
        logo_path=str(pick("logo_path", "")),
        logo_width_px=int(pick("logo_width_px", 384)),
        cash_register=str(pick("cash_register", "01")),
        allowed_origins=_coerce_origins(pick("allowed_origins", None)),
    )


config = load_config()


# ─── Spooler helpers ─────────────────────────────────────────────────────────


def list_windows_printers() -> list[dict[str, str]]:
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    return [
        {
            "name": p[2],
            "port": p[1] or "",
            "driver": p[3] or "",
        }
        for p in win32print.EnumPrinters(flags)
    ]


def printer_available(name: str) -> bool:
    try:
        return any(p["name"] == name for p in list_windows_printers())
    except Exception as exc:  # pragma: no cover — defensive
        log.warning("EnumPrinters failed: %s", exc)
        return False


# ─── Receipt rendering ───────────────────────────────────────────────────────


NAME_W = 42
QTY_W = 5
TOT_W = 12


def _money(n: float | int) -> str:
    return f"{float(n):.3f}"


def _money_fr(n: float | int) -> str:
    return _money(n).replace(".", ",")


def _qty(n: float | int) -> str:
    f = float(n)
    return str(int(f)) if f.is_integer() else f"{f:.2f}".rstrip("0").rstrip(".")


def _fit(text: str, width: int, *, align: str = "left") -> str:
    text = _safe_text(text)[:width]
    if align == "right":
        return text.rjust(width)
    if align == "center":
        return text.center(width)
    return text.ljust(width)


def _receipt_width() -> int:
    # Thermal printers often wrap earlier than their advertised 48 columns,
    # especially with font A. Keep the receipt compact and deterministic.
    return max(32, min(int(config.chars_per_line or 42), 42))


def _item_header(width: int) -> str:
    return f"{_fit('Article', width - TOT_W)}{_fit('Montant', TOT_W, align='right')}\n"


def _item_total_line(qty: str, total: str, width: int) -> str:
    label = f"  Qte: {qty}"
    total_w = max(TOT_W, width - len(label))
    return (
        f"{_fit(label, width - total_w)}"
        f"{_fit(total, total_w, align='right')}\n"
    )


def _print_item(p: Win32Raw, item: "ItemPayload", width: int) -> None:
    name_lines = _wrap_name(item.name, width)
    p.set(bold=True)
    for line in name_lines:
        p.text(_safe_text(line) + "\n")
    p.set(bold=False)
    p.text(_item_total_line(_qty(item.qty), _money_fr(item.total), width))


def _money_row(label: str, value: float, width: int = 48) -> str:
    right = _money_fr(value)
    pad = max(1, width - len(label) - len(right))
    return f"{label}{' ' * pad}{right}\n"


def _safe_text(text: str | None) -> str:
    """Keep French text printable on limited ESC/POS codepages."""
    if not text:
        return ""
    replacements = {
        "’": "'",
        "‘": "'",
        "“": '"',
        "”": '"',
        "–": "-",
        "—": "-",
        "œ": "oe",
        "Œ": "OE",
    }
    normalized = "".join(replacements.get(ch, ch) for ch in str(text))
    try:
        normalized.encode("cp850")
        return normalized
    except UnicodeEncodeError:
        return (
            unicodedata.normalize("NFKD", normalized)
            .encode("ascii", "ignore")
            .decode("ascii")
        )


def _wrap_name(name: str, width: int = NAME_W) -> list[str]:
    safe_name = _safe_text(name)
    if not safe_name:
        return [""]
    wrapped = textwrap_wrap(
        safe_name,
        width=width,
        break_long_words=False,
        break_on_hyphens=False,
    )
    return wrapped or [""]


_print_lock = threading.Lock()


def _open_printer() -> Win32Raw:
    if not printer_available(config.printer_name):
        raise HTTPException(
            status_code=503,
            detail=f"Printer not available in spooler: {config.printer_name!r}",
        )
    return Win32Raw(config.printer_name)


def _normal_text(p: Win32Raw) -> None:
    """Reset to font A, normal width/height, left-aligned, not bold."""
    p.set(align="left", bold=False, double_width=False, double_height=False)


def _print_separator(p: Win32Raw, char: str = "-", width: int | None = None) -> None:
    p.set(align="center", bold=False, double_width=False, double_height=False)
    p.text(char * (width or _receipt_width()) + "\n")
    _normal_text(p)


def _center_line(text: str, width: int | None = None) -> str:
    return _safe_text(text).center(width or _receipt_width()) + "\n"


def _label_row(label: str, value: str, width: int) -> str:
    return f"{label.ljust(9)}: {_safe_text(value)}\n"


def _resolve_logo_path() -> Path | None:
    raw = (config.logo_path or "").strip()
    if not raw:
        return None
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = _app_dir() / path
    return path


def _prepare_logo(path: Path) -> Image.Image:
    """Load and normalize a logo for a black-and-white thermal printer."""
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGBA")
        background = Image.new("RGBA", image.size, "WHITE")
        background.alpha_composite(image)
        image = background.convert("L")

    target_width = max(64, min(config.logo_width_px, 576))
    if image.width > target_width:
        ratio = target_width / image.width
        target_height = max(1, int(image.height * ratio))
        image = image.resize((target_width, target_height), Image.Resampling.LANCZOS)

    # Use a crisp threshold so logos print cleanly on thermal paper.
    return image.point(lambda px: 0 if px < 190 else 255, mode="1")


def _print_logo(p: Win32Raw) -> None:
    logo_path = _resolve_logo_path()
    if not logo_path:
        return
    if not logo_path.exists():
        log.warning("Logo file not found: %s", logo_path)
        return
    try:
        p.image(_prepare_logo(logo_path), center=True)
        p.text("\n")
    except Exception as exc:
        log.warning("Logo print failed for %s: %s", logo_path, exc)


def render_receipt(payload: "ReceiptPayload") -> None:
    width = _receipt_width()
    now = datetime.now()
    date = payload.date or now.strftime("%d/%m/%Y")
    time = payload.time or now.strftime("%H:%M")
    store = payload.store
    qr_value = (payload.qr_data or payload.order_id or "").strip()
    if ":" in qr_value:
        prefix, raw = qr_value.split(":", 1)
        if prefix.upper() in {"TICKET_ID", "TICKET", "ORDER_ID", "ORDER"}:
            qr_value = raw.strip()

    with _print_lock:
        p = _open_printer()
        try:
            # ── Header ──────────────────────────────────────────────────
            _print_logo(p)
            if store and store.name:
                p.set(align="center")
                p.set(bold=True)
                p.text(_safe_text(store.name) + "\n")
                p.set(bold=False)
                if store.address:
                    p.text(_safe_text(store.address) + "\n")
                if store.phone:
                    p.text(f"Tel : {_safe_text(store.phone)}\n")

            _print_separator(p)

            p.set(align="center", bold=True)
            p.text("TICKET DE CAISSE\n")
            p.set(bold=False)
            p.text(f"N {payload.order_id}\n")
            _print_separator(p)

            # ── Meta ────────────────────────────────────────────────────
            p.set(align="left")
            p.text(_label_row("Date", f"{date}   {time}", width))
            p.text(_label_row("Caisse", config.cash_register, width))
            if payload.cashier:
                p.text(_label_row("Caissier", payload.cashier, width))

            _print_separator(p)

            # ── Items table ─────────────────────────────────────────────
            p.set(bold=True)
            p.text(_item_header(width))
            p.set(bold=False)
            _print_separator(p)

            for it in payload.items:
                _print_item(p, it, width)

            _print_separator(p)

            # ── Totals ──────────────────────────────────────────────────
            if payload.subtotal is not None:
                p.text(_money_row("Sous-total", payload.subtotal, width))
            if payload.discount and payload.discount > 0.0005:
                p.text(_money_row("Remise", -payload.discount, width))
            if payload.tax and payload.tax > 0.0005:
                p.text(_money_row("TVA", payload.tax, width))

            _print_separator(p)
            p.set(align="center", bold=True, double_width=True, double_height=False)
            p.text("TOTAL TTC\n")
            p.text(f"{_money_fr(payload.total)} TND\n")
            _normal_text(p)
            _print_separator(p)

            # ── Payment ─────────────────────────────────────────────────
            p.set(align="left")
            if payload.payment_method:
                p.text(_label_row("Paiement", payload.payment_method, width))
            if payload.paid is not None:
                p.text(_money_row("Recu", payload.paid, width))
            if payload.change is not None and payload.change > 0.0005:
                p.text(_money_row("Rendu", payload.change, width))

            # ── QR + thank-you ──────────────────────────────────────────
            p.set(align="center")
            try:
                p.qr(qr_value, size=7)
            except Exception as exc:
                # QR rendering failure shouldn't kill the print
                log.warning("QR render failed: %s", exc)
            _print_separator(p)
            p.set(align="center")
            p.text("Merci pour votre visite\n")
            p.text("A bientot !\n")
            

            # ── Cut ─────────────────────────────────────────────────────
            try:
                p.cut()
            except Exception as exc:  # printer without cutter
                log.info("Cut not supported: %s", exc)
                p.text("\n\n\n")
        finally:
            try:
                p.close()
            except Exception:
                pass

    log.info(
        "POST /print/receipt order=%s items=%d total=%.3f → OK",
        payload.order_id, len(payload.items), float(payload.total),
    )


def render_test_ticket() -> None:
    width = config.chars_per_line
    with _print_lock:
        p = _open_printer()
        try:
            p.set(align="center", bold=True, double_width=True, double_height=True)
            p.text("TP80BE TEST\n")
            _normal_text(p)
            p.set(align="center")
            p.text("Print bridge OK\n")
            p.text(datetime.now().strftime("%d/%m/%Y %H:%M:%S") + "\n")
            p.text("-" * width + "\n")
            p.set(align="left")
            p.text(f"Printer  : {config.printer_name}\n")
            p.text(f"Width    : {config.paper_width_mm} mm\n")
            p.text(f"Cols     : {width}\n")
            p.text("-" * width + "\n")
            p.set(align="center")
            try:
                p.qr("TP80BE-TEST", size=8)
            except Exception as exc:
                log.warning("QR render failed in test: %s", exc)
            p.text("\nTest ticket\n\n")
            try:
                p.cut()
            except Exception:
                p.text("\n\n\n")
        finally:
            try:
                p.close()
            except Exception:
                pass
    log.info("POST /print/test → OK")


# ─── FastAPI app ─────────────────────────────────────────────────────────────


app = FastAPI(title="TP80BE Print Bridge", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Print-Token", "Authorization"],
)


def require_token(request: Request) -> None:
    expected = config.print_token
    if not expected:
        return
    received = request.headers.get("X-Print-Token", "")
    authz = request.headers.get("Authorization", "")
    if authz.lower().startswith("bearer "):
        received = authz[7:].strip()
    if received != expected:
        raise HTTPException(status_code=401, detail="Invalid print token")


# ─── Payload models ──────────────────────────────────────────────────────────


class StorePayload(BaseModel):
    name: str
    address: str | None = None
    phone: str | None = None


class ItemPayload(BaseModel):
    name: str
    qty: float = Field(gt=0)
    price: float = Field(ge=0)
    total: float = Field(ge=0)


class ReceiptPayload(BaseModel):
    order_id: str
    date: str | None = None
    time: str | None = None
    cashier: str | None = None
    store: StorePayload | None = None
    items: list[ItemPayload]
    subtotal: float | None = None
    discount: float | None = None
    tax: float | None = None
    total: float
    payment_method: str | None = None
    paid: float | None = None
    change: float | None = None
    qr_data: str | None = None


# ─── Endpoints ───────────────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "printer_name": config.printer_name,
        "available": printer_available(config.printer_name),
    }


@app.get("/printers")
def printers() -> dict[str, Any]:
    return {"printers": list_windows_printers()}


@app.post("/print/test")
def print_test(_: None = Depends(require_token)) -> dict[str, Any]:
    try:
        render_test_ticket()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover — escpos errors
        log.exception("Test print failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/print/receipt")
def print_receipt(
    payload: ReceiptPayload, _: None = Depends(require_token)
) -> dict[str, Any]:
    try:
        render_receipt(payload)
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("Receipt print failed (order=%s): %s", payload.order_id, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True, "order_id": payload.order_id}


# ─── Entrypoint ──────────────────────────────────────────────────────────────


if __name__ == "__main__":
    log.info(
        "Starting print bridge on http://%s:%d (printer=%s, %d cols, %d mm)",
        config.host, config.port, config.printer_name,
        config.chars_per_line, config.paper_width_mm,
    )
    uvicorn.run(app, host=config.host, port=config.port, log_level="info")
