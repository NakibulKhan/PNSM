# frontend-smoke

A three-file stand-in for Person 1's and Person 2's Vite applications.

`deploy/frontend.Dockerfile` is Person 4's deliverable, but the source it builds
lives in two other repositories. Without something to build, CI could only lint
the Dockerfile — which would not catch a broken `COPY --from`, an `nginx -t`
failure, a deep link that 404s, or the claim that matters most: that the final
image is under 50 MB.

So this directory is the smallest thing that is shaped like a Vite project: a
`package.json` with a `build` script, a lockfile so `npm ci` runs, and a build
step that emits `dist/index.html` plus a fingerprinted `dist/assets/*.js`.

It has **zero dependencies**, deliberately. The number CI measures should be the
base cost of the runtime stage, not the cost of whichever package happened to be
installed alongside it.

Nothing here ships. It is never copied into a production image, never imported by
the service, and the real frontends replace it entirely at integration time.
