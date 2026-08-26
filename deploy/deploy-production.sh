#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Rebuild and restart the production stack, idempotently.
#
# Runs both interactively (as root or as a docker-group user) and unattended
# from the GitHub Actions SSH deploy. Every step is logged with a timestamp to
# stdout and, when writable, to /var/log/lksystem/deploy.log.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="deploy/lksystem.env"
COMPOSE_FILE="docker-compose.prod.yml"
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/certbot}"
LOG_FILE="/var/log/lksystem/deploy.log"

# Best-effort log file: an unprivileged CI user may not be able to create it,
# in which case we simply log to stdout (captured by the Actions run anyway).
if mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null && touch "$LOG_FILE" 2>/dev/null; then
  :
else
  LOG_FILE=""
fi

log() {
  local l
  l="$(date '+%Y-%m-%dT%H:%M:%S%z') [deploy] $*"
  echo "$l"
  [[ -n "$LOG_FILE" ]] && echo "$l" >>"$LOG_FILE" 2>/dev/null || true
}
fail() { log "ERROR: $*"; exit 1; }

trap 'rc=$?; if [[ $rc -ne 0 ]]; then log "DEPLOY FAILED with exit code $rc"; fi' EXIT

if [[ ! -f "$ENV_FILE" ]]; then
  fail "Missing $ENV_FILE. Copy deploy/lksystem.env.example to $ENV_FILE and fill the secrets."
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
export LKSYSTEM_ENV_FILE="$ENV_FILE"
set +a

DOMAIN="${DOMAIN:-lksystem.therapybylk.com}"
export DOMAIN ACME_WEBROOT
LIVE_DIR="/etc/letsencrypt/live/$DOMAIN"

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

log "Deploying $DOMAIN from $ROOT_DIR (commit $(git rev-parse --short HEAD 2>/dev/null || echo unknown))"

# ── TLS pre-flight ─────────────────────────────────────────────────────────
# /etc/letsencrypt/{live,archive} is root-only, so a non-root deploy user
# genuinely cannot stat the certificate even though nginx receives it fine via
# the root Docker daemon's bind-mount. Only assert when we can actually read.
if [[ "$(id -u)" -eq 0 ]]; then
  if [[ -f "$LIVE_DIR/fullchain.pem" ]]; then
    expiry="$(openssl x509 -enddate -noout -in "$LIVE_DIR/fullchain.pem" 2>/dev/null | cut -d= -f2 || echo unknown)"
    log "TLS certificate found for $DOMAIN (expires: $expiry)"
    # 0 = "will still be valid in 21 days". Anything else means the automatic
    # renewal has not run, or has been failing silently.
    if ! openssl x509 -checkend $((21 * 86400)) -noout -in "$LIVE_DIR/fullchain.pem" >/dev/null 2>&1; then
      log "WARNING: the certificate expires within 21 days and has not auto-renewed."
      log "WARNING: run 'sudo certbot renew' and check /var/log/lksystem/ssl-renewal.log."
    fi
  else
    # Not fatal any more: the frontend boots with a temporary self-signed cert
    # (SSL_BOOTSTRAP_SELF_SIGNED) precisely so port 80 stays up and the ACME
    # challenge can be answered. Failing here instead would deadlock the host.
    log "WARNING: no certificate at $LIVE_DIR - nginx will start with a TEMPORARY self-signed cert."
    log "WARNING: issue the real one with:"
    log "WARNING:   sudo LETSENCRYPT_EMAIL=you@example.com DOMAIN=$DOMAIN ./deploy/install-ssl-certificate.sh"
  fi
  # The webroot must exist before compose starts, otherwise Docker creates the
  # bind-mount source itself and certbot's tokens land somewhere nginx cannot
  # see. Harmless when it already exists.
  install -d -m 755 "$ACME_WEBROOT/.well-known/acme-challenge" 2>/dev/null || true
fi

