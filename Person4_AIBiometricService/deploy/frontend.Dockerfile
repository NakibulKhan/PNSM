# syntax=docker/dockerfile:1
#
# Multi-stage image for the two Vite/React frontends:
#
#   Person 1  mobile web build (the same bundle CapacitorJS wraps)
#   Person 2  HR command centre
#
# Owned by Person 4 because the master plan puts container architecture in
# Quadrant IV, but *built from* Person 1's and Person 2's source trees. Neither
# of them has to write a Dockerfile; they point this one at their directory.
#
#   docker build -f deploy/frontend.Dockerfile \
#                --build-arg APP_NAME=pnsm-web \
#                -t pnsm-web:latest ../pnsm-web
#
# The master plan's numbers, and why each one is met:
#
#   node:24-slim, not Alpine   Alpine links musl libc. Any dependency with a
#                              native addon (esbuild's optional binaries, sharp,
#                              node-gyp builds) either falls back to a slower
#                              path or fails to compile, and the failure is
#                              silent until runtime. slim keeps glibc.
#   npm ci, not npm install    Deterministic resolution from package-lock.json.
#                              Also OWASP A03: `npm install` is free to pull a
#                              patch release nobody reviewed.
#   nginx:alpine runtime       Alpine is fine *here* -- nothing is compiled in
#                              this stage, only static files are served, and the
#                              base image is ~8 MB.
#   under 50 MB final          nginx:alpine (~8 MB) + a Vite bundle that is tens
#                              to low hundreds of kB gzipped. The Node runtime,
#                              node_modules and every build tool stay in stage 1.
#                              deploy/frontend.Dockerfile is size-gated in CI.

# ------------------------------------------------------------------- stage 1
FROM node:24-slim AS builder

# Which app is being built. Only used for logging and the label, but it makes
# `docker image ls` readable when both frontends are on the same host.
ARG APP_NAME=pnsm-frontend
# Vite inlines VITE_* variables at build time -- they are baked into the bundle
# and are therefore PUBLIC. Never pass a secret here. The API base URL and the
# Google Maps key (which is restricted by HTTP referrer in the console, not by
# secrecy) are the only two that belong.
ARG VITE_API_BASE_URL=""
ARG VITE_MAPS_API_KEY=""

ENV NODE_ENV=production \
    CI=true \
    npm_config_fund=false \
    npm_config_audit=false

WORKDIR /src

# Manifests first: this layer only invalidates when dependencies actually
# change, so an edit to a React component reuses the cached install.
COPY package.json package-lock.json ./

# --include=dev because Vite, TypeScript and the Tailwind v4 Oxide compiler are
# devDependencies and NODE_ENV=production would otherwise skip them. They are
# still discarded with the whole stage.
RUN npm ci --include=dev

COPY . .

# Supply-chain gate at build time as well as in CI, so an image cannot be built
# from a tree that CI would have rejected (OWASP A03).
RUN npm audit --omit=dev --audit-level=high

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_MAPS_API_KEY=${VITE_MAPS_API_KEY}

RUN npm run build \
    && echo "built ${APP_NAME}:" \
    && du -sh dist

# Pre-compress. nginx serves the .gz with gzip_static and spends no CPU per
# request -- on a Fargate task with 0.25 vCPU that is worth having.
RUN find dist -type f \
      \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' \
         -o -name '*.json' -o -name '*.map' \) \
      -size +1k -exec gzip -9 -k {} \;

# ------------------------------------------------------------------- stage 2
FROM nginx:alpine

ARG APP_NAME=pnsm-frontend
# The two origins the app is allowed to talk to, injected into the CSP.
# Empty by default, which yields `connect-src 'self'` -- the strictest possible
# policy, and a visibly broken app rather than a silently permissive one.
ARG PNSM_API_ORIGIN=""
ARG PNSM_S3_ORIGIN=""

LABEL org.opencontainers.image.title="${APP_NAME}" \
      org.opencontainers.image.source="https://github.com/pnsm-group8" \
      org.opencontainers.image.description="Static Vite build served by nginx. No Node runtime."

# Drop nginx's stock landing page so a misconfigured route cannot serve it.
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

COPY deploy/nginx.conf.template /tmp/pnsm.conf.template

# envsubst with an explicit allow-list: only these two are replaced, so every
# nginx runtime variable ($uri, $document_root) passes through intact. Then
# `nginx -t` proves the rendered file parses -- a broken config must fail the
# build, not the first request.
RUN apk add --no-cache gettext \
    && PNSM_API_ORIGIN="${PNSM_API_ORIGIN}" PNSM_S3_ORIGIN="${PNSM_S3_ORIGIN}" \
       envsubst '${PNSM_API_ORIGIN} ${PNSM_S3_ORIGIN}' \
       < /tmp/pnsm.conf.template > /etc/nginx/conf.d/pnsm.conf \
    && rm /tmp/pnsm.conf.template \
    && apk del gettext \
    && nginx -t

COPY --from=builder /src/dist /usr/share/nginx/html

# nginx:alpine ships an unprivileged `nginx` user; the stock image runs the
# master as root only to bind port 80. Binding 8080 instead removes that need.
RUN touch /var/run/nginx.pid \
    && chown -R nginx:nginx /var/run/nginx.pid /var/cache/nginx /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
