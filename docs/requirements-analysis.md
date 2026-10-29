# Requirement Analysis

## 1. Purpose and scope

Build a basic project tracking web app (a simplified Jira) where users create projects, manage tasks,
assign them to project members and track progress on a board and dashboards.

In scope: user management, project management, task management, comments, board, dashboards, business
rules BR-01…BR-07, the listed edge cases, and the bonus drag-and-drop board and activity log.
Out of scope for this version: email delivery, sub-tasks, attachments, AI summaries, real-time push
(see [known-issues.md](known-issues.md)).

Note: the source specification lists the "Project Management" section twice with identical content; it is
treated as a single section.

## 2. Actors

| Actor | Description | Key capabilities |
|---|---|---|
| Visitor | Not logged in | Register, log in, request password reset |
| User | Any registered account | Create projects (becoming owner), edit own profile, see projects they belong to |
| Project member | User added to a project | View the project, create/edit/move tasks, comment, delete tasks they reported |
| Project owner | Member who created (owns) the project | Everything a member can do + edit project, add/remove members, reopen Done tasks, delete any task, owner dashboard |
| Administrator | System-wide role | View every project, manage members of any project, edit any project, system-wide dashboard |

## 3. Functional requirements

### 3.1 User management
| ID | Requirement | Implementation |
|---|---|---|
| UM-1 | Register with name, email, password | `POST /api/auth/register`, Register page |
| UM-2 | Log in / log out | `POST /api/auth/login`, `/logout`; 7-day session token |
| UM-3 | View/edit profile, change password | `GET/PUT /api/me`, Profile page (current password required to change) |
| UM-4 | Password reset | Forgot/Reset pages; one-time token valid 30 min; all sessions revoked after reset |

### 3.2 Project management
| ID | Requirement | Implementation |
|---|---|---|
| PM-1 | Create project (name, key, description, start/end dates) | Creator becomes owner and first member |
| PM-2 | Edit project details | Owner/admin; key immutable; optimistic concurrency |
| PM-3 | Add / remove members | Owner/admin; owner cannot be removed |
| PM-4 | Project list | Projects the user is a member of (admin: all), with progress |
| PM-5 | Project details | Header, board, task list, members, activity, settings tabs |

### 3.3 Task management
| ID | Requirement | Implementation |
|---|---|---|
| TM-1 | Create task | Title, description, priority, assignee, due date; reporter = creator; status = To Do |
| TM-2 | Edit task | Task detail page; optimistic concurrency |
| TM-3 | Assign to project member | Assignee dropdown lists members only; server enforces BR-03 |
| TM-4 | Change status | Board drag-and-drop, "Move…" menu on cards, buttons on task page |
| TM-5 | Search by title | Case-insensitive substring |
| TM-6 | Filter by status, priority, assignee | Combinable; also "Assigned to me", "Unassigned"; filters kept in URL |
| TM-7 | Comments | Add and view comments on task page |
| TM-8 | Board view | To Do / In Progress / In Review / Done columns (spec lists 3 columns but 4 statuses; all 4 are shown) |
| TM-9 | Task IDs `KEY-n` | Per-project counter allocated inside a write transaction; numbers never reused |

### 3.4 Dashboards
| ID | Requirement | Implementation |
|---|---|---|
| DB-1 | Tasks assigned to me | Open (not Done) tasks assigned to the user |
| DB-2 | Tasks due this week | User's open tasks due from today to Sunday |
| DB-3 | Overdue tasks | User's open tasks with due date before today |
| DB-4 | Admin/owner: total projects, total users | Admin: system-wide. Owner: projects they own and distinct people on them |
| DB-5 | Tasks by status, overdue tasks, tasks per member | Same scope as DB-4; per member shows open / overdue / total |

### 3.5 Bonus
| Feature | Status |
|---|---|
| Drag-and-drop board | Implemented (HTML5 DnD; legal drop columns highlighted) |
| Activity log | Implemented per project and per task |
| Sub-tasks, attachments, AI summaries | Not implemented |

## 4. Non-functional requirements

| Area | Approach |
|---|---|
| Security | scrypt password hashing; random session tokens stored hashed; same error for unknown email / wrong password; server-side authorization on every endpoint; parameterised SQL |
| Data integrity | Foreign keys, unique constraints (email, project key, task number per project, request id per project), CHECK constraints for status/priority, transactions |
| Concurrency | Optimistic locking with `version` columns on tasks and projects; 409 responses carry the latest record |
| Usability | Inline field errors (client + server), clear conflict/permission messages, responsive layout, light/dark theme |
| Testability | 34 automated API tests; deterministic in-memory DB per suite |
| Portability | Only dependency outside Node is Express/React/Vite; SQLite is built into Node 22.13+ |

## 5. Data model

```
users(id, name, email UNIQUE NOCASE, password_hash, role[user|admin])
sessions(token_hash, user_id, expires_at)
password_resets(token_hash, user_id, expires_at, used_at)
projects(id, name, key UNIQUE NOCASE, description, owner_id, start_date, end_date, next_task_number, version)
project_members(project_id, user_id)  PK(project_id, user_id)
tasks(id, project_id, number, title, description, priority, status, assignee_id?, reporter_id,
      due_date?, client_request_id?, version)  UNIQUE(project_id, number), UNIQUE(project_id, client_request_id)
comments(id, task_id, author_id, body)
activity(id, project_id, task_id?, user_id, action, detail JSON)
```

"Overdue" is derived (`due_date < today AND status <> 'Done'`) rather than stored, so it is always correct
without a background job.

## 6. Traceability

Each business rule and validation is mapped to its enforcement point and test in
[business-rules-and-validations.md](business-rules-and-validations.md); each test case is listed in
[test-cases.md](test-cases.md).
