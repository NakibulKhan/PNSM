# PNSM — Workforce Attendance & Management System

**PNSM** (Productivity, Network, and Staff Management) is an AI-verified, location-aware
workforce attendance system: employees check in via a mobile app using a selfie (matched
against a stored face embedding) and GPS geofencing, HR/Super Admins manage the workforce
from a real-time web dashboard, and a backend API + AI microservice handle the data,
security, and biometric matching underneath.

This is a **CSE482L (Internet and Web Technology) course project — Group 8, North South
University**, built against the shared architecture document
[`PNSM_4Person_Bulletproof_Plan.pdf`](../PNSM_4Person_Bulletproof_Plan.pdf), which splits
the system into four independent quadrants, one per team member. This repository is the
merge of all four quadrants into a single project.

> **Status:** each quadrant's Phase 1 (scaffolding, core building blocks) is built. Phase 2
> (wiring the quadrants together end-to-end) is **not yet done** — see
> [`INTEGRATION_GAPS.md`](./INTEGRATION_GAPS.md) for the full, sourced list of what's open
> before this runs as one working system. This merge is organizational only: nothing in any
> quadrant's code was rewritten to close those gaps.

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

This repo was assembled by merging each quadrant on its own branch and merging it into
`main` (`git log --graph --all` shows this), so the history itself reflects "one project,
built in four parts, merged to form the whole." See
[`GITHUB_COLLABORATION_GUIDE.md`](./GITHUB_COLLABORATION_GUIDE.md) for how the four real
team members should push their ongoing work to this same shared repo going forward.

## Where to look next

- Setting up and running a specific quadrant → that folder's own `README.md`
- What's still open between quadrants → [`INTEGRATION_GAPS.md`](./INTEGRATION_GAPS.md)
- How to push your work to GitHub → [`GITHUB_COLLABORATION_GUIDE.md`](./GITHUB_COLLABORATION_GUIDE.md)
- The original architecture spec → [`PNSM_4Person_Bulletproof_Plan.pdf`](../PNSM_4Person_Bulletproof_Plan.pdf)
