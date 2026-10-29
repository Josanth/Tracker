# Tracker — Project & Task Tracker

A simplified Jira-style web app: users register, create projects, add members, create and assign tasks,
move them across a board (To Do → In Progress → In Review → Done), comment, and see personal and
owner/admin dashboards.

**Stack:** React 18 + Vite (client) · Node.js + Express 5 (API) · SQLite via Node's built-in `node:sqlite` (no native build step).

## Setup

Requirements: **Node.js 22.13 or newer** (tested on Node 26). Nothing else; the database is a local file.

```bash
npm run setup
```

That installs server and client dependencies and seeds a demo database (`server/data/tracker.db`).

## Run (development)

```bash
npm run dev
```

- Web app: http://localhost:5173 (Vite, proxies `/api` to the API)
- API: http://localhost:4000/api

## Run (production-style, single port)

```bash
npm start
```

Builds the client and serves it and the API from http://localhost:4000.

## Deploy a live demo (Render, free)

The repository includes a Render Blueprint ([render.yaml](render.yaml)).

1. Push this repository to GitHub.
2. Sign in at https://render.com (you can use "Sign in with GitHub").
3. Choose **New → Blueprint**, select the repository, and click **Deploy Blueprint**.
4. After the build (a few minutes), the app is live at `https://project-tracker-XXXX.onrender.com`.

On the free plan the service sleeps after 15 minutes without traffic (the first request takes about a
minute to wake it up), and the disk is not persistent: data resets to the demo data on every restart or
redeploy. In the hosted demo the password-reset link is shown on the page, because no email service is
configured (`SHOW_RESET_LINK=true`).

## Demo accounts

All seeded accounts use the password `Password123`.

| Email | Role in demo data |
|---|---|
| admin@example.com | Administrator; owns project OPS |
| olivia@example.com | Owner of LIB (Library System), member of WEB |
| mark@example.com | Owner of WEB, member of LIB |
| nina@example.com | Member of LIB |
| omar@example.com | Not a member of any project (use to test access denial) |

Re-run `npm run seed` to reset the data (stop the app first — on Windows the open database file can't be replaced while the server is running). On an empty database (no seed) the **first account
registered becomes the administrator**.

Password reset: there is no mail server. In development the reset link is shown on the "Forgot password"
page and printed in the API console.

## Tests

```bash
npm test
```

Runs 34 automated API tests (functional, negative, edge cases) against an in-memory database using
Node's built-in test runner. The test IDs match [docs/test-cases.md](docs/test-cases.md).

## Project structure

```
server/
  src/
    app.js            Express app + error handling
    db.js             SQLite schema, transaction helper
    auth.js           Password hashing (scrypt), sessions, auth middleware
    access.js         Project/task loading + BR-01 membership checks, activity log
    workflow.js       Status transition rules (BR-04, BR-05)
    routes/           auth, projects, tasks, dashboard
    seed.js           Demo data
  test/               functional / negative / edge test suites
client/
  src/
    api.js            fetch wrapper, error type, token storage
    auth.jsx          Auth context (cross-tab login/logout sync)
    sync.js           Cross-tab change notifications + polling
    pages/            Auth, Dashboard, Projects, Project (board/list/members/settings/activity), Task detail, Profile
docs/                 Deliverable documents (see below)
scripts/dev.js        Runs API and web dev servers together
```

## Deliverables

| Deliverable | Location |
|---|---|
| Working web application | this repository (`npm run setup && npm run dev`) |
| README with setup instructions | this file |
| Requirement analysis | [docs/requirements-analysis.md](docs/requirements-analysis.md) |
| Business rules & validations | [docs/business-rules-and-validations.md](docs/business-rules-and-validations.md) |
| Assumptions & ambiguous requirements | [docs/assumptions.md](docs/assumptions.md) |
| AI prompts used | [docs/ai-prompts.md](docs/ai-prompts.md) |
| AI output review | [docs/ai-output-review.md](docs/ai-output-review.md) |
| Functional, negative & edge-case test cases | [docs/test-cases.md](docs/test-cases.md) |
| Known issues & limitations | [docs/known-issues.md](docs/known-issues.md) |

Bonus features implemented: drag-and-drop board, activity log (who changed what and when).
Not implemented: sub-tasks, file attachments, AI summaries/estimates.

## API overview

All endpoints are under `/api`, JSON in/out, `Authorization: Bearer <token>` except auth endpoints.
Errors use `{ "error": { "code", "message", "fields"? } }`.

| Method | Path | Notes |
|---|---|---|
| POST | /auth/register, /auth/login, /auth/logout | |
| POST | /auth/forgot-password, /auth/reset-password | one-time token, 30 min expiry |
| GET/PUT | /me | profile, change password |
| GET | /users?q= | user lookup for adding members |
| GET/POST | /projects | list (member's projects; admin sees all), create |
| GET/PUT | /projects/:id | detail, edit (owner/admin, optimistic `version`) |
| POST/DELETE | /projects/:id/members[/:userId] | owner/admin only |
| GET | /projects/:id/activity | activity log |
| GET/POST | /projects/:id/tasks | search `q`, filters `status`, `priority`, `assignee` (id, `me`, `unassigned`), `overdue`; create (idempotent via `clientRequestId`) |
| GET/PATCH/DELETE | /tasks/:id | PATCH requires `version`; 409 on conflict or invalid transition |
| POST | /tasks/:id/comments | |
| GET | /dashboard | personal + owner/admin sections |
