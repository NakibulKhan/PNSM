# =============================================================================
# Multi-stage build for the PNSM Web Command Center.
#
# Shipping the source plus node_modules into a runtime image is a well-known
# anti-pattern: it produces 1.5 GB+ images, bundles the entire build toolchain
# into production, and hands an attacker a compiler. Two stages avoid all three.
# The final image contains compiled HTML/CSS/JS and nginx — nothing else.
# =============================================================================

# ---- Stage 1: build ---------------------------------------------------------
# node:24-slim over Alpine deliberately. Alpine links against musl libc rather
# than glibc, which historically causes silent failures when native C++ addons
# are compiled during install.
FROM node:24-slim AS builder

WORKDIR /app

# Copy manifests first so this layer caches until dependencies actually change.
COPY package.json package-lock.json ./

# `npm ci` not `npm install`: it installs exactly what package-lock.json pins,
# fails if the two disagree, and never silently pulls an unverified upstream
# patch. This is the supply-chain control (OWASP A03).
RUN npm ci

COPY . .

# VITE_ values are inlined at BUILD time, so they must be present here, not at
# container start. Changing one requires a rebuild, not a restart.
ARG VITE_DEMO_MODE=0
ARG VITE_API_BASE_URL
ARG VITE_SOCKET_URL
ARG VITE_APP_VERSION
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SOCKET_URL=$VITE_SOCKET_URL \
    VITE_APP_VERSION=$VITE_APP_VERSION

RUN npm run build

# ---- Stage 2: runtime -------------------------------------------------------
FROM nginx:alpine AS runtime

# COPY --from=builder takes only the compiled artefacts. The Node runtime, the
# source tree and node_modules are all discarded with the builder stage.
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN addgroup -g 1001 -S appuser && adduser -u 1001 -S appuser -G appuser \
    && touch /var/run/nginx.pid \
    && chown -R appuser:appuser /var/run/nginx.pid /var/cache/nginx /usr/share/nginx/html

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
