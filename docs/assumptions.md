# Assumptions and Ambiguous Requirements

## Ambiguous requirements called out in the specification

### Q1. Can any user create a project, or only administrators?
**Decision (A1): any registered user can create a project** and automatically becomes its owner and first
member.
*Why:* the spec has a separate "project owner" role with its own dashboard and powers (BR-02, BR-05, BR-07),
which only makes sense if ordinary users can own projects. Restricting creation to admins would make
"owner" and "admin" nearly the same role. Administrators can still view and manage every project.

### Q2. Can a task be assigned to a user who is not a member of the project?
**Decision (A2): no.** This is stated by BR-03 and the task validation "A task can only be assigned to a
member of the same project", so the question is resolved by the spec itself. Enforced on create and update;
the UI only offers members. To assign someone new, the owner first adds them as a member.

### Q3. What happens to a user's assigned tasks when they are removed from a project?
**Decision (A3): those tasks become unassigned** (the spec's edge-case table allows "unassigned or require
reassignment").
*Why:* blocking the removal until every task is reassigned would make it impossible to remove someone who
has left the company. Unassigning keeps the data valid (BR-03 still holds), and the owner is shown exactly
which task keys need a new assignee; each is also recorded in the activity log and counted on the dashboard
as "Open & unassigned". Tasks in other projects are not affected. The removed user's comments and their
"reporter" credit remain (history should not be rewritten).

## Other assumptions

| # | Topic | Assumption |
|---|---|---|
| A4 | Administrator accounts | Role is `user` or `admin`. The first account registered in an empty system becomes admin (bootstrap); the seed creates `admin@example.com`. There is no UI for promoting users (see known issues). |
| A5 | Admin vs BR-01 | Admins can **view** all projects (needed to manage members per BR-02) but cannot create/edit/move tasks or comment unless they add themselves as a member. This keeps BR-01 literal for task work. |
| A6 | Moving tasks backwards | BR-04 defines forward order only. Moving **back one step** (e.g. In Review → In Progress when a review fails, or In Progress → To Do) is allowed for members, because real workflows need it. Skipping steps in either direction is rejected. Leaving Done is governed by BR-05. |
| A7 | Reopening | The owner may move a Done task to any earlier status. Administrators who aren't the owner cannot reopen (BR-05 names only the owner). |
| A8 | Board columns | The spec's board mentions three columns but defines four statuses; the board shows all four so "In Review" tasks are visible. |
| A9 | Due date | Optional. "Cannot be in the past" applies at creation; on edit, an existing past date may be kept but a newly chosen date cannot be in the past. "Today" is the server's local date. |
| A10 | Overdue | Derived, not a status. A task can be "In Progress" and overdue at once; it is shown as a badge. Tasks without a due date are never overdue. |
| A11 | "Tasks due this week" | The user's open tasks due from today through Sunday (Monday–Sunday week). Already-overdue tasks appear under Overdue instead. |
| A12 | Owner dashboard scope | A project owner who isn't an admin sees stats for the projects they own; "Total users" becomes the number of distinct people on those projects. Admins see system-wide totals. |
| A13 | Project key | 2–10 characters, letters/digits, starts with a letter, stored upper-case, unique ignoring case, and immutable after creation (task IDs embed it). |
| A14 | Task numbers | Never reused after a task is deleted, so `LIB-3` always refers to the same task. |
| A15 | Deleting | Tasks are hard-deleted (with their comments); the deletion is kept in the project activity log. Projects and users cannot be deleted in this version. |
| A16 | Project ownership | Ownership cannot be transferred in this version. |
| A17 | Password reset delivery | No email service: the reset link is logged on the server and, in non-production mode only, displayed on the page. Tokens are single-use, expire after 30 minutes, and resetting logs the user out everywhere. The response never reveals whether an email is registered. |
| A18 | Email format | `something@domain.tld` with a TLD of at least two characters; no spaces. Emails are case-insensitive. |
| A19 | Search | Title-only, case-insensitive substring match, combinable with filters. |
| A20 | Concurrency policy | Optimistic locking. On conflict the user chooses; the "keep mine" option only re-applies the fields that user changed, so the other person's edits to other fields survive. |
| A21 | Who can edit tasks | Any project member can edit any task in the project (title, description, priority, assignee, due date, status) — the spec only restricts deletion and reopening. |
