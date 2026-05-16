# TP80BE Print Bridge

Local Windows bridge that prints receipts to an **HPRT TP80BE** (or any
ESC/POS-compatible Windows printer) by sending bytes through the spooler.
This bridge bypasses the Chrome print dialog entirely — no margins, no
paper-size pickers, no blank second sheet.

```text
React POS  ->  http://127.0.0.1:8788  ->  TP80BEPrintBridge.exe  ->  Windows spooler  ->  TP80BE
```

The bridge is **independent of the LED display bridge** (port 8787). The two
exes run side by side on the cashier PC.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET  | `/health`        | `{ ok, printer_name, available }` |
| GET  | `/printers`      | List of installed Windows printers |
| POST | `/print/test`    | Print a test ticket (cuts at end) |
| POST | `/print/receipt` | Print a receipt from a JSON payload |

All `POST` calls require the header `X-Print-Token: <token>` (default
`change-me`).

## Receipt payload

```jsonc
{
  "order_id":       "ORD-TEST-001",
  "date":           "2026-05-12",         // optional — defaults to now()
  "time":           "02:15",              // optional
  "cashier":        "Admin",              // optional
  "store": {
    "name":    "THERAPYBLK",
    "address": "Adresse magasin",         // optional
    "phone":   "12345678"                 // optional
  },
  "items": [
    { "name": "Bourne", "qty": 1, "price": 44.500, "total": 44.500 }
  ],
  "subtotal":       44.500,                // optional
  "discount":       0.000,                 // optional
  "tax":            0.000,                 // optional
  "total":          44.500,
  "payment_method": "Espèce",
  "paid":           50.000,                // optional
  "change":         5.500,                 // optional
  "qr_data":        "ORDER_ID:ORD-TEST-001"
}
```

The minimum to print is `{ order_id, items, total, qr_data }`.

## Config

`config.json` sits next to `main.py` (dev) or next to `TP80BEPrintBridge.exe`
(prod). Any field can be overridden by an environment variable of the same
name (uppercase), e.g. `PRINT_TOKEN=foo`.

```json
{
  "host": "127.0.0.1",
  "port": 8788,
  "printer_name": "TP80BE",
  "print_token": "change-me",
  "paper_width_mm": 80,
  "printable_width_mm": 72,
  "chars_per_line": 48,
  "logo_path": "logo.png",
  "logo_width_px": 384,
  "allowed_origins": [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://127.0.0.1:5173",
    "https://localhost:5173"
  ]
}
```

### Logo

`logo_path` is optional. If it is empty (`""`), the ticket prints without a
logo. If it is relative, it is resolved next to `TP80BEPrintBridge.exe` and
`config.json`.

Recommended thermal logo file:

```text
Format: PNG
Colors: black on white, no small gray details
Width: 384 px recommended, 512 px max
Height: 80-160 px recommended
File location: same folder as TP80BEPrintBridge.exe
Config example: "logo_path": "logo.png"
```

To change the logo later, replace `logo.png` or edit `logo_path`, then restart
`TP80BEPrintBridge.exe`.

## Install (developer PC)

```powershell
cd C:\Users\saker\Desktop\StagePfe\print-bridge
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
```

## Run in development

```powershell
.\.venv\Scripts\python.exe main.py
```

Logs print to the console — every `/print/...` call shows the order id, item
count, total, and a success/failure status.

## Build a standalone EXE

```powershell
.\build.ps1
```
or double-click `build_print_bridge.bat`.

Outputs:

```text
dist\TP80BEPrintBridge.exe
dist\config.json
```

## Deploy to cashier PC

1. Copy **both** `TP80BEPrintBridge.exe` and `config.json` to any folder
   (e.g. `C:\TP80BEPrintBridge\`). Python is **not** required.
2. Make sure the printer is installed in Windows under the name set in
   `config.json` (`TP80BE` by default).
3. Double-click `TP80BEPrintBridge.exe`. Logs appear in the console window.

### Autostart on Windows

`Win+R` → `shell:startup` → drop a shortcut to `TP80BEPrintBridge.exe`. Or
use Task Scheduler for an admin-free auto-restart loop (same pattern as the
LED bridge).

## curl smoke tests

```sh
curl http://127.0.0.1:8788/health
curl http://127.0.0.1:8788/printers
curl -X POST http://127.0.0.1:8788/print/test    -H "X-Print-Token: change-me"
curl -X POST http://127.0.0.1:8788/print/receipt -H "Content-Type: application/json" -H "X-Print-Token: change-me" -d "{\"order_id\":\"ORD-TEST-001\",\"items\":[{\"name\":\"Test Article\",\"qty\":1,\"price\":12.500,\"total\":12.500}],\"total\":12.500,\"paid\":20.000,\"change\":7.500,\"payment_method\":\"Espèce\",\"qr_data\":\"ORDER_ID:ORD-TEST-001\"}"
```

## React integration

`lkSystemFrontEnd/src/services/printBridge.ts` exposes:

```ts
printBridge.printReceipt(payload)         // returns boolean, never throws
printBridge.printTest()
printBridge.getPrintBridgeHealth()
```

Browser overrides (mirroring the LED bridge):

```js
localStorage.setItem('lk_pos_print_bridge_enabled', 'true')
localStorage.setItem('lk_pos_print_bridge_url',    'http://127.0.0.1:8788')
localStorage.setItem('lk_pos_print_bridge_token',  'change-me')
```

Checkout never fails if this bridge is offline — the console logs a warning
and the manual *Print Receipt* button still uses the browser HTML fallback.
