# LkSystem ERP

ERP / POS / BI platform for the *therapybylk* group. Multi-brand, multi-channel,
real-time dashboard, integrated POS with thermal-printer & customer-display
bridges, and a WooCommerce sync pipeline.

**Production URL:** <https://lksystem.therapybylk.com>

---

## Stack

| Layer | Tech |
| --- | --- |
| Backend | Django 5 + DRF, Channels (ASGI), Celery, Gunicorn |
| Database | PostgreSQL 15 |
| Cache / broker | Redis 7 |
| Frontend | React 19 + Vite, TailwindCSS, shadcn/ui, React-Query, Zustand |
| Reverse proxy | Nginx (in the frontend container) |
| Bridges | FastAPI services for thermal printer (ESC/POS) and customer display (serial) |
| Infra | Docker Compose, Let's Encrypt, GitHub Actions |

## Repository layout

```
.
├── LkSystemBackEnd/           # Django project (apps, settings, Dockerfile, entrypoint)
├── lkSystemFrontEnd/          # Vite app (src/, Dockerfile, nginx.conf template)
├── print-bridge/              # Windows-side FastAPI bridge for TP80BE thermal printer
├── customer-display-bridge/   # Windows-side FastAPI bridge for ASM LED8 display
├── deploy/                    # VPS bootstrap scripts + production env template
│   ├── deploy-production.sh
│   ├── install-ssl-certificate.sh
│   ├── lksystem.env.example
│   └── README.md
├── docker-compose.fullstack.yml   # Local dev stack (self-signed TLS, hot reload off)
├── docker-compose.prod.yml        # VPS production stack (Let's Encrypt mount)
└── .github/workflows/             # CI + deploy pipelines
```

The bridges run on the Windows POS terminal, **not** on the VPS. They are
kept under version control so updates ship to all terminals via `git pull`.

---

## Local development

Prerequisites: Docker Desktop (or any Docker Engine + Compose plugin).

```bash
# 1. Seed env files
cp LkSystemBackEnd/.env.example LkSystemBackEnd/.env
cp lkSystemFrontEnd/.env.example lkSystemFrontEnd/.env

# 2. Bring the full stack up
docker compose -f docker-compose.fullstack.yml up -d --build

# 3. Watch logs / verify health
docker compose -f docker-compose.fullstack.yml ps
```

| Service | URL |
| --- | --- |
| Frontend (HTTPS, self-signed) | <https://localhost:5173/> |
| Frontend (HTTP) | <http://localhost:5180/> |
| Backend API | <http://localhost:8000/> |
| API docs | <http://localhost:8000/api/docs/> |
| Postgres | `localhost:5433` |
| Redis | `localhost:6379` |

The self-signed certificate is generated inside the frontend container on
first boot; accept the browser warning once.

### Backend without Docker

```bash
cd LkSystemBackEnd
python -m venv .venv && source .venv/bin/activate   # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

### Frontend without Docker

```bash
cd lkSystemFrontEnd
npm install
npm run dev      # Vite dev server on http://localhost:5173
```

### POS bridges

```bash
cd print-bridge
pip install -r requirements.txt
cp config.example.json config.json && edit config.json
python main.py
# Same recipe for customer-display-bridge/.
```

---

## Production deployment

Target: Hostinger VPS, domain `lksystem.therapybylk.com`, deployed under
`/opt/lksystem`.

**Git workflow**

```
feature branches ──▶ dev (CI) ──▶ PR ──▶ main (CI + Deploy) ──▶ VPS
```

* Push every change to a feature branch or directly to `dev`.
* CI runs automatically on `dev` and on pull requests targeting `main`.
* `main` is the deployed branch. Only merge via PR (protect it in GitHub
  Settings → Branches).
* Pushing or merging to `main` triggers the deploy workflow.

**First-time VPS bootstrap**

```bash
# On the VPS, once.
git clone git@github.com:<org>/<repo>.git /opt/lksystem
cd /opt/lksystem
cp deploy/lksystem.env.example deploy/lksystem.env
nano deploy/lksystem.env   # fill secrets

sudo LETSENCRYPT_EMAIL=admin@example.com DOMAIN=lksystem.therapybylk.com \
  ./deploy/install-ssl-certificate.sh

./deploy/deploy-production.sh
```

**Subsequent deploys** happen automatically via the
`.github/workflows/deploy.yml` workflow, which SSHes in, pulls `main`,
runs `deploy/deploy-production.sh`, and probes the health endpoint.

See [`deploy/README.md`](deploy/README.md) for the full runbook (DNS, ports,
renewal, troubleshooting).

---

## Security

* `.env` files are git-ignored; only `*.env.example` templates are tracked.
* Django: `DEBUG=False`, `ALLOWED_HOSTS` / `CSRF_TRUSTED_ORIGINS` / `CORS_ALLOWED_ORIGINS`
  all environment-driven and scoped to the production domain.
* Nginx terminates TLS and forwards `/api`, `/static`, `/media` to the backend
  via the internal Docker network — Postgres and Redis are never exposed.
* `mediafiles/` and `staticfiles/` live in named Docker volumes (`media_volume`,
  `static_volume`) so user uploads survive container rebuilds.
* All services declare healthchecks and `restart: unless-stopped`.

## Bridges (Windows POS terminal)

The `print-bridge/` and `customer-display-bridge/` apps are FastAPI services
that run **on the cashier's Windows machine**, not on the VPS. They expose a
local HTTP endpoint that the React POS calls. Distribution is via the bundled
`PyInstaller` executable under `dist/` (gitignored — built per terminal).

## License

Private — © therapybylk.
