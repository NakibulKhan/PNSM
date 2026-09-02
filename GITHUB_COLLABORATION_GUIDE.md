# GitHub Collaboration Guide

This repo is meant to hold **all four quadrants of PNSM in one place** — one shared GitHub
repository, four clearly separated folders, one project. This doc is the workflow the four
of you should follow to push your ongoing work here without stepping on each other.

## 1. Getting set up

1. One person creates a single shared GitHub repository (private, unless the team agrees
   otherwise) and pushes this folder's contents to it as the initial `main` branch —
   the git history already built here (branch-per-quadrant, merged into `main`) can be
   pushed as-is.
2. That person adds the other three as **collaborators** (or the repo lives under a GitHub
   Organization/Team if you have one — either works, just make sure all four of you have
   write access).
3. Everyone else clones the repo:
   ```
   git clone <repo-url>
   cd PNSM
   ```

## 2. The one rule: stay inside your own folder

- **Person 1** works only inside `Person1_MobileClient/`
- **Person 2** works only inside `Person2_WebDashboard/`
- **Person 3** works only inside `Person3_BackendAPI/`
- **Person 4** works only inside `Person4_AIBiometricService/`

Each folder is an independent project (its own `package.json`/`requirements.txt`, its own
lockfile, its own CI workflow). As long as everyone stays inside their own folder, none of
you can produce a merge conflict with each other on ordinary day-to-day work — you're
editing entirely different files.

If a change genuinely needs to touch someone else's folder (e.g., updating a client stub
in `Person4_AIBiometricService/clients/` that Person 3 consumes, or changing a contract in
`Person2_WebDashboard/docs/01-API-CONTRACT.md`), **open a PR and tag that folder's owner as
a reviewer** rather than editing it directly.

Root-level files (`README.md`, `GITHUB_COLLABORATION_GUIDE.md`, `INTEGRATION_GAPS.md`,
`.gitignore`) are shared — coordinate in the team chat before editing these, since everyone
touches them.

## 3. Branch naming

Follow the same shape used to build this repo in the first place:

```
person<N>/<short-description>
```

Examples: `person1/background-heartbeat-endpoint`, `person3/wire-checkin-route`,
`person4/run-calibration`. This makes it obvious from the branch list alone whose work is
in flight and what quadrant it touches.

## 4. Commit and PR process

1. Branch off `main`: `git checkout -b person<N>/<short-description>`
2. Keep commits scoped to your own folder — one logical change per commit, clear message.
3. Push your branch: `git push -u origin person<N>/<short-description>`
4. Open a PR against `main`. For changes inside your own folder, a quick self-review or a
   glance from any teammate is enough. For anything touching another quadrant's folder or
   a root-level doc, get that folder's owner to review before merging.
5. Merge with `--no-ff` (GitHub's "Create a merge commit" option) rather than squash, so the
   history keeps showing each quadrant's work as its own thread — matching the merge
   structure already in this repo's log (`git log --graph --all`).
6. If your PR resolves or informs an item in `INTEGRATION_GAPS.md`, update that doc in the
   same PR (see §6 below).

## 5. Avoiding conflicts and accidents

- **Never commit `node_modules/`, `dist/`, `__pycache__/`, `.venv/`, or any `.env` file** —
  the root `.gitignore` already covers these; if `git status` shows one of them as
  trackable, something's wrong, stop and check before committing.
- **Never commit real secrets** (API keys, JWT signing keys, AWS credentials, MongoDB
  connection strings). Use `.env.example` files with placeholder values in your own folder,
  and share real secrets with the team out-of-band (not through git).
- **Lockfiles are per-project** (`package-lock.json` in each Node folder,
  `requirements.lock` in `Person4_AIBiometricService/`) — only regenerate your own, and
  commit the regenerated file when you do so intentionally, not as an accidental side effect
  of running install.
- **Person 4's `calibration/` and `models/` folders** are partially git-ignored on purpose
  (raw calibration photos and downloaded ONNX weights are large/sensitive and shouldn't be
  committed) — see the comments in the root `.gitignore` before adding files there.

## 6. When you hit a cross-quadrant disagreement

Several real disagreements between quadrants already exist and are tracked in
[`INTEGRATION_GAPS.md`](./INTEGRATION_GAPS.md) (e.g., how the refresh token is delivered,
what a below-threshold face match should be called). If you find a new one, or you resolve
an existing one:

- **Don't silently resolve it in code alone.** Add or update the relevant entry in
  `INTEGRATION_GAPS.md` in the same PR, noting what was decided and by whom.
- If it changes another quadrant's contract, get that quadrant's owner to sign off in the
  PR before merging.

## 7. Precedent already set in this repo

This repository's own history was built exactly the way described above: each quadrant was
added on its own branch (`person1-mobile-client`, `person2-web-dashboard`,
`person3-backend-api`, `person4-ai-biometric-service`) and merged into `main` with
`--no-ff`. Run `git log --graph --all --oneline` to see it. Keep following that shape for
future work — it's what makes it possible for four people to work in one repo without
constantly conflicting with each other.
