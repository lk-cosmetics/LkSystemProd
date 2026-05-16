# LED8 Customer Display Bridge

Local Windows bridge that drives an **ASM LED8** (or compatible ESC/POS LED)
pole display connected to the cashier PC over a serial COM port. The hosted
Django server cannot access `COM5` on the cashier, so the browser POS posts to
this local service instead:

```text
React POS  ->  http://127.0.0.1:8787  ->  FastAPI EXE  ->  pyserial  ->  COM5 LED8
```

## Protocol (ASM LED8)

| Action | Bytes |
| --- | --- |
| Clear screen | `0x0C` |
| Initialise | `0x1B 0x40` |
| Set label (`ESC s n`) | `0x1B 0x73 n`  — `n = '0'..'4'` (off / Price / Total / Collect / Change) |
| Display number | `0x1B 0x51 0x41 <ascii digits + dot/minus> 0x0D` |

Example — show `25.500` on the Total label:

```text
1B 73 32                          ; ESC s '2' → light Total label
1B 51 41 32 35 2E 35 30 30 0D     ; ESC Q A "25.500" CR
```

Serial: `2400 baud, 8 data, no parity, 1 stop, no flow control`.

## Endpoints

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET  | `/health` | — | `{ ok, serial_port, baud_rate, serial_open }` |
| GET  | `/ports`  | — | Lists available COM ports via `pyserial` |
| POST | `/display/init`    | — | Sends `ESC @` |
| POST | `/display/clear`   | — | Sends `0x0C` |
| POST | `/display/price`   | `{ "value": 3.500 }` | Price label + number |
| POST | `/display/total`   | `{ "total": 25.500 }` or `{ "value": 25.500 }` | Total label + number |
| POST | `/display/collect` | `{ "value": 30.000 }` | Collect label + number |
| POST | `/display/change`  | `{ "value": 4.500 }`  | Change label + number |
| POST | `/display/test`    | — | `init` → `clear` → Total + `25.500` |

All `POST` calls require the header `X-Display-Token: <token>` (defaults to
`change-me`). Numbers are validated (digits, dot, leading minus only),
formatted to `default_decimals` (3 by default), and clipped to the LED8's
8-digit capacity.

## Config

Drop a `config.json` beside `main.py` (or beside the EXE for the built
bundle). Any field can be overridden by an environment variable of the same
name (e.g. `DISPLAY_TOKEN=...`). Missing values fall back to defaults.

```json
{
  "host": "127.0.0.1",
  "port": 8787,
  "serial_port": "COM5",
  "baud_rate": 2400,
  "display_token": "change-me",
  "default_decimals": 3,
  "allowed_origins": [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://localhost:5173",
    "https://127.0.0.1:5173"
  ]
}
```

`allowed_origins` must contain the origin(s) the POS web app is served from.
A comma-separated string is also accepted for backwards compatibility.

## Install (developer PC)

```powershell
cd C:\Users\saker\Desktop\StagePfe\customer-display-bridge
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
```

## Run in development

```powershell
.\.venv\Scripts\python.exe main.py
```

The bridge listens on `http://127.0.0.1:8787` and reads `config.json` from its
own folder. Logs are printed to the console, including the hex of every byte
sent to the serial port.

## Build a standalone EXE

```powershell
cd C:\Users\saker\Desktop\StagePfe\customer-display-bridge
.\build.ps1
```

Outputs:

```text
dist\LED8Bridge.exe
dist\config.json
```

## Deploy to cashier PC

1. Copy **both** `dist\LED8Bridge.exe` and `dist\config.json` to any folder on
   the cashier PC (e.g. `C:\LED8Bridge\`). Python is **not** required.
2. Open `config.json` and adjust `serial_port` (if not `COM5`) and
   `display_token`.
3. Double-click `LED8Bridge.exe`. A console window shows live logs.

### Autostart on Windows

1. Right-click `LED8Bridge.exe` → **Create shortcut**.
2. Press `Win+R`, type `shell:startup`, press Enter.
3. Drop the shortcut into that folder. It will launch on every login.

## curl smoke tests

```sh
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/ports
curl -X POST http://127.0.0.1:8787/display/test -H "X-Display-Token: change-me"
curl -X POST http://127.0.0.1:8787/display/total   -H "Content-Type: application/json" -H "X-Display-Token: change-me" -d "{\"total\":25.500}"
curl -X POST http://127.0.0.1:8787/display/price   -H "Content-Type: application/json" -H "X-Display-Token: change-me" -d "{\"value\":3.500}"
curl -X POST http://127.0.0.1:8787/display/collect -H "Content-Type: application/json" -H "X-Display-Token: change-me" -d "{\"value\":30.000}"
curl -X POST http://127.0.0.1:8787/display/change  -H "Content-Type: application/json" -H "X-Display-Token: change-me" -d "{\"value\":4.500}"
```

## Browser overrides

The React POS reads the bridge URL and token from `localStorage`. Defaults
match this README — only override if needed:

```js
localStorage.setItem('lk_pos_customer_display_enabled', 'true')
localStorage.setItem('lk_pos_customer_display_url',  'http://127.0.0.1:8787')
localStorage.setItem('lk_pos_customer_display_token','change-me')
```

Checkout never fails if the bridge is offline — the POS logs a console warning
and continues.
