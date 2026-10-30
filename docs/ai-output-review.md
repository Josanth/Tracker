# AI Output Review

Each entry below is a real defect or design flaw found in the AI-generated code while running the tests,
launching the app and exercising it in a browser. "Correct" notes what held up under verification.

> Reviewer note: these findings come from the build-and-verify pass. Before submitting, read through the
> code yourself and add your own observations — the assessment is about *your* review of the AI output.

---

## 1. Server API (P1–P5)

**What AI generated:** Express routes for auth, projects, tasks, comments and dashboard; SQLite schema;
scrypt password hashing; session tokens; optimistic locking; idempotent task creation; activity log.

**What was correct:** All 34 API tests passed on the first run — validations, BR-01…BR-07, 409 conflicts,
parallel creates producing unique `KEY-n` numbers, and idempotent replays.

**What was incorrect:** The dashboard route contained a verbatim copy of the 10-line task `SELECT` (joins
for project key, assignee, reporter and comment count) already defined in the task routes.

**Modification:** Exported `TASK_SELECT` from `routes/tasks.js` and imported it in `routes/dashboard.js`.

**Why:** Two copies of the same query drift apart; a column added to one (e.g. a new task field) would
silently be missing from dashboard results.

## 2. Seed script

**What AI generated:** `server/src/seed.js` creating five users, three projects, tasks with relative due
dates and a comment.

**What was incorrect:** `npm run seed` crashed with `ERR_INVALID_ARG_TYPE`: the comment insert passed the
whole user object (`mark`) instead of `mark.id` as the author.

**Modification:** Pass `mark.id`.

**Why:** `node:sqlite` cannot bind objects; the demo database could not be created at all. The tests didn't
catch it because they don't use the seed script.

## 3. Dev runner / port collision

**What AI generated:** `scripts/dev.js`, spawning `npm run dev` for API and client.

**What was incorrect:** When started by a launcher that sets `PORT` (here the preview tool set
`PORT=5173`), the API inherited it and tried to listen on **5173 — the same port as Vite**, so the proxy
target (4000) had nothing on it. Node also printed a `DEP0190` deprecation warning because args were
passed to `spawn` together with `shell: true`.

**Modification:** Pin `PORT=4000` for the API child process; spawn a single command string.

**Why:** The app was unusable under any environment that sets `PORT` (many hosts and CI do).

## 4. Task detail page — concurrent edit handling (P9)

**What AI generated:** A task page that re-fetches on focus/poll/cross-tab events and shows a conflict
banner on HTTP 409.

**What was incorrect (first draft):** The re-fetch function was wrapped in `useCallback([taskId])` but read
a "dirty" flag through an object re-created on every render, so the callback always saw the first render's
value (stale closure). Worse, when a background refresh arrived while the user had unsaved edits, the draft
replaced the page's *base* task with the newer version. Saving would then send the **new** version number
with the user's stale form values — the server would accept it and **silently overwrite** the other
person's change, which is exactly what the edge case forbids.

**Modification:** Rewrote `load` using `useRef` for current data/form. If the form is dirty, the page keeps
the version the user started from (so the server still detects the conflict), refreshes only comments and
history, and shows an "updated elsewhere" notice. The "Keep mine" button re-sends only the fields the user
changed, against the latest version.

**Why:** Verified afterwards in the browser: another session changed the title, the user changed priority
and saved → warning shown; "Keep mine" saved priority **and preserved the other user's title** (TC-UI-05).

## 5. Conflict banner not visible

**What was incorrect:** The conflict warning renders above the form, but the Save button is lower on the
page, so after clicking Save the user saw no feedback.

**Modification:** Scroll to the top when a save fails.

**Why:** A warning that is off-screen is effectively silent.

## 6. Board card markup (P8)

**What AI generated:** Draggable cards implemented as a single `<Link>` (anchor) containing the title,
badges and a "Move…" `<select>`.

**What was incorrect:** Interactive controls nested inside an anchor: interacting with the select would
also trigger navigation, and it is invalid HTML for accessibility tools.

**Modification:** Card is a `<div>`; only the title is a link.

**Why:** Keyboard/touch users depend on the "Move…" menu since HTML5 drag-and-drop doesn't work on touch
screens or without a mouse.

## 7. Drag-and-drop verification

**What was correct:** Legal drops move the card; illegal drops (To Do → Done) are refused with a clear
message; legal target columns are highlighted while dragging.

**Observation:** Automated mouse drags do not fire HTML5 drag events, so the board was tested by
dispatching real `DragEvent`s. No code change, but documented as a test limitation.

## 8. Minor UI issues

| Issue | Fix |
|---|---|
| Tabs strip showed a stray vertical scrollbar (`overflow-x: auto` plus `margin-bottom: -1px` on tabs) | `overflow-y: hidden` |
| "Log out" wrapped onto two lines at phone width | `white-space: nowrap` on small buttons |

## 9. Spec inconsistencies the AI flagged (not code defects)

- "Project Management" appears twice in the specification with identical content — treated as one.
- Board described with 3 columns but 4 statuses exist — implemented 4 columns.
- BR-04 only defines forward moves — documented assumption A6 (one step back allowed).
- Admin role vs BR-01 — documented assumption A5 (admins view, members work).

## 10. Hosted data lost overnight (found by a user after deployment)

**What AI generated:** a Render free-plan deployment that kept the SQLite file on the service's own disk
and reloaded the demo data whenever the database was empty.

**What was incorrect:** Render's free plan wipes the disk whenever the service restarts, and the service
restarts after sleeping for 15 minutes without traffic. A member who registered and was added to a project
in the evening could not log in the next morning: their account, membership and any tasks were gone, and
the demo data had been loaded again. The AI had documented the limitation, but the design was unsuitable
for a site real people sign up on, and the risk was not stated clearly enough when the link was shared.

**Modification:** moved storage to a free hosted Turso (libSQL) database. The SQL is unchanged, but the
client is asynchronous, so every route and the auth middleware were converted to `async`/`await`. Write
transactions now go through one in-process lock, which keeps task numbering, idempotent creation and
optimistic locking race-free. Deleting a task removes its comments explicitly instead of relying on
`ON DELETE CASCADE` (remote connections don't keep per-connection PRAGMAs). Demo data is loaded only
into a brand-new empty database. Added test TC-E-09 (a member can log in after a server restart) and
re-verified it in the browser (TC-UI-10).

**Why:** data that silently disappears is worse than a visible error; a project tracker must keep users,
memberships and tasks across restarts.
