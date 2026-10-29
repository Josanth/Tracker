# Test Cases

**Automated:** `npm test` runs every case marked *Auto* against the real Express app with a fresh
in-memory SQLite database (`server/test/*.test.js`). Last run: **34 passed, 0 failed**.

**Manual (UI):** cases marked *UI* were executed in the browser against the seeded demo data
(`npm run seed`, log in as `olivia@example.com` / `Password123` unless stated).

---

## Functional test cases

| ID | Title | Steps | Expected result | Type | Result |
|---|---|---|---|---|---|
| TC-F-01 | User registration | Register with name "Reg User", email `Reg.User@Example.com`, password `longenough` | 201; session returned; email stored lower-case; `/me` returns the user | Auto | Pass |
| TC-F-01b | First user becomes admin | On an empty DB register two users | First is `admin`, second is `user` | Auto | Pass |
| TC-F-02 | Login / logout | Log in with valid credentials (email in different case), call `/me`, log out, call `/me` | 200, 200, 204, then 401 | Auto | Pass |
| TC-F-03 | Password reset | Request reset, use token to set new password, log in with new and old password, reuse token | New password works, old fails (401), token reuse fails (400) | Auto | Pass |
| TC-F-04 | Update profile | Change name on Profile | Name updated | Auto | Pass |
| TC-F-05 | Create a project | Create "Library", key `lib`, dates | 201; key `LIB`; creator is owner and only member; appears in project list | Auto | Pass |
| TC-F-06 | Edit project | Owner renames project with current version | 200; new name | Auto | Pass |
| TC-F-07 | Add a project member | Owner adds a registered user | 201; user in members; that user can open the project | Auto | Pass |
| TC-F-08 | Create and assign a task | In project `ABC` create a High task assigned to a member with a future due date; create a second task | IDs `ABC-1`, `ABC-2`; assignee/reporter set; status To Do; default priority Medium | Auto | Pass |
| TC-F-09 | Change task status | Move To Do → In Progress → In Review → Done, then owner reopens | Each step 200; reopen allowed for owner | Auto | Pass |
| TC-F-10 | Search & filter | Create 3 tasks; search "login" (any case); filter by status, priority, assignee, unassigned, combined | Each query returns exactly the matching tasks | Auto | Pass |
| TC-F-11 | Add a comment | Post "  Looks good  " | 201; stored trimmed; visible on task; activity entry added | Auto | Pass |
| TC-F-12 | Dashboards | Member has one task due today, one overdue | Member: 2 assigned, 1 due this week, 1 overdue, no management section. Owner: 1 project, 2 people, 2 To Do, 1 overdue, per-member counts | Auto | Pass |
| TC-F-13 | Delete task | Reporter deletes own task; owner deletes another member's task | Both 204 | Auto | Pass |
| TC-UI-01 | Board drag-and-drop (legal) | Board of LIB: drag LIB-5 from To Do to In Progress | Card moves to In Progress; column re-renders from the server's response | UI | Pass |
| TC-UI-02 | Login UI | Log in as olivia | Redirect to dashboard showing "Hi, Olivia", assigned/due/overdue panels and owner stats | UI | Pass |

## Negative test cases

| ID | Title | Steps | Expected result | Type | Result |
|---|---|---|---|---|---|
| TC-N-01 | Invalid login | Wrong password for a real email; correct password for unknown email | Both 401 with identical message "Invalid email or password" | Auto + UI | Pass |
| TC-N-02 | Registration validation | (a) blank name/email/password (b) emails `plainaddress`, `a@b`, `no@tld.`, `sp ace@x.com`, `@missing.com` (c) 7-char password (d) existing email in different case | (a) 400 listing all three fields (b) 400 each (c) 400 "at least 8 characters" (d) 409 | Auto | Pass |
| TC-N-03 | Project validation | Blank name & key; key `1A`; end date before start; duplicate key in different case | 400, 400, 400 "earlier than the start date", 409 | Auto | Pass |
| TC-N-04 | Immutable key / owner removal | Change key via PUT; remove the owner | Both 400 | Auto | Pass |
| TC-N-05 | Empty mandatory fields & past due date | Task with blank title; due date yesterday; due date `2026-02-30`; blank comment | All 400 with field errors | Auto | Pass |
| TC-N-06 | Assign to non-member | Create task assigned to non-member; update task to non-member | Both 400 "only be assigned to a member" | Auto | Pass |
| TC-N-07 | Non-member accessing a project | As outsider: GET project, list tasks, create task, GET/PATCH task, comment, activity | All 403; project absent from their list; anonymous → 401 | Auto | Pass |
| TC-N-08 | Non-owner managing members | Member tries to add a user, remove the owner, edit the project | All 403 | Auto | Pass |
| TC-N-09 | Delete by non-reporter | Member B deletes task reported by member A | 403 | Auto | Pass |
| TC-N-10 | Reopen by non-owner | Member moves Done task back to In Review | 409 `INVALID_TRANSITION` | Auto | Pass |
| TC-N-11 | Bad reset token / unknown email | Reset with garbage token; forgot-password for unknown email | 400; 200 generic message with no token | Auto | Pass |
| TC-UI-03 | Non-member opens URL (UI) | Log in as `omar@example.com`, open `/projects/1/board` and `/projects/1/tasks/2` | "403 Access denied — You are not a member of this project" | UI | Pass |

