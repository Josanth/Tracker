import { hashPassword } from './auth.js';
import { today } from './util.js';

export const DEMO_PASSWORD = 'Password123';

// Loads the demo users, projects and tasks into an empty database. Due dates are relative to today.
export function seedDemo(db) {
  const addDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return today(d);
  };

  return db.tx(async (t) => {
    const users = [];
    for (const [name, email, role] of [
      ['Alice Admin', 'admin@example.com', 'admin'],
      ['Olivia Owner', 'olivia@example.com', 'user'],
      ['Mark Member', 'mark@example.com', 'user'],
      ['Nina Newcomer', 'nina@example.com', 'user'],
      ['Omar Outsider', 'omar@example.com', 'user'],
    ]) {
      const info = await t.run(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        name,
        email,
        hashPassword(DEMO_PASSWORD),
        role
      );
      users.push({ id: info.lastInsertRowid, name, email });
    }
    const [admin, olivia, mark, nina] = users;

    async function project(name, key, description, owner, members, start, end) {
      const info = await t.run(
        'INSERT INTO projects (name, key, description, owner_id, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)',
        name, key, description, owner.id, start, end
      );
      const id = info.lastInsertRowid;
      for (const m of [owner, ...members]) {
        await t.run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', id, m.id);
      }
      await t.run(
        'INSERT INTO activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)',
        id, owner.id, 'project.created', JSON.stringify({ name, key })
      );
      return { id, key, n: 1 };
    }

    async function task(p, reporter, title, { status = 'To Do', priority = 'Medium', assignee = null, due = null, description = '' } = {}) {
      const info = await t.run(
        `INSERT INTO tasks (project_id, number, title, description, priority, status, assignee_id, reporter_id, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.id, p.n++, title, description, priority, status, assignee?.id ?? null, reporter.id, due
      );
      await t.run('UPDATE projects SET next_task_number = ? WHERE id = ?', p.n, p.id);
      await t.run(
        'INSERT INTO activity (project_id, task_id, user_id, action, detail) VALUES (?, ?, ?, ?, ?)',
        p.id, info.lastInsertRowid, reporter.id, 'task.created', JSON.stringify({ title })
      );
      return info.lastInsertRowid;
    }

    const lib = await project('Library System', 'LIB', 'Catalogue, lending and member management for the city library.', olivia, [mark, nina], addDays(-30), addDays(60));
    await task(lib, olivia, 'Design catalogue database schema', { status: 'Done', priority: 'High', assignee: mark, due: addDays(-10) });
    await task(lib, olivia, 'Implement book search API', { status: 'In Review', priority: 'High', assignee: mark, due: addDays(2) });
    await task(lib, mark, 'Borrowing limits per membership tier', { status: 'In Progress', priority: 'Medium', assignee: nina, due: addDays(4) });
    await task(lib, olivia, 'Overdue fine calculation', { status: 'To Do', priority: 'High', assignee: nina, due: addDays(-2), description: 'Fines accrue daily after the loan due date.' });
    await task(lib, nina, 'Barcode scanner integration spike', { status: 'To Do', priority: 'Low', due: addDays(14) });
    const commented = await task(lib, olivia, 'Member registration form', { status: 'In Progress', priority: 'Medium', assignee: olivia, due: addDays(1) });
    await t.run('INSERT INTO comments (task_id, author_id, body) VALUES (?, ?, ?)', commented, mark.id, 'Should we validate library card numbers here as well?');

    const web = await project('Website Redesign', 'WEB', 'Refresh of the public marketing site.', mark, [olivia], addDays(-5), addDays(40));
    await task(web, mark, 'Wireframes for landing page', { status: 'In Progress', priority: 'High', assignee: olivia, due: addDays(3) });
    await task(web, mark, 'Choose typography', { status: 'To Do', priority: 'Low', assignee: mark, due: addDays(-1) });

    await project('Internal Tools', 'OPS', 'Admin-owned project for internal tooling.', admin, [], addDays(-60), null);

    return users;
  });
}
