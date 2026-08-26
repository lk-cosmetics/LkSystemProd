#!/bin/sh
# ---------------------------------------------------------------------------
# nginx TLS entrypoint.
#
# Two distinct modes:
#
#   * Development / LAN (ENABLE_SELF_SIGNED_SSL=true) — mint a long-lived
#     self-signed certificate once and keep reusing it.
#
#   * Production (ENABLE_SELF_SIGNED_SSL=false) — use the Let's Encrypt
#     certificate bind-mounted read-only from the host at
#     /etc/letsencrypt/live/<domain>/. If that certificate is not there yet,
#     fall back to a THROWAWAY self-signed cert instead of refusing to boot
#     (see SSL_BOOTSTRAP_SELF_SIGNED below).
#
# Why the bootstrap fallback exists: certbot answers the ACME HTTP-01
# challenge through this very nginx (webroot mode, /.well-known/acme-challenge).
# If nginx refuses to start when the certificate is missing, port 80 is dead,
# the challenge cannot be served, and the certificate can never be issued —
# a deadlock that can only be broken by hand. Booting with a temporary cert
# keeps port 80 alive so the real certificate can be obtained, after which a
# reload swaps it in.
# ---------------------------------------------------------------------------
set -e

CERT_DIR="/etc/nginx/ssl"
CERT_FILE="${SSL_CERTIFICATE:-$CERT_DIR/selfsigned.crt}"
KEY_FILE="${SSL_CERTIFICATE_KEY:-$CERT_DIR/selfsigned.key}"
ENABLE_SELF_SIGNED_SSL="${ENABLE_SELF_SIGNED_SSL:-true}"
SSL_BOOTSTRAP_SELF_SIGNED="${SSL_BOOTSTRAP_SELF_SIGNED:-false}"

log() { echo "[ssl-entrypoint] $*"; }

is_true() {
  case "$1" in
    true|True|TRUE|1|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

# Mint a self-signed pair at $1 (cert) / $2 (key), valid for $3 days.
generate_self_signed() {
  _cert="$1"; _key="$2"; _days="$3"
  mkdir -p "$(dirname "$_cert")" "$(dirname "$_key")"
  # Container IP goes into the SAN list so LAN clients hitting the raw IP get
  # a matching certificate instead of a name-mismatch error.
  LOCAL_IP=$(hostname -i 2>/dev/null | awk '{print $1}' || echo "")
  openssl req -x509 -nodes -days "$_days" \
    -newkey rsa:2048 \
    -keyout "$_key" \
    -out "$_cert" \
    -subj "/C=TN/ST=Local/L=Local/O=LKSystem/CN=${PUBLIC_DOMAIN:-lksystem.local}" \
    -addext "subjectAltName=DNS:localhost,DNS:*.local,DNS:${PUBLIC_DOMAIN:-lksystem.local},IP:127.0.0.1,IP:192.168.8.170,IP:192.168.1.252,IP:192.168.1.1,IP:10.0.0.1${LOCAL_IP:+,IP:$LOCAL_IP}" \
    >/dev/null 2>&1
  chmod 600 "$_key"
}

# ── Development / LAN: persistent self-signed certificate ──────────────────
if is_true "$ENABLE_SELF_SIGNED_SSL" && { [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; }; then
  log "Generating self-signed SSL certificate for LAN access..."
  generate_self_signed "$CERT_FILE" "$KEY_FILE" 3650
  log "Self-signed certificate generated (valid for 10 years)."
fi

# ── Production: real certificate, or a temporary one so we can go get it ───
if [ ! -r "$CERT_FILE" ] || [ ! -r "$KEY_FILE" ]; then
  if is_true "$SSL_BOOTSTRAP_SELF_SIGNED"; then
    log "WARNING: TLS certificate not readable — serving a TEMPORARY self-signed certificate."
    log "WARNING:   expected cert: $CERT_FILE"
    log "WARNING:   expected key : $KEY_FILE"
    log "WARNING: Browsers WILL show a warning until the real certificate is in place."
    log "WARNING: Port 80 stays up on purpose so certbot can complete the HTTP-01"
    log "WARNING: challenge. Run: sudo ./deploy/install-ssl-certificate.sh"
    BOOTSTRAP_CERT="$CERT_DIR/bootstrap.crt"
    BOOTSTRAP_KEY="$CERT_DIR/bootstrap.key"
    # Always regenerate: a stale bootstrap cert from a previous boot may have
    # expired, and it costs milliseconds to mint a fresh one.
    generate_self_signed "$BOOTSTRAP_CERT" "$BOOTSTRAP_KEY" 30
    SSL_CERTIFICATE="$BOOTSTRAP_CERT"
    SSL_CERTIFICATE_KEY="$BOOTSTRAP_KEY"
    export SSL_CERTIFICATE SSL_CERTIFICATE_KEY
  else
    log "ERROR: TLS certificate not found."
    log "ERROR:   SSL_CERTIFICATE=$CERT_FILE"
    log "ERROR:   SSL_CERTIFICATE_KEY=$KEY_FILE"
    log "ERROR: Run deploy/install-ssl-certificate.sh, enable SSL_BOOTSTRAP_SELF_SIGNED=true,"
    log "ERROR: or set ENABLE_SELF_SIGNED_SSL=true for development."
    exit 1
  fi
else
  # Surface the expiry date in the container log — makes "is the cert stale?"
  # answerable from `docker compose logs frontend` alone.
  EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_FILE" 2>/dev/null | cut -d= -f2 || echo "unknown")
  log "Using TLS certificate $CERT_FILE (expires: $EXPIRY)"
fi

# ACME webroot: created here so nginx never 500s on a missing root directory
# when the host bind-mount has not been provisioned yet.
mkdir -p /var/www/certbot/.well-known/acme-challenge 2>/dev/null || true

# Hand over to the stock nginx entrypoint (runs envsubst over the templates).
exec /docker-entrypoint.sh "$@"
