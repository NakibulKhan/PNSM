# N²PSM — Workforce Attendance & Management System

**N²PSM** is an AI-verified, location-aware workforce attendance system. Employees check in
from a mobile app using a live selfie (matched against an enrolled face embedding) plus GPS
geofencing; HR and Super Admins manage the workforce from a real-time web console; a backend
API and an AI verification microservice handle the data, security, and biometric matching
underneath.

## Team structure

Five people, three development domains plus two non-development roles:

| Folder | Role | Owner | Responsibility |
|---|---|---|---|
| [`P/`](./P) | Domain A — Capture Path | developer | The employee check-in vertical end to end: the mobile app and the `/api/mobile/*` routes that serve it |
| [`S/`](./S) | Domain B — Web Console | developer | Everything HR and Super Admins see and act on |
| [`M/`](./M) | Domain C — AI Verification | developer | Biometric matching, liveness, anti-spoofing, and the vision/ML pipeline |
| [`N2/`](./N2) | Audit & Merge | N2 | Reviews each domain's work, verifies correctness and security, merges to `main`, hands off to N1. Writes no feature code. |
| [`N1/`](./N1) | Deployment & Operations | N1 | Deploys the merged version and monitors it in production |

Work flows **P/S/M → N2 → N1**: developers submit, N2 audits and merges, N1 deploys.

## What's in each domain

| Path | Stack |
|---|---|
| `P/mobile-client/` | Vite + React + Tailwind v4 + Capacitor (iOS/Android) |
| `P/backend-api/` | Express 5 + TypeScript + Mongoose (MongoDB Atlas, 2dsphere geofencing), dual-token JWT, Socket.IO |
| `S/web-dashboard/` | Vite + React + TypeScript, React Router v7, TanStack Query/Table, MapLibre GL, Socket.IO client |
| `M/ai-service/` | Python + FastAPI, ONNX (ArcFace embeddings), AES-256-GCM / AWS KMS field encryption |

Each is a standalone project with its own dependencies, README, and setup instructions —
start there to install and run one piece. This README covers only how they fit together.

## How the pieces talk

- **`P/mobile-client`** captures a compressed selfie, GPS coordinates, liveness-challenge
  frames, and a PIN, then POSTs a check-in payload to `P/backend-api`.
- **`P/backend-api`** validates the geofence server-side with MongoDB's
  `$geoWithin`/`$centerSphere`, then hands the selfie to `M/ai-service` for verification.
- **`M/ai-service`** returns a decision — cosine similarity against the stored encrypted
  embedding, plus liveness and presentation-attack signals. The backend records the
  `AttendanceLog` and never touches raw embeddings or encryption keys; those stay entirely
  inside the AI service.
- **`P/backend-api`** pushes the resulting check-in event over Socket.IO to
  `S/web-dashboard`, which renders it live in the HR console.

The exact request/response contracts across those boundaries are frozen in
[`N2/contracts/API_CONTRACT.lock.md`](./N2/contracts/API_CONTRACT.lock.md) — that file is the
acceptance criterion for any change that crosses a domain boundary, and N2 owns it.

## Where to look next

| I want to… | Go to |
|---|---|
| Deploy or operate the system | [`N1/OPERATIONS.md`](./N1/OPERATIONS.md) |
| Know what version is cleared for deployment | [`N1/STATUS.md`](./N1/STATUS.md) |
| Run the whole stack locally | [`N2/SETUP.md`](./N2/SETUP.md) |
| Change something that crosses a domain boundary | [`N2/contracts/API_CONTRACT.lock.md`](./N2/contracts/API_CONTRACT.lock.md) |
| Understand why something is built the way it is | [`DECISIONS.md`](./DECISIONS.md) |
| See what's planned | [`ROADMAP.md`](./ROADMAP.md) |
| Set up or run one specific domain | that folder's own `README.md` |
| Check the supply chain before accepting a dependency change | `bash N2/scripts/audit-gate.sh` |

## Repository layout notes

One git repository, one `.git`, five top-level folders — one per team member. Domain work
happens on per-domain branches and reaches `main` through N2's review and merge, so `main`
is always the merged, audited truth and the thing N1 deploys from.

Two things a fresh clone will **not** give you, both deliberate and both required before the
stack will run:

- **ONNX model weights** (13.8 MB, gitignored) — see [`N1/models/FETCH.md`](./N1/models/FETCH.md)
- **The Python virtual environment** — path-bound, never copied between machines; recreate
  it locally in `M/ai-service/`
