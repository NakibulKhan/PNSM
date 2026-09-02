# PNSM — Workforce Attendance & Management System

**PNSM** (Productivity, Network, and Staff Management) is an AI-verified, location-aware
workforce attendance system: employees check in via a mobile app using a selfie (matched
against a stored face embedding) and GPS geofencing, HR/Super Admins manage the workforce
from a real-time web dashboard, and a backend API + AI microservice handle the data,
security, and biometric matching underneath.

This is a **CSE482L (Internet and Web Technology) course project — Group 8, North South
University**, built against the shared architecture document
[`PNSM_4Person_Bulletproof_Plan.pdf`](./PNSM_4Person_Bulletproof_Plan.pdf), which splits
the system into four independent quadrants, one per team member. This repository is the
merge of all four quadrants into a single project.

> **Status:** all four quadrants are local dev-complete — each one's own dependencies
> installed, typecheck/lint/test/build actually run (not just written), and every real bug
> that surfaced along the way fixed, not just documented. See
> [`ROADMAP.md`](./ROADMAP.md) for the phase-by-phase detail. The ~9 original
> cross-quadrant conflicts plus everything else discovered while wiring the quadrants
> together (refresh-token delivery, face-match status naming, PIN transmission, dead
> pre-integration code, and more) are resolved and recorded in
> [`DECISIONS.md`](./DECISIONS.md) — read that before touching auth, the check-in
> pipeline, or anything that crosses a quadrant boundary. To run the whole stack locally,
> see [`SETUP.md`](./SETUP.md).

## The four quadrants

| Folder | Quadrant | Owner | Stack |
|---|---|---|---|
| [`Person1_MobileClient/`](./Person1_MobileClient) | I — Mobile Edge Client | Person 1 | Vite + React + Tailwind CSS v4 + CapacitorJS |
| [`Person2_WebDashboard/`](./Person2_WebDashboard) | II — Web Command Center | Person 2 | Vite + React + TypeScript, React Router v7, TanStack Query/Table, MapLibre GL, Socket.IO client |
| [`Person3_BackendAPI/`](./Person3_BackendAPI) | III — Backend API | Person 3 | Express 5 + TypeScript + Mongoose (MongoDB Atlas, 2dsphere geofencing), JWT (RS256/HS256 dual-token), Socket.IO |
| [`Person4_AIBiometricService/`](./Person4_AIBiometricService) | IV — AI Biometrics + Cloud/DevOps | Person 4 | Python + FastAPI, ONNX (ArcFace embeddings), AES-256-GCM/AWS KMS field encryption, Docker, AWS ECS/CloudFront manifests |

Each folder is a **standalone project** with its own `package.json`/`requirements.txt`,
its own README, and its own setup instructions — start there for how to install and run
that specific piece. This root README only covers how the pieces fit together.

## How the pieces talk to each other

- **Person 1 (mobile)** captures a compressed selfie + GPS coordinates + PIN and POSTs a
  check-in payload to **Person 3 (backend)**.
- **Person 3 (backend)** validates the geofence with MongoDB's `$geoWithin`/`$centerSphere`,
  then hands the selfie off to **Person 4 (AI service)** for face-embedding comparison.
- **Person 4 (AI service)** returns a match decision (cosine similarity vs. the stored,
  encrypted embedding) back to Person 3, which records the `AttendanceLog` and never itself
  touches raw embeddings or encryption keys — that stays entirely inside Person 4's service
  (embeddings are stored in an isolated `FaceEmbedding` collection, encrypted client-side
  before Person 3 ever persists them).
- **Person 3 (backend)** pushes the resulting check-in event over Socket.IO to
  **Person 2 (web dashboard)**, which shows it live in the HR/Super Admin console.
- **Person 4** also owns the Docker/AWS deployment topology (ECS, CloudFront, KMS, IAM) for
  the whole system, not just its own service.

This ownership split (and the exact request/response contracts between quadrants) is
documented in more detail in `Person4_AIBiometricService/docs/INTEGRATION.md` and
`Person2_WebDashboard/docs/01-API-CONTRACT.md`.

## Repository history

This repo is a local, single-machine build, structured the way a real four-person team's
repo would be: one git branch per quadrant, each merged into `main` with its own commits
(`git log --graph --all` shows this), and every remaining task tracked by which quadrant
it belongs to. It has **not** been pushed to GitHub or any remote — everything above
describes the local history only.
[`GITHUB_COLLABORATION_GUIDE.md`](./GITHUB_COLLABORATION_GUIDE.md) is kept as a reference
for how a real push/handoff to the four actual team members would work, if this project
is ever shared that way — it does not describe anything that has happened yet.

## Where to look next

- Running the whole stack locally, end to end → [`SETUP.md`](./SETUP.md)
- Setting up and running one specific quadrant → that folder's own `README.md`
- What's left, phase by phase → [`ROADMAP.md`](./ROADMAP.md)
- How the cross-quadrant conflicts were resolved → [`DECISIONS.md`](./DECISIONS.md)
- If this is ever pushed to GitHub for the real team → [`GITHUB_COLLABORATION_GUIDE.md`](./GITHUB_COLLABORATION_GUIDE.md)
- The original architecture spec → [`PNSM_4Person_Bulletproof_Plan.pdf`](./PNSM_4Person_Bulletproof_Plan.pdf)