# ── Build & start ──────────────────────────────────────────────────────────
log "Building images..."
compose build

log "Starting containers..."
# If a container never becomes healthy, `up -d` exits non-zero with only
# "dependency ... is unhealthy". Dump the logs so the REAL startup error
# (traceback, failed migration, bad cert path) is visible in the deploy output.
if ! compose up -d; then
  log "Startup failed (a container did not become healthy). Recent logs:"
  compose logs --tail=200 backend || true
  compose logs --tail=50 frontend || true
  fail "docker compose up failed."
fi

log "Running Django checks..."
compose exec -T backend python manage.py check
compose exec -T backend python manage.py seed_rbac

# ── Post-deploy validation ─────────────────────────────────────────────────
log "Validating the nginx configuration..."
if compose exec -T frontend nginx -t; then
  log "nginx configuration is valid."
else
  compose logs --tail=50 frontend || true
  fail "nginx configuration test failed."
fi

# Ask the live TLS socket what it is actually serving, rather than trusting
# the configured path. This also exposes the bootstrap self-signed cert
# (issuer O=LKSystem) instead of quietly reporting a healthy deploy.
log "Inspecting the certificate nginx actually serves..."
served="$(compose exec -T frontend sh -c "echo | openssl s_client -connect 127.0.0.1:443 -servername $DOMAIN 2>/dev/null | openssl x509 -noout -enddate -issuer" 2>/dev/null || true)"
if [[ -n "$served" ]]; then
  while IFS= read -r line; do log "  $line"; done <<<"$served"
  if grep -q "O *= *LKSystem" <<<"$served"; then
    log "WARNING: nginx is serving the TEMPORARY self-signed certificate, not Let's Encrypt."
    log "WARNING: run: sudo LETSENCRYPT_EMAIL=you@example.com DOMAIN=$DOMAIN ./deploy/install-ssl-certificate.sh"
  fi
else
  log "WARNING: could not read the served certificate - check the frontend logs."
fi

# The ACME path must answer over plain HTTP without redirecting, or the
# unattended webroot renewal breaks. Assert it on the RENDERED config, then
# confirm the live behaviour over loopback.
if compose exec -T frontend grep -q "acme-challenge" /etc/nginx/conf.d/default.conf; then
  log "ACME challenge location is present in the rendered nginx config."
else
  log "WARNING: no ACME challenge location in the rendered nginx config - renewal WILL fail."
fi

if command -v curl >/dev/null 2>&1; then
  # A missing token must yield 404 (served directly). A 301/302 means the
  # catch-all HTTPS redirect is swallowing the challenge.
  acme_probe_url="http://127.0.0.1/.well-known/acme-challenge/deploy-probe"
  acme_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$acme_probe_url" || echo 000)"
  case "$acme_code" in
    404) log "ACME challenge path answers 404 for a missing token - correct." ;;
    301|302) log "WARNING: /.well-known/acme-challenge/ redirects ($acme_code) - renewal will fail." ;;
    *) log "ACME challenge probe returned HTTP $acme_code." ;;
  esac

  # ── HTTPS smoke test ────────────────────────────────────────────────────
  https_code="000"
  for attempt in 1 2 3 4 5; do
    sleep "$attempt"
    https_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/health" || echo 000)"
    if [[ "$https_code" == "200" ]]; then
      break
    fi
  done
  if [[ "$https_code" == "200" ]]; then
    log "HTTPS smoke test passed: https://$DOMAIN/health -> 200 with a valid chain."
  else
    # curl validates the chain by default, so a failure here is either a bad
    # certificate or the app not being reachable from this host.
    log "WARNING: https://$DOMAIN/health returned $https_code (TLS or reachability problem)."
    curl -sS -o /dev/null --max-time 15 "https://$DOMAIN/health" 2>&1 | while read -r line; do
      log "WARNING: curl: $line"
    done
  fi
fi

log "Deployment complete: https://$DOMAIN"