## Edge-case test cases

| ID | Title | Steps | Expected result | Type | Result |
|---|---|---|---|---|---|
| TC-E-01 | Concurrent task updates | Users A and B load v1; A saves title; B saves title with v1; B retries with latest version | A 200; B 409 `VERSION_CONFLICT` containing A's data; stored title is A's; retry 200 | Auto | Pass |
| TC-E-01b | Parallel status changes | 5 simultaneous PATCHes with the same version | Exactly one 200, four 409 | Auto | Pass |
| TC-E-02 | Duplicate creation on refresh | Send the same create request (same `clientRequestId`) twice in parallel and once more | One 201 + 200 replays (`Idempotent-Replay: true`); only one task exists | Auto | Pass |
| TC-E-03 | Invalid status transitions | To Do → Done; To Do → In Review; In Review → In Progress; status "Blocked" | 409 (allowed: In Progress); 409; 200; 400 | Auto | Pass |
| TC-E-04 | Multiple tabs | Two tabs on one session edit priority from the same version | First 200, second 409; list and detail agree on version and value | Auto | Pass |
| TC-E-05 | Member removed with assigned tasks | Remove member assigned in P1 and P2 from P1 | P1 task unassigned (version bumped); P2 task untouched; response lists `unassignedTasks`; removed user gets 403 | Auto | Pass |
| TC-E-06 | Direct URL to project | Outsider requests existing, nonexistent and non-numeric project ids | 403, 404, 404 | Auto | Pass |
| TC-E-07 | Task ID uniqueness under load | 10 parallel creates in project `PAR` | Keys PAR-1…PAR-10, no duplicates | Auto | Pass |
| TC-E-08 | Number not reused after delete | Create DEL-1, delete it, create another | New task is DEL-2 | Auto | Pass |
| TC-UI-04 | Illegal drag on the board | Drag LIB-4 (To Do) onto Done | Card stays in To Do; message "Tasks must move one status at a time…" | UI | Pass |
| TC-UI-05 | Concurrent edit warning (UI) | Open LIB-2; change its title from another session; change priority to Low and save | Warning "LIB-2 was changed by someone else…" with latest values, page scrolls to it. "Keep mine" saves Low priority **and keeps the other user's title** | UI | Pass |
| TC-UI-06 | Refresh during task creation (UI) | Open New task, type a title, refresh | Dialog reopens with "Restored your unsaved draft…" | UI | Pass |
| TC-UI-07 | Submit after a refresh that followed a successful submit | Same draft id is posted once (simulating the request that reached the server), then click Create task | One task (LIB-7) exists; user is taken to it; draft cleared | UI | Pass |
| TC-UI-08 | Remove member in UI | Members tab of LIB → remove Nina | Message lists LIB-3, LIB-4 as now unassigned; Nina no longer in list | UI | Pass |
| TC-UI-09 | Mobile layout | 375 px wide viewport, dashboard | No horizontal scroll; panels stack | UI | Pass |

## Not covered by automated tests

- React components have no unit tests; UI behaviour was verified manually (TC-UI-*).
- HTML5 drag-and-drop was exercised by dispatching real `DragEvent`s; touch-screen dragging is not
  supported by HTML5 DnD (the per-card "Move…" menu is the fallback).
- Cross-tab `BroadcastChannel` refresh was not automated; TC-E-04 covers the data-consistency guarantee.
