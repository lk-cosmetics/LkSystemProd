#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="deploy/lksystem.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy deploy/lksystem.env.example to deploy/lksystem.env and fill the secrets."
  exit 1
fi

set -a
source "$ENV_FILE"
export LKSYSTEM_ENV_FILE="$ENV_FILE"
set +a

DOMAIN="${DOMAIN:-lksystem.therapybylk.com}"
# The cert lives under /etc/letsencrypt/{live,archive}, which certbot keeps
# root-only. nginx still receives it via the root Docker daemon's bind-mount of
# /etc/letsencrypt (see docker-compose.prod.yml), so this script works fine when
# run by an unprivileged docker-group user — e.g. the CI deploy over SSH.
# Only enforce the fail-fast existence check when we are root and can actually
# read the path; a non-root run would false-negative here. A genuinely missing
# cert still surfaces via the post-deploy health check.
if [[ "$(id -u)" -eq 0 && ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  echo "Missing certificate for $DOMAIN."
  echo "Run: sudo LETSENCRYPT_EMAIL=you@example.com DOMAIN=$DOMAIN ./deploy/install-ssl-certificate.sh"
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml build
# If a container never becomes healthy, `up -d` exits non-zero with only
# "dependency ... is unhealthy". Dump the backend logs so the REAL startup
# error (traceback, failed migration, etc.) is visible in the deploy output.
if ! docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml up -d; then
  echo "──────────────────────────────────────────────────────────────"
  echo "Startup failed (a container did not become healthy). Backend logs:"
  echo "──────────────────────────────────────────────────────────────"
  docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml logs --tail=200 backend || true
  exit 1
fi
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T backend python manage.py check
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T backend python manage.py seed_rbac

echo "Deployment complete: https://$DOMAIN"
