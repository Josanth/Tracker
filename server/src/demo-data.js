import { hashPassword } from './auth.js';
import { today } from './util.js';
import { tx } from './db.js';

export const DEMO_PASSWORD = 'Password123';

// Loads the demo users, projects and tasks into an empty database. Due dates are relative to today.
export function seedDemo(db) {
  const addDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return today(d);
  };

  return tx(db, () => {
    const users = [
      ['Alice Admin', 'admin@example.com', 'admin'],
      ['Olivia Owner', 'olivia@example.com', 'user'],
      ['Mark Member', 'mark@example.com', 'user'],
      ['Nina Newcomer', 'nina@example.com', 'user'],
      ['Omar Outsider', 'omar@example.com', 'user'],
    ].map(([name, email, role]) => {
      const info = db
        .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(name, email, hashPassword(DEMO_PASSWORD), role);
      return { id: Number(info.lastInsertRowid), name, email };
    });
    const [admin, olivia, mark, nina] = users;

    function project(name, key, description, owner, members, start, end) {
      const info = db
        .prepare('INSERT INTO projects (name, key, description, owner_id, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)')
        .run(name, key, description, owner.id, start, end);
      const id = Number(info.lastInsertRowid);
      for (const m of [owner, ...members]) {
        db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)').run(id, m.id);
      }
      db.prepare('INSERT INTO activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)').run(
        id, owner.id, 'project.created', JSON.stringify({ name, key })
      );
      return { id, key, n: 1 };
    }

    function task(p, reporter, title, { status = 'To Do', priority = 'Medium', assignee = null, due = null, description = '' } = {}) {
      const info = db
        .prepare(
          `INSERT INTO tasks (project_id, number, title, description, priority, status, assignee_id, reporter_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(p.id, p.n++, title, description, priority, status, assignee?.id ?? null, reporter.id, due);
      db.prepare('UPDATE projects SET next_task_number = ? WHERE id = ?').run(p.n, p.id);
      db.prepare('INSERT INTO activity (project_id, task_id, user_id, action, detail) VALUES (?, ?, ?, ?, ?)').run(
        p.id, info.lastInsertRowid, reporter.id, 'task.created', JSON.stringify({ title })
      );
      return Number(info.lastInsertRowid);
    }

    const lib = project('Library System', 'LIB', 'Catalogue, lending and member management for the city library.', olivia, [mark, nina], addDays(-30), addDays(60));
    task(lib, olivia, 'Design catalogue database schema', { status: 'Done', priority: 'High', assignee: mark, due: addDays(-10) });
    task(lib, olivia, 'Implement book search API', { status: 'In Review', priority: 'High', assignee: mark, due: addDays(2) });
    task(lib, mark, 'Borrowing limits per membership tier', { status: 'In Progress', priority: 'Medium', assignee: nina, due: addDays(4) });
    task(lib, olivia, 'Overdue fine calculation', { status: 'To Do', priority: 'High', assignee: nina, due: addDays(-2), description: 'Fines accrue daily after the loan due date.' });
    task(lib, nina, 'Barcode scanner integration spike', { status: 'To Do', priority: 'Low', due: addDays(14) });
    const commented = task(lib, olivia, 'Member registration form', { status: 'In Progress', priority: 'Medium', assignee: olivia, due: addDays(1) });
    db.prepare('INSERT INTO comments (task_id, author_id, body) VALUES (?, ?, ?)').run(commented, mark.id, 'Should we validate library card numbers here as well?');

    const web = project('Website Redesign', 'WEB', 'Refresh of the public marketing site.', mark, [olivia], addDays(-5), addDays(40));
    task(web, mark, 'Wireframes for landing page', { status: 'In Progress', priority: 'High', assignee: olivia, due: addDays(3) });
    task(web, mark, 'Choose typography', { status: 'To Do', priority: 'Low', assignee: mark, due: addDays(-1) });

    project('Internal Tools', 'OPS', 'Admin-owned project for internal tooling.', admin, [], addDays(-60), null);

    return users;
  });
}
