#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-lksystem.therapybylk.com}"
EMAIL="${LETSENCRYPT_EMAIL:-}"

if [[ -z "$EMAIL" ]]; then
  echo "Set LETSENCRYPT_EMAIL before running this script."
  echo "Example: LETSENCRYPT_EMAIL=admin@example.com DOMAIN=$DOMAIN ./deploy/install-ssl-certificate.sh"
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this script with sudo so certbot can bind port 80 and write /etc/letsencrypt."
  exit 1
fi

if ! command -v certbot >/dev/null 2>&1; then
  apt-get update
  apt-get install -y certbot
fi

if command -v docker >/dev/null 2>&1 && [[ -f deploy/lksystem.env ]]; then
  LKSYSTEM_ENV_FILE=deploy/lksystem.env docker compose --env-file deploy/lksystem.env -f docker-compose.prod.yml stop frontend || true
fi

certbot certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL" \
  --keep-until-expiring \
  -d "$DOMAIN"

install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat >/etc/letsencrypt/renewal-hooks/deploy/lksystem-reload.sh <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/lksystem
LKSYSTEM_ENV_FILE=deploy/lksystem.env docker compose --env-file deploy/lksystem.env -f docker-compose.prod.yml up -d frontend
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/lksystem-reload.sh

echo "TLS certificate installed for $DOMAIN."
echo "Next: ./deploy/deploy-production.sh"
