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
├── deploy/                    # VPS bootstrap scripts + production env template
│   ├── deploy-production.sh
│   ├── install-ssl-certificate.sh
│   ├── lksystem.env.example
│   └── README.md
├── docker-compose.fullstack.yml   # Local dev stack (self-signed TLS)
├── docker-compose.prod.yml        # VPS production stack (Let's Encrypt mount)
└── .github/workflows/             # CI + deploy pipelines
```

The POS printer and customer-display bridges live in a separate
repository — they ship to each Windows terminal as standalone installers.

---

## Architecture

### Logical view — what does what

```
┌──────────────────────── Browser (React SPA) ─────────────────────────┐
│                                                                       │
│   Pages          Hooks (React-Query)        Stores (Zustand)          │
│   ─────          ────────────────────       ─────────────────         │
│   Login          useAuth                    authStore                 │
│   Dashboard      useBI, useDashboard...     uiStore                   │
│   POS            useProducts, useOrders     cartStore                 │
│   Products       useStock, usePromotions    posStore                  │
│   Orders         useUsers, useRoles                                   │
│   Promotions     ────────────────────                                 │
│   BI Dashboard       │                                                │
│   …                  │  axios + JWT + CSRF + auto-refresh             │
└──────────────────────┼────────────────────────────────────────────────┘
                       │  HTTPS  (/api/v1/*, /static/*, /media/*)
                       ▼
┌──────────────────────── Nginx reverse proxy ─────────────────────────┐
│   ▸ TLS termination (Let's Encrypt)                                   │
│   ▸ /             → React bundle (SPA fallback to index.html)         │
│   ▸ /api/         → backend:8000                                      │
│   ▸ /static/      → backend (collectstatic, WhiteNoise)               │
│   ▸ /media/       → media_volume (user uploads)                       │
│   ▸ /health       → 200 (Docker probe)                                │
└──────────────────────┬────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────── Django backend (DRF + Channels) ─────────────┐
│                                                                       │
│   Auth & RBAC          Catalogue           Operations                 │
│   ────────────         ──────────          ──────────                 │
│   apps/users           apps/brands         apps/orders                │
│   apps/rbac            apps/products       apps/inventory             │
│                        apps/categories     apps/sales_channels        │
│                        apps/promotions     apps/clients               │
│                                                                       │
│   Company tenancy      Analytics           Sync & realtime            │
│   ──────────────       ─────────           ───────────────            │
│   apps/company         apps/bi             ▸ WebSockets via Channels  │
│                                            ▸ Celery worker + beat     │
│                                            ▸ WooCommerce webhooks     │
└──────────────────────┬───────────────────────────┬────────────────────┘
                       │                           │
                       ▼                           ▼
              ┌─────────────────┐         ┌─────────────────┐
              │   PostgreSQL    │         │      Redis      │
              │ source of truth │         │  cache · sessions
              │                 │         │  · channels layer
              │                 │         │  · celery broker │
              └─────────────────┘         └─────────────────┘
```

The frontend talks **only** to Nginx; everything else is private to the
Docker network. Authentication is JWT (short-lived access + httpOnly
refresh) with CSRF tokens injected on every mutation. RBAC is applied
per-request via permission classes inside DRF.

### Physical view — what lives on the VPS

```
                    Internet ─── HTTPS ───┐
                                          │ port 443
            ┌─────────────────────────────┴─────────────────────────────┐
            │  Hostinger VPS · Ubuntu 22.04 · /opt/lksystem · ufw       │
            │                                                            │
            │   ┌──────────────────────────────────────────────────┐    │
            │   │   Docker network: app_net (bridge, private)       │    │
            │   │                                                   │    │
            │   │   ┌──────────────┐    ┌──────────────┐            │    │
            │   │   │  frontend    │    │   backend    │  ┌──────┐  │    │
            │   │   │  (nginx)     │───▶│  (gunicorn)  │─▶│  db  │  │    │
            │   │   │  443·80      │    │   8000       │  └──────┘  │    │
            │   │   └──────┬───────┘    └──────┬───────┘            │    │
            │   │          │                   │    ┌─────────┐     │    │
            │   │   /etc/letsencrypt           │───▶│  redis  │◀────┤    │
            │   │   (RO mount)                 │    └─────────┘     │    │
            │   │                              │         ▲           │    │
            │   │                       ┌──────┴───────┐ │           │    │
            │   │                       │ celery-worker├─┘           │    │
            │   │                       └──────────────┘             │    │
            │   └───────────────────────────────────────────────────┘    │
            │                                                            │
            │   Docker named volumes (persisted, in /var/lib/docker):     │
            │   ▸ postgres_data    DB state                              │
            │   ▸ redis_data       AOF persistence                       │
            │   ▸ static_volume    collectstatic output                  │
            │   ▸ media_volume     user uploads (logos, product images)  │
            │                                                            │
            │   Host paths:                                              │
            │   ▸ /etc/letsencrypt/live/<DOMAIN>/   TLS cert + key       │
            │   ▸ /etc/letsencrypt/renewal-hooks/   auto-reload on renew │
            └────────────────────────────────────────────────────────────┘
                                          ▲
                                          │  SSH (key-only, ufw, fail2ban)
                                          │
                                  ┌───────┴───────┐
                                  │ GitHub Actions │
                                  │ on push to main│
                                  └────────────────┘
```

* Only ports **22 / 80 / 443** are open inbound (ufw). PostgreSQL and Redis
  are never reachable from outside the Docker network.
* Containers carry healthchecks and `restart: unless-stopped` so the stack
  self-heals on OOM or crashes.
* Backups = `pg_dump` of `postgres_data` + tar of `media_volume`. Static
  files are reproducible from the image — no need to back up.

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

## Create the first super-admin

The system needs at least one `Super Admin` account before anyone can log in.
There are three supported ways to bootstrap it — pick **one**.

### Option A — auto-create on first container start (zero touch)

Set these in `deploy/lksystem.env` (production) or your local backend `.env`,
then start the stack. The entrypoint script creates the user only when no
superuser exists yet, so this is safe to leave enabled on first deploy and
flip back to `false` afterwards.

```env
AUTO_CREATE_DEFAULT_ADMIN=true
DEFAULT_ADMIN_MATRICULE=SUPERADMIN-0001
DEFAULT_ADMIN_EMAIL=admin@therapybylk.com
DEFAULT_ADMIN_PASSWORD=ChangeMe123!
DEFAULT_ADMIN_FIRST_NAME=Super
DEFAULT_ADMIN_LAST_NAME=Admin
```

```bash
docker compose -f docker-compose.prod.yml up -d backend
docker compose -f docker-compose.prod.yml logs backend | grep -i admin
#  → "Default SUPERADMIN created: SUPERADMIN-0001"
```

After it succeeds, **set `AUTO_CREATE_DEFAULT_ADMIN=false`** and restart so a
restart can never replay the bootstrap on a wiped database.

### Option B — explicit management command (recommended for production)

Bootstrap from outside, on a running stack. Idempotent: re-running with the
same matricule updates the existing account instead of failing.

```bash
# Production VPS
cd /opt/lksystem
docker compose --env-file deploy/lksystem.env -f docker-compose.prod.yml \
  exec backend python manage.py create_superadmin \
    --matricule SUPERADMIN-0001 \
    --email admin@therapybylk.com \
    --password 'YourStrongPassword!' \
    --first-name Super --last-name Admin \
    --company 'LK Cosmetics'
```

```bash
# Local dev
docker compose -f docker-compose.fullstack.yml \
  exec backend python manage.py create_superadmin
# (no arguments — prompts interactively)
```

What the command does:

1. Gets or creates the `Company` (only one is created if the name is new).
2. Creates the user with `is_staff=True`, `is_superuser=True`, `is_active=True`.
3. Assigns the **Super Admin** RBAC role (`apps/rbac`) so the BI dashboard,
   user management, and tenant switching all unlock.
4. Prints the final credential summary.

If the RBAC role is missing the command tells you to run
`python manage.py seed_rbac` first — but `entrypoint.sh` already seeds RBAC
on every container start, so this only matters in an isolated `manage.py shell`.

### Option C — Django's `createsuperuser` (last resort)

Works, but does **not** assign the RBAC `Super Admin` role and does not seed a
`Company`, so the user can log in but the dashboard will look empty. Only use
this for emergency password resets, then immediately run
`create_superadmin --matricule <theirs>` to re-attach the role.

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py createsuperuser
```

### Logging in

* Frontend: <https://lksystem.therapybylk.com> (production) or
  <https://localhost:5173> (dev).
* Username field is the **matricule** (e.g. `SUPERADMIN-0001`), not the email.
* Password is whatever you set above.

Once inside, head to *Users → Roles* to invite teammates and assign roles
(Manager, CEO, Cashier, Stock, …). The seed file
[`apps/rbac/management/commands/seed_rbac.py`](LkSystemBackEnd/apps/rbac/management/commands/seed_rbac.py)
ships every role with sensible default permissions.

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
