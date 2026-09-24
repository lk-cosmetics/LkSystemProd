#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# LkSystem TLS bootstrap + renewal wiring (idempotent).
#
# Safe to run repeatedly. It handles BOTH cases:
#
#   1. No certificate yet  -> issues one via ACME HTTP-01 (webroot).
#   2. Certificate exists  -> leaves it alone, but (re)installs and repairs the
#                             automatic-renewal wiring.
#
# Renewal strategy: --webroot, NOT --standalone.
#
#   --standalone makes certbot bind port 80 itself. In this stack port 80 is
#   permanently owned by the `frontend` nginx container (restart:
#   unless-stopped), so every unattended `certbot renew` fails with
#   "Could not bind TCP port 80" and the certificate silently marches to
#   expiry. --webroot instead drops the challenge token in a directory that
#   the ALREADY-RUNNING nginx serves, so renewal needs no port, no downtime
#   and no manual intervention.
#
# Usage:
#   sudo LETSENCRYPT_EMAIL=admin@example.com DOMAIN=lksystem.therapybylk.com \
#     ./deploy/install-ssl-certificate.sh
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DOMAIN="${DOMAIN:-lksystem.therapybylk.com}"
EMAIL="${LETSENCRYPT_EMAIL:-}"
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/certbot}"
COMPOSE_FILE="${LKSYSTEM_COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${LKSYSTEM_ENV_FILE:-deploy/lksystem.env}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-lksystem_prod_frontend}"
LOG_DIR="/var/log/lksystem"
LOG_FILE="$LOG_DIR/ssl-install.log"
RENEWAL_LOG="$LOG_DIR/ssl-renewal.log"
# Opt-in escape hatch for a first issuance on a host where nginx cannot serve
# the challenge at all. Briefly stops the frontend so certbot can bind :80.
ALLOW_STANDALONE_FALLBACK="${ALLOW_STANDALONE_FALLBACK:-false}"

mkdir -p "$LOG_DIR"

log()  { local l; l="$(date '+%Y-%m-%dT%H:%M:%S%z') [ssl-install] $*"; echo "$l"; echo "$l" >>"$LOG_FILE"; }
fail() { log "ERROR: $*"; exit 1; }

trap 'rc=$?; if [[ $rc -ne 0 ]]; then log "FAILED with exit code $rc (see $LOG_FILE)"; fi' EXIT

# ── Preconditions ──────────────────────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]] || fail "Run with sudo: certbot needs to write /etc/letsencrypt."
[[ -n "$EMAIL" ]] || fail "Set LETSENCRYPT_EMAIL (used only for Let's Encrypt expiry notices)."

log "Domain: $DOMAIN | webroot: $ACME_WEBROOT | project: $ROOT_DIR"

if ! command -v certbot >/dev/null 2>&1; then
  log "certbot not found - installing from apt."
  apt-get update -qq
  apt-get install -y -qq certbot
fi
command -v docker >/dev/null 2>&1 || fail "docker is required but not on PATH."

# ── Port 80 sanity check ───────────────────────────────────────────────────
# A host-level nginx/apache squatting on :80 would keep the frontend container
# from ever binding it, which breaks both the challenge and the site itself.
if command -v ss >/dev/null 2>&1; then
  port80_owner="$(ss -lntpH 'sport = :80' 2>/dev/null | awk '{print $NF}' | tr '\n' ' ')"
  if [[ -n "$port80_owner" ]] && ! grep -qE 'docker|nginx' <<<"$port80_owner"; then
    log "WARNING: port 80 is held by: $port80_owner"
    log "WARNING: it must be the frontend container. Stop the conflicting service first."
  fi
fi
for svc in nginx apache2; do
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    log "WARNING: host service '$svc' is active and will conflict with the frontend container on :80/:443."
  fi
done

# ── Webroot + running nginx ────────────────────────────────────────────────
install -d -m 755 "$ACME_WEBROOT" "$ACME_WEBROOT/.well-known" "$ACME_WEBROOT/.well-known/acme-challenge"

