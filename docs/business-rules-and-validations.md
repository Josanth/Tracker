# Business Rules and Validations

Every rule is enforced **on the server** (authoritative). The client repeats most checks for instant
feedback, but a direct API call cannot bypass them. Test IDs refer to [test-cases.md](test-cases.md).

## Business rules

| Rule | Description | How it is enforced | Where | Tests |
|---|---|---|---|---|
| BR-01 | Only project members can view and work on a project's tasks | Every project/task endpoint loads the project through `loadProject`, which returns 403 for non-members (404 if it doesn't exist). Task writes additionally require membership (`requireMember`), so administrators who aren't members get read-only access. Project list only returns the user's projects. UI shows an "Access denied" page. | `server/src/access.js`, `routes/tasks.js` | TC-N-07, TC-E-06 |
| BR-02 | Only the project owner or an administrator can add or remove members | `perms.canManageMembers` check on member endpoints; Members tab hides controls for others | `routes/projects.js` | TC-F-07, TC-N-08 |
| BR-03 | A task can be assigned only to a member of that project | `validateAssignee` on create and update; assignee dropdown lists only members | `routes/tasks.js` | TC-N-06 |
| BR-04 | Statuses move in order To Do → In Progress → In Review → Done | `checkTransition`: forward exactly one step; back exactly one step (see A6); anything else → 409 `INVALID_TRANSITION` with the allowed targets. Board highlights legal columns and rejects illegal drops. | `server/src/workflow.js` | TC-F-09, TC-E-03 |
| BR-05 | A Done task can be reopened only by the project owner | `checkTransition` allows leaving Done only when `isOwner` | `workflow.js` | TC-F-09, TC-N-10 |
| BR-06 | A task is Overdue when its due date has passed and it is not Done | Computed on read (`overdue` flag), never stored; used for badges, filters and dashboards | `routes/tasks.js` `serializeTask`, `routes/dashboard.js` | TC-F-12 |
| BR-07 | Only the reporter or the project owner can delete a task | Check in `DELETE /tasks/:id`; delete button shown only when permitted | `routes/tasks.js` | TC-F-13, TC-N-09 |

## Validations

### User
| Validation | Rule | Error | Tests |
|---|---|---|---|
| Email unique | Case-insensitive (`COLLATE NOCASE`, emails lower-cased) on register and profile update | 409 `EMAIL_TAKEN` | TC-N-02 |
| Password length | ≥ 8 characters on register, reset, change | 400, field `password` / `newPassword` | TC-N-02 |
| Mandatory fields | Name, email, password (register); email, password (login) | 400 with every failing field listed | TC-N-02 |
| Email format | `local@domain.tld` with no spaces, TLD ≥ 2 chars | 400, field `email` | TC-N-02 |
| Change password | Requires the correct current password | 400, field `currentPassword` | — (UI) |

### Project
| Validation | Rule | Error | Tests |
|---|---|---|---|
| Key unique | Case-insensitive | 409 `PROJECT_KEY_TAKEN` | TC-N-03 |
| Key format | 2–10 uppercase letters/digits, starting with a letter (input is upper-cased) | 400 | TC-N-03 |
| Key immutable | Cannot change after creation (task IDs depend on it) | 400 | TC-N-04 |
| Name required | Non-blank, ≤ 100 chars | 400 | TC-N-03 |
| Date order | End date ≥ start date (when both given); dates must be real calendar dates | 400, field `endDate` | TC-N-03 |
| At least one member | Owner is added as member on creation and cannot be removed | 400 | TC-F-05, TC-N-04 |

### Task
| Validation | Rule | Error | Tests |
|---|---|---|---|
| Title required | Non-blank after trimming, ≤ 200 chars | 400 | TC-N-05 |
| Due date not in past (create) | `dueDate >= today` (server's local date); invalid dates like 2026-02-30 rejected | 400 | TC-N-05 |
| Due date on edit | An existing past due date may be kept, but a *changed* due date cannot be in the past | 400 | — |
| Assignee is member | BR-03 | 400 | TC-N-06 |
| Unique task IDs | `UNIQUE(project_id, number)` + counter incremented inside `BEGIN IMMEDIATE` transaction; numbers are never reused after deletion | — | TC-E-07, TC-E-08 |
| Priority / status values | Must be one of the defined values (also a DB CHECK constraint) | 400 | TC-E-03 |
| Comment not empty | Non-blank after trimming, ≤ 5000 chars | 400 | TC-N-05 |
| Version required on update | `PATCH /tasks/:id` must include the `version` the client last saw | 400 / 409 | TC-E-01 |

## Edge-case handling

| Scenario | Behaviour |
|---|---|
| Two users update the same task | Optimistic locking: update applies only if `version` matches. The loser gets 409 `VERSION_CONFLICT` with the latest task; UI shows a warning with **Discard mine & load latest** or an explicit **Keep mine (overwrite)**, which re-sends only the fields the user changed. Nothing is silently overwritten. |
| Member removed while assigned tasks | Their tasks in that project become unassigned (version bumped, logged in activity); the owner sees which task keys need reassigning; dashboard shows "Open & unassigned" count. |
| Refresh while creating a task | The form is saved to `sessionStorage` with a `clientRequestId`. After refresh the form reopens with the draft; re-submitting sends the same id and the server returns the existing task (200 + `Idempotent-Replay`) instead of creating another. Submit button disables while pending. |
| To Do → Done directly | Rejected (409 `INVALID_TRANSITION`, message names the allowed next status). |
| Multiple browser tabs | Login/logout sync through `storage` events; data changes are broadcast via `BroadcastChannel` so other tabs re-fetch; tabs also refresh on focus and every 20 s; stale writes are caught by version checks. |
| Non-member opens project URL | API 403; UI shows "Access denied". Unknown project → 404 page. |
