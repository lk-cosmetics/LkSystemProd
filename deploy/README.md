# LkSystem Production Deploy

Target domain: **`lksystem.therapybylk.com`**

This directory contains the only scripts the VPS needs:

| File | Purpose |
| --- | --- |
| `lksystem.env.example` | Template for `lksystem.env` (real secrets, **never** committed). |
| `install-ssl-certificate.sh` | First-time `certbot` issuance + renewal hook. |
| `deploy-production.sh` | Rebuild + restart the prod stack idempotently. |

The CI/CD pipeline lives one level up under [`.github/workflows/`](../.github/workflows).

---

## Git workflow

```
feature/* ──▶ dev ──▶ pull-request ──▶ main ──▶ VPS
                │            │             │
            CI runs     CI runs       Deploy runs
```

* All feature work targets `dev`. CI runs on every push to `dev`.
* Open a Pull Request `dev → main` when a release is ready. CI runs on the PR.
* Merging the PR (or pushing) into `main` triggers the deploy workflow.
* **Protect `main`** in *GitHub → Settings → Branches → Branch protection rules*:
  * "Require a pull request before merging" ✓
  * "Require status checks to pass" ✓ (select **CI / backend**, **CI / frontend**, **CI / docker**)
  * "Do not allow bypassing the above settings" ✓

---

## Server requirements

* Ubuntu 22.04 LTS (or newer) with sudo access.
* Ports `80` and `443` open inbound (no other public ports).
* Docker Engine ≥ 24 and the Docker Compose plugin (`docker compose version`).
* `git` available on the system PATH.
* DNS `A` record `lksystem.therapybylk.com → <VPS public IP>`.
* Repo cloned to `/opt/lksystem` (path is referenced by the cert-renewal hook).

---

## First-time bootstrap

```bash
sudo mkdir -p /opt && sudo chown "$USER":"$USER" /opt
git clone git@github.com:<org>/<repo>.git /opt/lksystem
cd /opt/lksystem

# 1. Configure secrets.
cp deploy/lksystem.env.example deploy/lksystem.env
nano deploy/lksystem.env            # fill SECRET_KEY, DB password, email creds, etc.

# 2. Issue the TLS certificate (stops the frontend container automatically
#    so certbot can bind port 80; reinstalls a renewal hook).
sudo LETSENCRYPT_EMAIL=admin@therapybylk.com DOMAIN=lksystem.therapybylk.com \
  ./deploy/install-ssl-certificate.sh

# 3. Build and start the stack.
./deploy/deploy-production.sh

# 4. (Optional) bootstrap the first super-admin if you set
#    AUTO_CREATE_DEFAULT_ADMIN=true in the env; flip it back to ``false``
#    once the account exists.
```

The frontend container mounts `/etc/letsencrypt` read-only, so a `certbot`
renewal followed by a frontend restart is enough — no rebuild needed.

---

## Recurring deploys

CI/CD handles this. When a commit lands on `main`:

1. `.github/workflows/deploy.yml` rebuilds backend & frontend images one more time as a safety net.
2. It SSHes into the VPS using the `production` GitHub Environment secrets.
3. On the VPS it runs:
   ```bash
   git fetch --all --prune
   git reset --hard origin/main
   ./deploy/deploy-production.sh
   docker image prune -f
   ```
4. It probes `https://<DOMAIN>/health` until it answers `200`, then a final
   `GET /api/v1/` to confirm the backend is up.

Manual fallback (e.g. cert hot-swap, hot-patch from a maintenance branch):

```bash
ssh <user>@<vps>
cd /opt/lksystem
git pull
./deploy/deploy-production.sh
```

---

## Required GitHub Secrets

Configure these under **GitHub → Settings → Environments → production**:

| Secret | Example | Notes |
| --- | --- | --- |
| `SSH_HOST` | `vps.lksystem.therapybylk.com` | Public hostname or IP of the VPS. |
| `SSH_USER` | `deploy` | Recommended: a dedicated `deploy` user in the `docker` group. |
| `SSH_PORT` | `22` *(optional)* | Set only if you've moved SSH off port 22. |
| `SSH_PRIVATE_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----…` | A new ed25519 key generated **only** for CI. Public half goes into `~/.ssh/authorized_keys` on the VPS. |
| `VPS_PROJECT_PATH` | `/opt/lksystem` | Where the repo is cloned. |
| `PRODUCTION_DOMAIN` | `lksystem.therapybylk.com` | Used by the health-check step. |

Generate the CI deploy key on a workstation:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./ci_deploy_key
cat ./ci_deploy_key.pub      # paste into ~/.ssh/authorized_keys on the VPS
cat ./ci_deploy_key          # paste into the SSH_PRIVATE_KEY secret
rm ci_deploy_key ci_deploy_key.pub
```

---

## VPS security hardening (one-time)

```bash
# 1. Firewall: only SSH + HTTP + HTTPS in.
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# 2. Brute-force shield for SSH.
sudo apt-get install -y fail2ban
sudo systemctl enable --now fail2ban

# 3. Disable password SSH (keys only).
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/'                    /etc/ssh/sshd_config
sudo systemctl restart ssh

# 4. Unattended OS security updates.
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

PostgreSQL and Redis are **not** exposed publicly — they live on the
internal `app_net` Docker network. Nginx is the only public surface.

---

## What lives where on the VPS

```
/opt/lksystem/
├── deploy/lksystem.env       # gitignored, the only place real secrets live
└── …repo files…

Docker volumes (managed by Docker, persisted across rebuilds):
  postgres_data     →  /var/lib/postgresql/data in the db container
  redis_data        →  /data in the redis container
  static_volume     →  /app/staticfiles in backend (collectstatic output)
  media_volume      →  /app/mediafiles  in backend (user uploads)

TLS:
  /etc/letsencrypt/live/lksystem.therapybylk.com/fullchain.pem
  /etc/letsencrypt/live/lksystem.therapybylk.com/privkey.pem
  /etc/letsencrypt/renewal-hooks/deploy/lksystem-reload.sh   # auto-restarts frontend on renewal
```

Backing up the VPS = dumping `postgres_data` (e.g. `pg_dump`) + tarring `media_volume`.

---

## Troubleshooting

```bash
# All container health at a glance
docker compose --env-file deploy/lksystem.env -f docker-compose.prod.yml ps

# Tail backend logs
docker compose --env-file deploy/lksystem.env -f docker-compose.prod.yml logs -f backend

# Force a clean rebuild
./deploy/deploy-production.sh

# Renew TLS manually (the cron renewal runs daily already)
sudo certbot renew --quiet
```
