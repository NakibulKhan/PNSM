# Additive local TLS/PQC reverse proxy (Item 8, Flawless/Ultra blueprint).
# Self-signed cert generated at BUILD time so `docker compose up --build` is
# still turnkey (matches this project's .env convention: real, local-only
# secrets, not a manual pre-step) — never commit the generated key itself;
# a fresh one is minted on every build.
FROM nginx:alpine

RUN apk add --no-cache openssl curl \
  && mkdir -p /etc/nginx/certs \
  && openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
       -keyout /etc/nginx/certs/tls-proxy.key \
       -out /etc/nginx/certs/tls-proxy.crt \
       -subj "/CN=localhost" \
       -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

COPY nginx.conf /etc/nginx/nginx.conf

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD curl -fsSk https://localhost:8443/health || exit 1
