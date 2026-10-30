import { Router } from 'express';
import { authenticate } from '../auth.js';
import { STATUSES, today, endOfWeek } from '../util.js';
import { serializeTask, TASK_SELECT } from './tasks.js';

export default function dashboardRoutes(db) {
  const r = Router();

  r.get('/dashboard', authenticate(db), async (req, res) => {
    const now = today();
    const weekEnd = endOfWeek();
    const uid = req.user.id;
    const list = async (sql, ...params) => (await db.all(`${TASK_SELECT} ${sql}`, ...params)).map((row) => serializeTask(row, now));

    const personal = {
      assignedToMe: await list(`WHERE t.assignee_id = ? AND t.status <> 'Done' ORDER BY t.due_date IS NULL, t.due_date`, uid),
      dueThisWeek: await list(
        `WHERE t.assignee_id = ? AND t.status <> 'Done' AND t.due_date BETWEEN ? AND ? ORDER BY t.due_date`,
        uid,
        now,
        weekEnd
      ),
      overdue: await list(`WHERE t.assignee_id = ? AND t.status <> 'Done' AND t.due_date < ? ORDER BY t.due_date`, uid, now),
    };

    // Admins see the whole system; project owners see the projects they own.
    const isAdmin = req.user.role === 'admin';
    const ownedIds = (await db.all('SELECT id FROM projects WHERE owner_id = ?', uid)).map((p) => p.id);
    let management = null;
    if (isAdmin || ownedIds.length) {
      const projectIds = isAdmin ? (await db.all('SELECT id FROM projects')).map((p) => p.id) : ownedIds;
      const inList = projectIds.length ? projectIds.map(Number).join(',') : 'NULL'; // integers from the DB, safe to inline
      const tasksByStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
      for (const row of await db.all(`SELECT status, COUNT(*) AS n FROM tasks WHERE project_id IN (${inList}) GROUP BY status`)) {
        tasksByStatus[row.status] = row.n;
      }
      const totalUsers = isAdmin
        ? (await db.get('SELECT COUNT(*) AS n FROM users')).n
        : (await db.get(`SELECT COUNT(DISTINCT user_id) AS n FROM project_members WHERE project_id IN (${inList})`)).n;
      const tasksPerMember = (
        await db.all(
          `SELECT u.id, u.name,
                  COUNT(t.id) AS total,
                  SUM(t.status <> 'Done') AS open,
                  SUM(t.status <> 'Done' AND t.due_date < ?) AS overdue
           FROM tasks t JOIN users u ON u.id = t.assignee_id
           WHERE t.project_id IN (${inList})
           GROUP BY u.id ORDER BY total DESC, u.name`,
          now
        )
      ).map((m) => ({ user: { id: m.id, name: m.name }, total: m.total, open: m.open || 0, overdue: m.overdue || 0 }));
      const unassigned = (
        await db.get(`SELECT COUNT(*) AS n FROM tasks WHERE project_id IN (${inList}) AND assignee_id IS NULL AND status <> 'Done'`)
      ).n;
      management = {
        scope: isAdmin ? 'all' : 'owned',
        totalProjects: projectIds.length,
        totalUsers,
        tasksByStatus,
        overdue: await list(`WHERE t.project_id IN (${inList}) AND t.status <> 'Done' AND t.due_date < ? ORDER BY t.due_date`, now),
        tasksPerMember,
        unassignedOpen: unassigned,
      };
    }
    res.json({ today: now, weekEnd, personal, management });
  });

  return r;
}
