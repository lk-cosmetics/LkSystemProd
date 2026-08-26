#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Let's Encrypt *deploy* hook — installed by deploy/install-ssl-certificate.sh
# to /etc/letsencrypt/renewal-hooks/deploy/lksystem-reload.sh
#
# certbot runs every script in that directory ONCE per certificate that was
# actually renewed (never on a no-op renewal check), with $RENEWED_LINEAGE /
# $RENEWED_DOMAINS set.
#
# Its single job: make the running nginx pick up the new certificate.
# nginx reads certificates into memory at configuration load, so a renewed
# file on disk changes nothing until nginx is told to reload. `nginx -s reload`
# is a graceful, zero-downtime reload: the master spawns new workers with the
# new certificate and retires the old workers once their connections drain.
#
# Restarting the container is only a FALLBACK for when the reload is not
# possible (container stopped / exec unavailable), because that one does cause
# a brief connection blip.
# ---------------------------------------------------------------------------
set -uo pipefail

# Non-secret deployment coordinates written by install-ssl-certificate.sh.
# shellcheck source=/dev/null
[[ -r /etc/default/lksystem-ssl ]] && . /etc/default/lksystem-ssl

LKSYSTEM_DIR="${LKSYSTEM_DIR:-/opt/lksystem}"
LKSYSTEM_COMPOSE_FILE="${LKSYSTEM_COMPOSE_FILE:-docker-compose.prod.yml}"
LKSYSTEM_ENV_FILE="${LKSYSTEM_ENV_FILE:-deploy/lksystem.env}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-lksystem_prod_frontend}"
LOG_FILE="${SSL_RENEWAL_LOG:-/var/log/lksystem/ssl-renewal.log}"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

log() {
  local line
  line="$(date '+%Y-%m-%dT%H:%M:%S%z') [lksystem-ssl-hook] $*"
  echo "$line"
  echo "$line" >>"$LOG_FILE" 2>/dev/null || true
}

log "Deploy hook started (renewed lineage: ${RENEWED_LINEAGE:-n/a}, domains: ${RENEWED_DOMAINS:-n/a})"

if ! command -v docker >/dev/null 2>&1; then
  log "ERROR: docker not on PATH — cannot reload nginx. New certificate is on disk but NOT served."
  exit 1
fi

# ── Strategy 1: graceful in-place reload (no downtime) ─────────────────────
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$FRONTEND_CONTAINER"; then
  # Validate BEFORE reloading: a reload with a broken config is refused by
  # nginx and leaves the old workers running, but testing first gives a much
  # clearer log line about what went wrong.
  if docker exec "$FRONTEND_CONTAINER" nginx -t >>"$LOG_FILE" 2>&1; then
    if docker exec "$FRONTEND_CONTAINER" nginx -s reload >>"$LOG_FILE" 2>&1; then
      log "nginx reloaded gracefully in $FRONTEND_CONTAINER — new certificate is live."
      exit 0
    fi
    log "WARNING: 'nginx -s reload' failed; falling back to a container restart."
  else
    log "WARNING: 'nginx -t' failed inside $FRONTEND_CONTAINER; falling back to a container restart."
  fi
else
  log "WARNING: container $FRONTEND_CONTAINER is not running; falling back to compose."
fi

# ── Strategy 2: bring the frontend back through compose ────────────────────
if [[ -d "$LKSYSTEM_DIR" ]]; then
  cd "$LKSYSTEM_DIR" || { log "ERROR: cannot cd to $LKSYSTEM_DIR"; exit 1; }
  # --force-recreate is deliberate: a plain 'up -d' is a NO-OP when the service
  # definition has not changed, so nginx would keep serving the OLD certificate
  # from memory. That silent no-op is exactly how expired certs reach users.
  # Exported (not prefixed) so compose interpolation inside the file sees it.
  export LKSYSTEM_ENV_FILE
  if docker compose --env-file "$LKSYSTEM_ENV_FILE" -f "$LKSYSTEM_COMPOSE_FILE" \
       up -d --force-recreate frontend >>"$LOG_FILE" 2>&1; then
    log "Frontend recreated via docker compose — new certificate is live."
    exit 0
  fi
  log "WARNING: docker compose up -d --force-recreate frontend failed."
fi

# ── Strategy 3: last resort, plain container restart ───────────────────────
if docker restart "$FRONTEND_CONTAINER" >>"$LOG_FILE" 2>&1; then
  log "Frontend container restarted — new certificate is live."
  exit 0
fi

log "ERROR: every reload strategy failed. The renewed certificate is on disk but nginx is still serving the old one."
log "ERROR: Fix manually:  cd $LKSYSTEM_DIR && docker compose -f $LKSYSTEM_COMPOSE_FILE up -d --force-recreate frontend"
exit 1
