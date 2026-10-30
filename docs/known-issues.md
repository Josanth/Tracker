# Known Issues and Limitations

## Functional gaps
- **No email delivery.** Password-reset links are printed in the API console and (outside production) shown
  on the page. A real deployment needs an SMTP/email provider and must set `NODE_ENV=production`.
- **No user administration UI.** Admins can't promote/demote users, deactivate accounts or delete users;
  the admin role is bootstrapped (first user) or seeded.
- **Projects can't be deleted or archived, and ownership can't be transferred.**
- **No sub-tasks, attachments or AI summaries** (optional bonus items not implemented).
- **Search is title-only** substring matching (no description search, no full-text ranking).
- **No pagination.** Lists load all matching tasks; fine for small teams, not for thousands of tasks.
  Activity is capped at the latest 200 entries per project.

## Concurrency and real-time
- **Not real-time.** Other users' changes appear on focus, on a 20-second poll, or immediately in other tabs
  of the same browser (BroadcastChannel). There are no WebSockets.
- Conflicts are detected per task, not per field; the "Keep mine" option re-applies only the user's
  changed fields, but if both users changed the *same* field the second user's choice wins (by design,
  after an explicit warning).
- Duplicate-submit protection relies on `sessionStorage`; a draft is per browser tab. If a user opens a
  brand-new tab and re-types the same task, that is (correctly) treated as a new task.

## Dates and time zones
- "Today", "overdue" and "due this week" use the **server's local date**; the browser uses its own local
  date for client-side checks. Users in a different time zone from the server may see a task become
  overdue a few hours early/late, and a due date of "today" could be rejected near midnight.
- Weeks run Monday–Sunday regardless of locale.

## Security (acceptable for an assessment, not for production)
- Session tokens are stored in `localStorage` (readable by any XSS); production should use HttpOnly cookies
  with CSRF protection.
- No rate limiting on login or password-reset endpoints; no account lockout.
- No HTTPS configuration (expected to sit behind a TLS-terminating proxy).
- Any logged-in user can look up other users by name/email (needed for "add member"), which exposes the
  user directory.

## UI
- HTML5 drag-and-drop does not work on touch devices; use the per-card "Move…" menu there.
- No automated front-end tests; UI was verified manually (see test-cases.md, TC-UI-*).
- Delete and remove-member confirmations use the browser's native `confirm()` dialog.

## Environment
- Requires Node.js 20+.
- SQLite is single-writer; suitable for a small team on one server, not for horizontal scaling.
- **Hosted demo (Render free plan):** it sleeps when idle, so the first request after a break takes
  about a minute. Data is safe because it lives in Turso, but if `TURSO_DATABASE_URL` is missing the app
  silently falls back to a local file, which Render wipes on restart (check the startup log line
  "Database: hosted Turso database").
- Write transactions are serialised inside the one server process. Running several server instances
  against the same database would need database-level locking instead.
- Turso's free tier has storage and request limits that are far above what a demo needs.
