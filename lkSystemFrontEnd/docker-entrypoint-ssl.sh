#!/bin/sh
set -e

CERT_DIR="/etc/nginx/ssl"
CERT_FILE="${SSL_CERTIFICATE:-$CERT_DIR/selfsigned.crt}"
KEY_FILE="${SSL_CERTIFICATE_KEY:-$CERT_DIR/selfsigned.key}"
ENABLE_SELF_SIGNED_SSL="${ENABLE_SELF_SIGNED_SSL:-true}"

# Generate self-signed certificate if enabled and no certificate exists.
if { [ "$ENABLE_SELF_SIGNED_SSL" = "true" ] || [ "$ENABLE_SELF_SIGNED_SSL" = "True" ]; } && { [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; }; then
  echo "🔐 Generating self-signed SSL certificate for LAN access..."
  mkdir -p "$(dirname "$CERT_FILE")" "$(dirname "$KEY_FILE")"
  # Get the container's IP and common LAN IPs for the SAN field
  LOCAL_IP=$(hostname -i 2>/dev/null | awk '{print $1}' || echo "")

  openssl req -x509 -nodes -days 3650 \
    -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "/C=TN/ST=Local/L=Local/O=LKSystem/CN=lksystem.local" \
    -addext "subjectAltName=DNS:localhost,DNS:*.local,IP:127.0.0.1,IP:192.168.8.170,IP:192.168.1.252,IP:192.168.1.1,IP:10.0.0.1${LOCAL_IP:+,IP:$LOCAL_IP}"
  echo "✅ SSL certificate generated (valid for 10 years)"
fi

if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "❌ TLS certificate not found."
  echo "   SSL_CERTIFICATE=$CERT_FILE"
  echo "   SSL_CERTIFICATE_KEY=$KEY_FILE"
  echo "   Run deploy/install-ssl-certificate.sh or enable self-signed SSL for development."
  exit 1
fi

# Run the default nginx docker-entrypoint (handles envsubst for templates)
exec /docker-entrypoint.sh "$@"
