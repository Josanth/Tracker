import { Router } from 'express';
import { authenticate, publicUser } from '../auth.js';
import { loadProject, logActivity } from '../access.js';
import {
  Validator,
  PROJECT_KEY_RE,
  badRequest,
  conflict,
  forbidden,
  notFound,
  trimOrEmpty,
  emptyToNull,
  STATUSES,
} from '../util.js';

function validateProjectFields(body, { creating }) {
  const v = new Validator();
  const name = trimOrEmpty(body.name);
  const description = trimOrEmpty(body.description);
  const startDate = emptyToNull(body.startDate);
  const endDate = emptyToNull(body.endDate);
  v.required('name', name, 'Project name');
  if (name.length > 100) v.error('name', 'Project name must be 100 characters or fewer');
  let key;
  if (creating) {
    key = trimOrEmpty(body.key).toUpperCase();
    if (v.required('key', key, 'Project key') && !PROJECT_KEY_RE.test(key)) {
      v.error('key', 'Project key must be 2–10 letters/digits and start with a letter (e.g. LIB)');
    }
  }
  v.date('startDate', startDate, 'Start date');
  v.date('endDate', endDate, 'End date');
  if (startDate && endDate && !v.fields.startDate && !v.fields.endDate && endDate < startDate) {
    v.error('endDate', 'End date cannot be earlier than the start date');
  }
  v.throwIfAny();
  return { name, key, description, startDate, endDate };
}

export async function serializeProject(db, project, perms) {
  const owner = await db.get('SELECT * FROM users WHERE id = ?', project.owner_id);
  const members = (
    await db.all(
      `SELECT u.*, pm.added_at FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? ORDER BY u.name`,
      project.id
    )
  ).map((u) => ({ ...publicUser(u), isOwner: u.id === project.owner_id, addedAt: u.added_at }));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of await db.all('SELECT status, COUNT(*) AS n FROM tasks WHERE project_id = ? GROUP BY status', project.id)) {
    counts[row.status] = row.n;
  }
  return {
    id: project.id,
    name: project.name,
    key: project.key,
    description: project.description,
    owner: publicUser(owner),
    startDate: project.start_date,
    endDate: project.end_date,
    version: project.version,
    createdAt: project.created_at,
    members,
    taskCounts: counts,
    permissions: perms,
  };
}

