# AWS Deployment — S3 + CloudFront

The console is a static single-page bundle. `npm run build` emits `dist/`, which
is uploaded to S3 and served through CloudFront.

---

## 1. The deep-link problem, and the fix that is not optional

**Symptom.** Internal navigation works perfectly. Then an administrator
bookmarks `https://admin.pnsm.com/employees/onboarding`, or simply presses
refresh on any screen other than the root — and gets a raw XML error page.

**Cause.** Vite compiles the whole application into a single `/index.html`.
There is no `employees/onboarding/index.html` object in the bucket. S3 is an
object store, not a router: it looks for that exact key, does not find it, and
CloudFront returns 403 (or 404, depending on origin type). React Router never
loads, so it never gets the chance to interpret the path.

**Fix.** Configure Custom Error Responses on the distribution so the edge answers
unknown paths with the application shell and a **200**, deferring all path
interpretation to client-side JavaScript.

CloudFront → your distribution → **Error pages** → *Create custom error response*,
twice:

| HTTP error code | Customize error response | Response page path | HTTP response code | Min TTL |
| --- | --- | --- | --- | --- |
| 403 Forbidden | Yes | `/index.html` | **200** | 0 |
| 404 Not Found | Yes | `/index.html` | **200** | 0 |

Map **both**. Which one fires depends on the origin: a REST origin with
`ListBucket` denied (the secure configuration) returns 403, while a website
endpoint returns 404.

`ErrorCachingMinTTL: 0` matters — without it the edge caches the error mapping
and a genuine deploy fix can take up to an hour to take effect.

The equivalent CLI payload is in `cloudfront-error-responses.json`.

> Returning 200 for a genuinely unknown path is intentional. The application's
> own `*` route renders the 404 screen. A crawler-facing site would want a real
> 404; this console is `noindex` and admin-only, so usability wins.

---

## 2. Bucket and distribution setup

```bash
# 1. Bucket — keep public access BLOCKED. CloudFront reaches it via OAC.
aws s3api create-bucket --bucket pnsm-admin-web --region ap-southeast-1 \
  --create-bucket-configuration LocationConstraint=ap-southeast-1

# 2. Upload. Hashed assets are immutable; index.html must never be cached.
aws s3 sync dist/ s3://pnsm-admin-web --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

aws s3 cp dist/index.html s3://pnsm-admin-web/index.html \
  --cache-control "no-cache,no-store,must-revalidate"

# 3. After every deploy, invalidate the shell (only the shell — the hashed
#    assets are new filenames, so they need no invalidation and each one costs).
aws cloudfront create-invalidation --distribution-id EXXXXXXXXXXXXX --paths "/index.html"
```

**Origin Access Control (OAC), not public bucket policy.** The bucket stays
private; only the distribution can read it. A publicly readable bucket lets
anyone bypass CloudFront, defeating WAF rules and inflating costs.

**TLS.** Provision the certificate through AWS Certificate Manager in
`us-east-1` (CloudFront only accepts certificates from that region regardless of
where the bucket lives) and set the minimum protocol to TLS 1.2.

---

## 3. Security headers

CloudFront → **Response headers policy**. Static hosting has no Express, so
`helmet` cannot run — the edge has to add these instead.

| Header | Value | Why |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Forces HTTPS |
| `X-Frame-Options` | `DENY` | Clickjacking |
| `X-Content-Type-Options` | `nosniff` | MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Stops path leakage to third parties |
| `Content-Security-Policy` | see below | XSS containment |

```
default-src 'self';
img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.amazonaws.com;
connect-src 'self' https://api.pnsm.com wss://api.pnsm.com https://*.amazonaws.com;
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
script-src 'self';
frame-ancestors 'none';
base-uri 'self';
```

Three of those entries are load-bearing and easy to get wrong:

- **`connect-src` must include the `wss://` scheme.** Socket.IO upgrades to a
  WebSocket, and CSP treats that as a separate scheme. Omit it and the live feed
  silently never connects while every REST call works — a genuinely confusing
  failure.
- **`worker-src 'self' blob:`** — image compression runs in a web worker created
  from a blob URL. Without this, onboarding fails at the compression step.
- **`img-src` needs `blob:`** for the local photo preview, and the tile host for
  the map.

---

## 4. Optional: containerised delivery

Person 4's pipeline builds a multi-stage image. The frontend fits that pattern,
and `Dockerfile` + `nginx.conf` in the project root implement it: a
`node:24-slim` builder stage, then an `nginx:alpine` runtime holding only the
compiled assets — well under 50 MB, with no Node runtime shipped to production.

`nginx.conf` contains the same deep-link fix in nginx form:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

Use S3 + CloudFront **or** the container behind ECS, not both. S3 is cheaper and
simpler for a static bundle; the container is there because it matches the
team's deployment story if everything is standardised on ECS.
