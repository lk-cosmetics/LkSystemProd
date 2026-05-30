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
if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  echo "Missing certificate for $DOMAIN."
  echo "Run: sudo LETSENCRYPT_EMAIL=you@example.com DOMAIN=$DOMAIN ./deploy/install-ssl-certificate.sh"
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml build
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml up -d
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T backend python manage.py check
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T backend python manage.py seed_rbac

echo "Deployment complete: https://$DOMAIN"
