import { Router } from 'express';
import { authenticate } from '../auth.js';
import { STATUSES, today, endOfWeek } from '../util.js';
import { serializeTask, TASK_SELECT } from './tasks.js';

export default function dashboardRoutes(db) {
  const r = Router();

  r.get('/dashboard', authenticate(db), (req, res) => {
    const now = today();
    const weekEnd = endOfWeek();
    const uid = req.user.id;
    const list = (sql, ...params) => db.prepare(`${TASK_SELECT} ${sql}`).all(...params).map((row) => serializeTask(row, now));

    const personal = {
      assignedToMe: list(`WHERE t.assignee_id = ? AND t.status <> 'Done' ORDER BY t.due_date IS NULL, t.due_date`, uid),
      dueThisWeek: list(
        `WHERE t.assignee_id = ? AND t.status <> 'Done' AND t.due_date BETWEEN ? AND ? ORDER BY t.due_date`,
        uid,
        now,
        weekEnd
      ),
      overdue: list(`WHERE t.assignee_id = ? AND t.status <> 'Done' AND t.due_date < ? ORDER BY t.due_date`, uid, now),
    };

    // Admins see the whole system; project owners see the projects they own.
    const isAdmin = req.user.role === 'admin';
    const ownedIds = db.prepare('SELECT id FROM projects WHERE owner_id = ?').all(uid).map((p) => p.id);
    let management = null;
    if (isAdmin || ownedIds.length) {
      const projectIds = isAdmin ? db.prepare('SELECT id FROM projects').all().map((p) => p.id) : ownedIds;
      const inList = projectIds.length ? projectIds.join(',') : 'NULL'; // integers from the DB, safe to inline
      const tasksByStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
      for (const row of db.prepare(`SELECT status, COUNT(*) AS n FROM tasks WHERE project_id IN (${inList}) GROUP BY status`).all()) {
        tasksByStatus[row.status] = row.n;
      }
      const totalUsers = isAdmin
        ? db.prepare('SELECT COUNT(*) AS n FROM users').get().n
        : db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM project_members WHERE project_id IN (${inList})`).get().n;
      const tasksPerMember = db
        .prepare(
          `SELECT u.id, u.name,
                  COUNT(t.id) AS total,
                  SUM(t.status <> 'Done') AS open,
                  SUM(t.status <> 'Done' AND t.due_date < ?) AS overdue
           FROM tasks t JOIN users u ON u.id = t.assignee_id
           WHERE t.project_id IN (${inList})
           GROUP BY u.id ORDER BY total DESC, u.name`
        )
        .all(now)
        .map((m) => ({ user: { id: m.id, name: m.name }, total: m.total, open: m.open || 0, overdue: m.overdue || 0 }));
      const unassigned = db
        .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE project_id IN (${inList}) AND assignee_id IS NULL AND status <> 'Done'`)
        .get().n;
      management = {
        scope: isAdmin ? 'all' : 'owned',
        totalProjects: projectIds.length,
        totalUsers,
        tasksByStatus,
        overdue: list(`WHERE t.project_id IN (${inList}) AND t.status <> 'Done' AND t.due_date < ? ORDER BY t.due_date`, now),
        tasksPerMember,
        unassignedOpen: unassigned,
      };
    }
    res.json({ today: now, weekEnd, personal, management });
  });

  return r;
}
