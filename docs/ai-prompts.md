# AI Prompts Used

**Tool:** Claude Code (desktop app), model Claude Opus 5.5, working directly in this repository.

## Prompt 1 — full build

The entire assignment specification was pasted as the prompt, unchanged (it is the task description:
User Management, Project Management, Task Management, Dashboard, Business Rules BR-01…BR-07, Edge Cases,
AI Assessment Criteria, Testing Requirements, Deliverables, Bonus). No additional instructions were given;
technology choices, assumptions and the document set were left to the AI.

From that single prompt the AI:

1. Checked the toolchain (Node 26, npm) and created the project folder.
2. Chose the stack (React + Vite, Express 5, built-in `node:sqlite`) to avoid native build dependencies on Windows.
3. Wrote the API, then the automated API tests, then the React client.
4. Ran the tests, started the app in a browser, and exercised the edge cases in the UI.
5. Fixed the defects found (see [ai-output-review.md](ai-output-review.md)) and wrote the documents.

## Equivalent task-level prompts

The assessment asks for prompts in the style "Create a login page using React". The single prompt above was
decomposed by the AI into the following units of work; they are listed so each can be reviewed
(or re-run individually) against the AI output review:

| # | Equivalent prompt | Output |
|---|---|---|
| P1 | Design a SQLite schema for users, sessions, password resets, projects, members, tasks (per-project numbering, optimistic `version`), comments and an activity log. | `server/src/db.js` |
| P2 | Create Node.js/Express auth APIs: register, login, logout, profile, forgot/reset password, with validation (unique email, ≥8-char password, required fields, email format). | `server/src/auth.js`, `routes/auth.js` |
| P3 | Create project APIs (create, edit, list, details, add/remove members) enforcing BR-01/BR-02, unique key, end ≥ start, owner always a member; unassign tasks when a member is removed. | `routes/projects.js`, `access.js` |
| P4 | Create a task API using Node.js with auto-generated IDs (KEY-n), search/filter, comments, status workflow (BR-04/BR-05), assignment rule (BR-03), delete rule (BR-07), optimistic locking and idempotent creation. | `routes/tasks.js`, `workflow.js` |
| P5 | Create dashboard endpoint: my tasks, due this week, overdue; admin/owner totals, tasks by status, overdue, tasks per member. | `routes/dashboard.js` |
| P6 | Write functional, negative and edge-case API tests for every case in the spec using node:test. | `server/test/*.test.js` |
| P7 | Create login, registration, forgot-password and reset-password pages using React with client-side validation. | `client/src/pages/AuthPages.jsx` |
| P8 | Generate a task board component with drag-and-drop columns that only allows legal status moves and handles server rejections. | `ProjectPage.jsx` (`BoardTab`) |
| P9 | Build a task detail page with editing, comments, history and a non-destructive conflict warning when someone else changed the task. | `TaskDetailPage.jsx` |
| P10 | Make task creation safe against refresh/double-submit. | `CreateTaskModal.jsx` + server idempotency |
| P11 | Keep multiple tabs consistent. | `sync.js`, `auth.jsx` |
| P12 | Write README, requirement analysis, business rules, assumptions, test cases, AI review and known issues documents. | `README.md`, `docs/` |