export default function projectRoutes(db) {
  const r = Router();
  r.use('/projects', authenticate(db));

  r.get('/projects', async (req, res) => {
    const rows =
      req.user.role === 'admin'
        ? await db.all('SELECT * FROM projects ORDER BY name')
        : await db.all(
            `SELECT p.* FROM projects p JOIN project_members pm ON pm.project_id = p.id
             WHERE pm.user_id = ? ORDER BY p.name`,
            req.user.id
          );
    const projects = await Promise.all(
      rows.map(async (p) => {
        const owner = await db.get('SELECT * FROM users WHERE id = ?', p.owner_id);
        const stats = await db.get(`SELECT COUNT(*) AS total, SUM(status = 'Done') AS done FROM tasks WHERE project_id = ?`, p.id);
        const memberCount = (await db.get('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?', p.id)).n;
        return {
          id: p.id,
          name: p.name,
          key: p.key,
          description: p.description,
          owner: publicUser(owner),
          startDate: p.start_date,
          endDate: p.end_date,
          memberCount,
          taskTotal: stats.total,
          taskDone: stats.done || 0,
        };
      })
    );
    res.json({ projects });
  });

  r.post('/projects', async (req, res) => {
    const f = validateProjectFields(req.body, { creating: true });
    // Assumption A1: any registered user may create a project and becomes its owner.
    const projectId = await db.tx(async (t) => {
      if (await t.get('SELECT 1 FROM projects WHERE key = ?', f.key)) {
        throw conflict('PROJECT_KEY_TAKEN', `Project key "${f.key}" is already in use`, {
          fields: { key: `Project key "${f.key}" is already in use` },
        });
      }
      const info = await t.run(
        `INSERT INTO projects (name, key, description, owner_id, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        f.name,
        f.key,
        f.description,
        req.user.id,
        f.startDate,
        f.endDate
      );
      // The owner is always a member, so a project always has at least one member.
      await t.run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', info.lastInsertRowid, req.user.id);
      await logActivity(t, {
        projectId: info.lastInsertRowid,
        userId: req.user.id,
        action: 'project.created',
        detail: { name: f.name, key: f.key },
      });
      return info.lastInsertRowid;
    });
    const { project, perms } = await loadProject(db, projectId, req.user);
    res.status(201).json({ project: await serializeProject(db, project, perms) });
  });

  r.get('/projects/:id', async (req, res) => {
    const { project, perms } = await loadProject(db, req.params.id, req.user);
    res.json({ project: await serializeProject(db, project, perms) });
  });

  r.put('/projects/:id', async (req, res) => {
    const { project, perms } = await loadProject(db, req.params.id, req.user);
    if (!perms.canEditProject) throw forbidden('Only the project owner or an administrator can edit the project');
    if (req.body.key !== undefined && String(req.body.key).toUpperCase() !== project.key) {
      throw badRequest('Project key cannot be changed after creation', { key: 'Project key is immutable' });
    }
    const f = validateProjectFields(req.body, { creating: false });
    const { changes } = await db.tx(async (t) => {
      const info = await t.run(
        `UPDATE projects SET name = ?, description = ?, start_date = ?, end_date = ?,
           version = version + 1, updated_at = datetime('now')
         WHERE id = ? AND version = ?`,
        f.name,
        f.description,
        f.startDate,
        f.endDate,
        project.id,
        Number(req.body.version)
      );
      if (info.changes) {
        await logActivity(t, { projectId: project.id, userId: req.user.id, action: 'project.updated', detail: { name: f.name } });
      }
      return info;
    });
    const current = await db.get('SELECT * FROM projects WHERE id = ?', project.id);
    if (changes === 0) {
      throw conflict('VERSION_CONFLICT', 'This project was changed by someone else. Refresh to see the latest version.', {
        current: await serializeProject(db, current, perms),
      });
    }
    res.json({ project: await serializeProject(db, current, perms) });
  });

  r.post('/projects/:id/members', async (req, res) => {
    const { project, perms } = await loadProject(db, req.params.id, req.user);
    if (!perms.canManageMembers) throw forbidden('Only the project owner or an administrator can add members');
    const email = trimOrEmpty(req.body.email).toLowerCase();
    const userId = req.body.userId ? Number(req.body.userId) : null;
    if (!email && !userId) throw badRequest('Choose a user to add', { email: 'User is required' });
    const user = userId
      ? await db.get('SELECT * FROM users WHERE id = ?', userId)
      : await db.get('SELECT * FROM users WHERE email = ?', email);
    if (!user) throw notFound('No registered user with that email');
    await db.tx(async (t) => {
      if (await t.get('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', project.id, user.id)) {
        throw conflict('ALREADY_MEMBER', `${user.name} is already a member of this project`);
      }
      await t.run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', project.id, user.id);
      await logActivity(t, {
        projectId: project.id,
        userId: req.user.id,
        action: 'member.added',
        detail: { memberId: user.id, memberName: user.name },
      });
    });
    res.status(201).json({ project: await serializeProject(db, project, perms) });
  });

  r.delete('/projects/:id/members/:userId', async (req, res) => {
    const { project, perms } = await loadProject(db, req.params.id, req.user);
    if (!perms.canManageMembers) throw forbidden('Only the project owner or an administrator can remove members');
    const memberId = Number(req.params.userId);
    if (memberId === project.owner_id) {
      throw badRequest('The project owner cannot be removed; a project must keep at least one member');
    }
    const member = await db.get('SELECT * FROM users WHERE id = ?', memberId);
    const unassigned = await db.tx(async (t) => {
      const info = await t.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', project.id, memberId);
      if (info.changes === 0) throw notFound('That user is not a member of this project');
      // Assumption A3: tasks held by a removed member become unassigned (and are flagged in the activity log).
      const tasks = await t.all('SELECT id, number FROM tasks WHERE project_id = ? AND assignee_id = ?', project.id, memberId);
      await t.run(
        `UPDATE tasks SET assignee_id = NULL, version = version + 1, updated_at = datetime('now')
         WHERE project_id = ? AND assignee_id = ?`,
        project.id,
        memberId
      );
      for (const task of tasks) {
        await logActivity(t, {
          projectId: project.id,
          taskId: task.id,
          userId: req.user.id,
          action: 'task.unassigned',
          detail: { reason: 'member removed', from: member?.name },
        });
      }
      const keys = tasks.map((task) => `${project.key}-${task.number}`);
      await logActivity(t, {
        projectId: project.id,
        userId: req.user.id,
        action: 'member.removed',
        detail: { memberId, memberName: member?.name, unassignedTasks: keys },
      });
      return keys;
    });
    res.json({ project: await serializeProject(db, project, perms), unassignedTasks: unassigned });
  });

  r.get('/projects/:id/activity', async (req, res) => {
    const { project } = await loadProject(db, req.params.id, req.user);
    const rows = await db.all(
      `SELECT a.*, u.name AS user_name, t.number AS task_number FROM activity a
       JOIN users u ON u.id = a.user_id LEFT JOIN tasks t ON t.id = a.task_id
       WHERE a.project_id = ? ORDER BY a.id DESC LIMIT 200`,
      project.id
    );
    res.json({
      activity: rows.map((a) => ({
        id: a.id,
        action: a.action,
        detail: JSON.parse(a.detail),
        user: { id: a.user_id, name: a.user_name },
        taskId: a.task_id,
        taskKey: a.task_number ? `${project.key}-${a.task_number}` : null,
        createdAt: a.created_at,
      })),
    });
  });

  return r;
}