compose() {
  LKSYSTEM_ENV_FILE="$ENV_FILE" DOMAIN="$DOMAIN" \
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

if ! docker ps --format '{{.Names}}' | grep -qx "$FRONTEND_CONTAINER"; then
  log "Frontend container is not running - starting it so it can serve the ACME challenge."
  if [[ -f "$ENV_FILE" ]]; then
    compose up -d frontend >>"$LOG_FILE" 2>&1 || log "WARNING: could not start the frontend via compose."
  else
    log "WARNING: $ENV_FILE is missing; cannot start the stack automatically."
  fi
fi

# ── Prove the challenge path really works before asking Let's Encrypt ──────
# Doing this first turns "mysterious ACME failure + a burnt rate-limit slot"
# into a clear, local, free diagnostic.
webroot_reachable() {
  local token="lksystem-selftest-$$-${RANDOM}"
  local file="$ACME_WEBROOT/.well-known/acme-challenge/$token"
  printf 'lksystem-webroot-ok' >"$file"
  chmod 644 "$file"
  local body=""
  body="$(curl -fsS --max-time 15 "http://${DOMAIN}/.well-known/acme-challenge/${token}" 2>>"$LOG_FILE" || true)"
  rm -f "$file"
  [[ "$body" == "lksystem-webroot-ok" ]]
}

USE_WEBROOT=true
if webroot_reachable; then
  log "Webroot self-test passed: http://${DOMAIN}/.well-known/acme-challenge/ is served by nginx."
else
  log "WARNING: webroot self-test FAILED - nginx did not serve the challenge token."
  log "WARNING: check (a) DNS A record for $DOMAIN, (b) inbound :80 in the firewall,"
  log "WARNING: (c) the frontend container is up, (d) the $ACME_WEBROOT bind-mount."
  if [[ "$ALLOW_STANDALONE_FALLBACK" == "true" ]]; then
    USE_WEBROOT=false
    log "ALLOW_STANDALONE_FALLBACK=true - falling back to --standalone for this issuance."
    log "NOTE: renewal will still be reconfigured to webroot afterwards."
  else
    fail "Refusing to continue: renewal would fail the same way later. Fix the above, or re-run with ALLOW_STANDALONE_FALLBACK=true for a one-off issuance."
  fi
fi

# ── Install the deploy hook FIRST ──────────────────────────────────────────
# Order matters. The certonly call below can itself trigger a renewal, and
# certbot runs whatever deploy hook is on disk AT THAT MOMENT. Installing the
# hook afterwards would let a stale hook handle that first renewal - which is
# exactly the no-op 'docker compose up -d frontend' this change exists to kill,
# leaving nginx serving the old certificate until someone reloads it by hand.
cat >/etc/default/lksystem-ssl <<EOF
# Non-secret deployment coordinates for the LkSystem TLS renewal hook.
# Written by deploy/install-ssl-certificate.sh - safe to edit.
LKSYSTEM_DIR=$ROOT_DIR
LKSYSTEM_COMPOSE_FILE=$COMPOSE_FILE
LKSYSTEM_ENV_FILE=$ENV_FILE
FRONTEND_CONTAINER=$FRONTEND_CONTAINER
SSL_RENEWAL_LOG=$RENEWAL_LOG
EOF
chmod 644 /etc/default/lksystem-ssl

install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
install -m 755 "$ROOT_DIR/deploy/letsencrypt-deploy-hook.sh" \
  /etc/letsencrypt/renewal-hooks/deploy/lksystem-reload.sh
log "Deploy hook installed at /etc/letsencrypt/renewal-hooks/deploy/lksystem-reload.sh"

# ── Issue (or keep) the certificate ────────────────────────────────────────
LIVE_DIR="/etc/letsencrypt/live/$DOMAIN"
if [[ -f "$LIVE_DIR/fullchain.pem" ]]; then
  log "Certificate already present at $LIVE_DIR - keeping it (renewal wiring is repaired below)."
else
  log "No certificate found - requesting one from Let's Encrypt."
fi

certbot_common=(
  certonly
  --non-interactive
  --agree-tos
  --email "$EMAIL"
  --keep-until-expiring
  --cert-name "$DOMAIN"
  -d "$DOMAIN"
)

if [[ "$USE_WEBROOT" == "true" ]]; then
  certbot "${certbot_common[@]}" --webroot -w "$ACME_WEBROOT" 2>&1 | tee -a "$LOG_FILE"
else
  # One-off standalone issuance: stop the frontend only for the seconds certbot
  # needs :80, and bring it back no matter how certbot exits.
  log "Stopping the frontend for the standalone challenge (brief downtime)."
  compose stop frontend >>"$LOG_FILE" 2>&1 || true
  set +e
  certbot "${certbot_common[@]}" --standalone 2>&1 | tee -a "$LOG_FILE"
  cb_rc=${PIPESTATUS[0]}
  set -e
  log "Restarting the frontend."
  compose up -d frontend >>"$LOG_FILE" 2>&1 || true
  [[ $cb_rc -eq 0 ]] || fail "certbot standalone issuance failed (exit $cb_rc)."
fi

[[ -f "$LIVE_DIR/fullchain.pem" ]] || fail "certbot reported success but $LIVE_DIR/fullchain.pem is missing."

# ── Force the stored renewal parameters to webroot ─────────────────────────
# THIS is the fix for the recurring failure. certbot renews using whatever is
# recorded in /etc/letsencrypt/renewal/<domain>.conf, NOT the flags passed
# here - so a lineage originally issued with --standalone keeps trying to bind
# port 80 forever. Re-running certonly does not rewrite those params when the
# certificate is not yet due for renewal, so rewrite them explicitly.
RENEWAL_CONF="/etc/letsencrypt/renewal/$DOMAIN.conf"
if [[ -f "$RENEWAL_CONF" ]]; then
  cp -a "$RENEWAL_CONF" "$RENEWAL_CONF.bak.$(date +%Y%m%d%H%M%S)"
  python3 - "$RENEWAL_CONF" "$ACME_WEBROOT" "$DOMAIN" <<'PYEOF'
import re
import sys

conf_path, webroot, domain = sys.argv[1], sys.argv[2], sys.argv[3]
with open(conf_path, encoding="utf-8") as fh:
    lines = fh.read().splitlines()

out, skipping_map = [], False
for line in lines:
    stripped = line.strip()
    # Drop any pre-existing [[webroot_map]] block; it is rebuilt below.
    if stripped.startswith("[[webroot_map]]"):
        skipping_map = True
        continue
    if skipping_map:
        if stripped.startswith("["):
            skipping_map = False
        else:
            continue
    if re.match(r"\s*(authenticator|installer|webroot_path)\s*=", line):
        continue
    out.append(line)

while out and not out[-1].strip():
    out.pop()

try:
    idx = out.index("[renewalparams]")
except ValueError:
    out.append("[renewalparams]")
    idx = len(out) - 1

out.insert(idx + 1, "webroot_path = %s," % webroot)
out.insert(idx + 1, "authenticator = webroot")
out += ["", "[[webroot_map]]", "%s = %s" % (domain, webroot)]

with open(conf_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(out) + "\n")
print("renewal config rewritten for webroot: %s" % conf_path)
PYEOF
  chmod 644 "$RENEWAL_CONF"
  grep -q '^authenticator = webroot$' "$RENEWAL_CONF" \
    || fail "Failed to set authenticator=webroot in $RENEWAL_CONF."
  log "Renewal parameters pinned to webroot in $RENEWAL_CONF."
else
  log "WARNING: $RENEWAL_CONF not found - certbot may be using a different cert name."
fi

# ── Make sure something actually runs `certbot renew` on a schedule ────────
# The Debian/Ubuntu certbot package ships either a systemd timer or a cron
# entry. Enable whichever is present; only add our own when neither exists, so
# we never end up with two competing renewal schedules.
RENEWAL_SCHEDULER="none"
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^certbot\.timer'; then
  systemctl enable --now certbot.timer >>"$LOG_FILE" 2>&1 || true
  RENEWAL_SCHEDULER="certbot.timer"
elif command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^snap\.certbot\.renew\.timer'; then
  systemctl enable --now snap.certbot.renew.timer >>"$LOG_FILE" 2>&1 || true
  RENEWAL_SCHEDULER="snap.certbot.renew.timer"
elif [[ -f /etc/cron.d/certbot ]]; then
  RENEWAL_SCHEDULER="/etc/cron.d/certbot"
fi

if [[ "$RENEWAL_SCHEDULER" == "none" ]]; then
  log "No packaged renewal schedule found - installing /etc/cron.d/lksystem-certbot."
  cat >/etc/cron.d/lksystem-certbot <<EOF
# LkSystem: renew the Let's Encrypt certificate automatically.
# Twice daily at a randomised offset, as Let's Encrypt recommends. Renewal is a
# no-op until the certificate enters its 30-day renewal window.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
17 3,15 * * * root sleep \$((RANDOM \% 1800)) && certbot -q renew >>$RENEWAL_LOG 2>&1
EOF
  chmod 644 /etc/cron.d/lksystem-certbot
  RENEWAL_SCHEDULER="/etc/cron.d/lksystem-certbot"
else
  # A packaged schedule exists - drop ours if an earlier run installed one.
  rm -f /etc/cron.d/lksystem-certbot
fi
log "Automatic renewal scheduler: $RENEWAL_SCHEDULER"

# Keep the renewal log from growing without bound.
cat >/etc/logrotate.d/lksystem-ssl <<EOF
$LOG_DIR/*.log {
    monthly
    rotate 12
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
}
EOF
chmod 644 /etc/logrotate.d/lksystem-ssl

# ── Validate the whole chain end to end ────────────────────────────────────
log "Running 'certbot renew --dry-run' against the staging endpoint..."
if certbot renew --dry-run --cert-name "$DOMAIN" 2>&1 | tee -a "$LOG_FILE" | grep -q "simulated renewal"; then
  log "Dry-run succeeded: unattended renewal works without touching the running stack."
else
  log "WARNING: the renewal dry-run did not report success - inspect $LOG_FILE."
fi

EXPIRY="$(openssl x509 -enddate -noout -in "$LIVE_DIR/fullchain.pem" | cut -d= -f2)"
log "Certificate for $DOMAIN is valid until: $EXPIRY"
log "Certificate paths: $LIVE_DIR/fullchain.pem, $LIVE_DIR/privkey.pem"
log "Done. Next: ./deploy/deploy-production.sh"
