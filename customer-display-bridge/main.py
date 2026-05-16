"""ASM LED8 customer-display bridge.

Local FastAPI service that drives an ASM LED8 (or compatible ESC/POS LED) pole
display over a serial COM port. The browser POS posts to http://127.0.0.1:8787
with an X-Display-Token header; the bridge formats LED8 commands and writes
them to the serial port.

Protocol (ASM LED8):
    Clear screen        : 0x0C
    Initialise          : 0x1B 0x40
    Set label (ESC s n) : 0x1B 0x73 <n>      n = '0'..'4' (off, price, total, collect, change)
    Display number      : 0x1B 0x51 0x41 <ascii digits / '.' / '-'> 0x0D
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import serial
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from serial.tools import list_ports

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [bridge] %(message)s",
)
log = logging.getLogger("led8-bridge")


# ─── LED8 protocol constants ─────────────────────────────────────────────────

CLR = b"\x0c"
INIT = b"\x1b\x40"
ESC_QA = b"\x1b\x51\x41"
CR = b"\x0d"

# Label bytes use the ASCII-digit form (e.g. '2' = 0x32). The user's working
# example shows `1B 73 32` for the Total label, so we match it.
LBL_OFF = b"\x1b\x73\x30"
LBL_PRICE = b"\x1b\x73\x31"
LBL_TOTAL = b"\x1b\x73\x32"
LBL_COLLECT = b"\x1b\x73\x33"
LBL_CHANGE = b"\x1b\x73\x34"

LED8_DIGIT_CAPACITY = 8  # max significant digits the LED8 can show
NUMBER_PATTERN = re.compile(r"^[+-]?\d+(\.\d+)?$")


# ─── Config ──────────────────────────────────────────────────────────────────

DEFAULT_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://localhost:5173",
    "https://127.0.0.1:5173",
]


@dataclass(frozen=True)
class BridgeConfig:
    host: str = "127.0.0.1"
    port: int = 8787
    serial_port: str = "COM5"
    baud_rate: int = 2400
    display_token: str = "change-me"
    default_decimals: int = 3
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
    """Load config.json next to the script/EXE, with env-var overrides."""

    cfg_path = _app_dir() / "config.json"
    raw: dict[str, Any] = {}
    if cfg_path.exists():
        try:
            raw = json.loads(cfg_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("Failed to read %s: %s — using defaults", cfg_path, exc)

    def pick(*keys: str, default: Any = None) -> Any:
        for key in keys:
            env = os.getenv(key)
            if env not in (None, ""):
                return env
        for key in keys:
            if key in raw and raw[key] not in (None, ""):
                return raw[key]
        return default

    return BridgeConfig(
        host=str(pick("host", "HOST", default="127.0.0.1")),
        port=int(pick("port", "PORT", default=8787)),
        serial_port=str(pick("serial_port", "DISPLAY_PORT", default="COM5")),
        baud_rate=int(pick("baud_rate", "DISPLAY_BAUDRATE", default=2400)),
        display_token=str(pick("display_token", "DISPLAY_TOKEN", default="change-me")),
        default_decimals=int(pick("default_decimals", "DEFAULT_DECIMALS", default=3)),
        allowed_origins=_coerce_origins(
            pick("allowed_origins", "ALLOWED_ORIGIN", default=None)
        ),
    )


config = load_config()


# ─── Serial manager ──────────────────────────────────────────────────────────


class SerialManager:
    """Owns one persistent serial.Serial. Reopens on failure."""

    def __init__(self, cfg: BridgeConfig) -> None:
        self._cfg = cfg
        self._lock = threading.Lock()
        self._ser: serial.Serial | None = None

    @property
    def serial_port(self) -> str:
        return self._cfg.serial_port

    @property
    def baud_rate(self) -> int:
        return self._cfg.baud_rate

    def is_open(self) -> bool:
        return self._ser is not None and self._ser.is_open

    def _open_locked(self) -> serial.Serial:
        if self._ser is not None and self._ser.is_open:
            return self._ser
        log.info("Opening %s @ %d 8N1", self._cfg.serial_port, self._cfg.baud_rate)
        self._ser = serial.Serial(
            port=self._cfg.serial_port,
            baudrate=self._cfg.baud_rate,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=1,
            write_timeout=1,
        )
        return self._ser

    def _close_locked(self) -> None:
        if self._ser is not None:
            try:
                self._ser.close()
            except Exception:
                pass
        self._ser = None

    def write(self, payload: bytes, *, endpoint: str) -> None:
        hex_view = payload.hex(" ").upper()
        with self._lock:
            try:
                ser = self._open_locked()
                ser.write(payload)
                ser.flush()
                log.info(
                    "%s port=%s baud=%d tx=%s",
                    endpoint,
                    self._cfg.serial_port,
                    self._cfg.baud_rate,
                    hex_view,
                )
                return
            except (serial.SerialException, OSError) as exc:
                log.warning(
                    "%s first write failed (%s); reopening %s",
                    endpoint,
                    exc,
                    self._cfg.serial_port,
                )
                self._close_locked()

            # One retry after forced reopen
            try:
                ser = self._open_locked()
                ser.write(payload)
                ser.flush()
                log.info(
                    "%s port=%s baud=%d tx=%s (after-reopen)",
                    endpoint,
                    self._cfg.serial_port,
                    self._cfg.baud_rate,
                    hex_view,
                )
            except (serial.SerialException, OSError) as exc:
                log.error("%s serial write failed: %s", endpoint, exc)
                self._close_locked()
                raise HTTPException(
                    status_code=503,
                    detail=f"Display serial port unavailable: {exc}",
                ) from exc


serial_mgr = SerialManager(config)


# ─── Number formatting ───────────────────────────────────────────────────────


def format_number(value: float | int | str, decimals: int) -> str:
    """Format a numeric value for the LED8.

    - Accepts float/int/str.
    - Returns a string of digits, optional '.', optional leading '-'.
    - Truncated to LED8_DIGIT_CAPACITY significant digits if needed.
    - Raises HTTPException(400) on invalid input.
    """

    if isinstance(value, bool):
        raise HTTPException(status_code=400, detail="Invalid number")

    if isinstance(value, (int, float)):
        text = f"{float(value):.{max(0, decimals)}f}"
    elif isinstance(value, str):
        s = value.strip()
        if not NUMBER_PATTERN.fullmatch(s):
            raise HTTPException(status_code=400, detail=f"Invalid number: {value!r}")
        try:
            text = f"{float(s):.{max(0, decimals)}f}"
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    else:
        raise HTTPException(status_code=400, detail="Invalid number type")

    if not set(text) <= set("0123456789.-"):
        raise HTTPException(status_code=400, detail=f"Invalid characters in {text!r}")

    # LED8 capacity check (count digits only)
    digits_only = sum(1 for ch in text if ch.isdigit())
    if digits_only > LED8_DIGIT_CAPACITY:
        # Drop precision until it fits
        while digits_only > LED8_DIGIT_CAPACITY and "." in text:
            text = text[:-1]
            if text.endswith("."):
                text = text[:-1]
            digits_only = sum(1 for ch in text if ch.isdigit())
        if digits_only > LED8_DIGIT_CAPACITY:
            raise HTTPException(
                status_code=400,
                detail=f"Number {value!r} exceeds LED8 capacity of {LED8_DIGIT_CAPACITY} digits",
            )

    return text


def show_number(label: bytes, value: float | int | str, *, endpoint: str) -> str:
    number = format_number(value, config.default_decimals)
    payload = label + ESC_QA + number.encode("ascii") + CR
    serial_mgr.write(payload, endpoint=endpoint)
    return number


# ─── FastAPI app ─────────────────────────────────────────────────────────────


app = FastAPI(title="LED8 Customer Display Bridge", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Display-Token", "Authorization"],
)


def require_token(request: Request) -> None:
    expected = config.display_token
    if not expected:
        return
    received = request.headers.get("X-Display-Token", "")
    authz = request.headers.get("Authorization", "")
    if authz.lower().startswith("bearer "):
        received = authz[7:].strip()
    if received != expected:
        raise HTTPException(status_code=401, detail="Invalid display token")


# ─── Payload models ──────────────────────────────────────────────────────────


class ValuePayload(BaseModel):
    value: float = Field(..., description="Number to show on the LED.")


class TotalPayload(BaseModel):
    total: float | None = None
    value: float | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "TotalPayload":
        if self.total is None and self.value is None:
            raise ValueError("Provide 'total' or 'value'.")
        return self

    @property
    def amount(self) -> float:
        return self.total if self.total is not None else float(self.value or 0)


# ─── Endpoints ───────────────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "serial_port": serial_mgr.serial_port,
        "baud_rate": serial_mgr.baud_rate,
        "serial_open": serial_mgr.is_open(),
    }


@app.get("/ports")
def ports() -> dict[str, Any]:
    return {
        "ports": [
            {
                "device": p.device,
                "description": p.description,
                "hwid": p.hwid,
            }
            for p in list_ports.comports()
        ]
    }


@app.post("/display/init")
def display_init(_: None = Depends(require_token)) -> dict[str, Any]:
    serial_mgr.write(INIT, endpoint="POST /display/init")
    return {"ok": True}


@app.post("/display/clear")
def display_clear(_: None = Depends(require_token)) -> dict[str, Any]:
    serial_mgr.write(CLR, endpoint="POST /display/clear")
    return {"ok": True}


@app.post("/display/price")
def display_price(
    payload: ValuePayload, _: None = Depends(require_token)
) -> dict[str, Any]:
    shown = show_number(LBL_PRICE, payload.value, endpoint="POST /display/price")
    return {"ok": True, "shown": shown}


@app.post("/display/total")
def display_total(
    payload: TotalPayload, _: None = Depends(require_token)
) -> dict[str, Any]:
    shown = show_number(LBL_TOTAL, payload.amount, endpoint="POST /display/total")
    return {"ok": True, "shown": shown}


@app.post("/display/collect")
def display_collect(
    payload: ValuePayload, _: None = Depends(require_token)
) -> dict[str, Any]:
    shown = show_number(LBL_COLLECT, payload.value, endpoint="POST /display/collect")
    return {"ok": True, "shown": shown}


@app.post("/display/change")
def display_change(
    payload: ValuePayload, _: None = Depends(require_token)
) -> dict[str, Any]:
    shown = show_number(LBL_CHANGE, payload.value, endpoint="POST /display/change")
    return {"ok": True, "shown": shown}


@app.post("/display/test")
def display_test(_: None = Depends(require_token)) -> dict[str, Any]:
    serial_mgr.write(INIT, endpoint="POST /display/test:init")
    serial_mgr.write(CLR, endpoint="POST /display/test:clear")
    shown = show_number(LBL_TOTAL, 25.500, endpoint="POST /display/test:total")
    return {"ok": True, "shown": shown}


# ─── Entrypoint ──────────────────────────────────────────────────────────────


if __name__ == "__main__":
    log.info(
        "Starting LED8 bridge on http://%s:%d (serial=%s @ %d 8N1)",
        config.host,
        config.port,
        config.serial_port,
        config.baud_rate,
    )
    uvicorn.run(app, host=config.host, port=config.port, log_level="info")
