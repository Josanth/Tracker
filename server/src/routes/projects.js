import { Router } from 'express';
import { authenticate, publicUser } from '../auth.js';
import { loadProject, logActivity } from '../access.js';
import { tx } from '../db.js';
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

export function serializeProject(db, project, perms) {
  const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(project.owner_id);
  const members = db
    .prepare(
      `SELECT u.*, pm.added_at FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? ORDER BY u.name`
    )
    .all(project.id)
    .map((u) => ({ ...publicUser(u), isOwner: u.id === project.owner_id, addedAt: u.added_at }));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of db
    .prepare('SELECT status, COUNT(*) AS n FROM tasks WHERE project_id = ? GROUP BY status')
    .all(project.id)) {
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

  r.get('/projects', (req, res) => {
    const rows =
      req.user.role === 'admin'
        ? db.prepare('SELECT * FROM projects ORDER BY name').all()
        : db
            .prepare(
              `SELECT p.* FROM projects p JOIN project_members pm ON pm.project_id = p.id
               WHERE pm.user_id = ? ORDER BY p.name`
            )
            .all(req.user.id);
    const projects = rows.map((p) => {
      const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(p.owner_id);
      const stats = db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(status = 'Done') AS done FROM tasks WHERE project_id = ?`
        )
        .get(p.id);
      const memberCount = db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?').get(p.id).n;
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
    });
    res.json({ projects });
  });

  r.post('/projects', (req, res) => {
    const f = validateProjectFields(req.body, { creating: true });
    // Assumption A1: any registered user may create a project and becomes its owner.
    const project = tx(db, () => {
      if (db.prepare('SELECT 1 FROM projects WHERE key = ?').get(f.key)) {
        throw conflict('PROJECT_KEY_TAKEN', `Project key "${f.key}" is already in use`, {
          fields: { key: `Project key "${f.key}" is already in use` },
        });
      }
      const info = db
        .prepare(
          `INSERT INTO projects (name, key, description, owner_id, start_date, end_date)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(f.name, f.key, f.description, req.user.id, f.startDate, f.endDate);
      // The owner is always a member, so a project always has at least one member.
      db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)').run(
        info.lastInsertRowid,
        req.user.id
      );
      logActivity(db, {
        projectId: info.lastInsertRowid,
        userId: req.user.id,
        action: 'project.created',
        detail: { name: f.name, key: f.key },
      });
      return db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
    });
    const { perms } = loadProject(db, project.id, req.user);
    res.status(201).json({ project: serializeProject(db, project, perms) });
  });

  r.get('/projects/:id', (req, res) => {
    const { project, perms } = loadProject(db, req.params.id, req.user);
    res.json({ project: serializeProject(db, project, perms) });
  });

  r.put('/projects/:id', (req, res) => {
    const { project, perms } = loadProject(db, req.params.id, req.user);
    if (!perms.canEditProject) throw forbidden('Only the project owner or an administrator can edit the project');
    if (req.body.key !== undefined && String(req.body.key).toUpperCase() !== project.key) {
      throw badRequest('Project key cannot be changed after creation', { key: 'Project key is immutable' });
    }
    const f = validateProjectFields(req.body, { creating: false });
    const updated = tx(db, () => {
      const info = db
        .prepare(
          `UPDATE projects SET name = ?, description = ?, start_date = ?, end_date = ?,
             version = version + 1, updated_at = datetime('now')
           WHERE id = ? AND version = ?`
        )
        .run(f.name, f.description, f.startDate, f.endDate, project.id, Number(req.body.version));
      const current = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
      if (info.changes === 0) {
        throw conflict('VERSION_CONFLICT', 'This project was changed by someone else. Refresh to see the latest version.', {
          current: serializeProject(db, current, perms),
        });
      }
      logActivity(db, { projectId: project.id, userId: req.user.id, action: 'project.updated', detail: { name: f.name } });
      return current;
    });
    res.json({ project: serializeProject(db, updated, perms) });
  });

  r.post('/projects/:id/members', (req, res) => {
    const { project, perms } = loadProject(db, req.params.id, req.user);
    if (!perms.canManageMembers) throw forbidden('Only the project owner or an administrator can add members');
    const email = trimOrEmpty(req.body.email).toLowerCase();
    const userId = req.body.userId ? Number(req.body.userId) : null;
    if (!email && !userId) throw badRequest('Choose a user to add', { email: 'User is required' });
    const user = userId
      ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
      : db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) throw notFound('No registered user with that email');
    tx(db, () => {
      const exists = db
        .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
        .get(project.id, user.id);
      if (exists) throw conflict('ALREADY_MEMBER', `${user.name} is already a member of this project`);
      db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)').run(project.id, user.id);
      logActivity(db, {
        projectId: project.id,
        userId: req.user.id,
        action: 'member.added',
        detail: { memberId: user.id, memberName: user.name },
      });
    });
    res.status(201).json({ project: serializeProject(db, project, perms) });
  });

  r.delete('/projects/:id/members/:userId', (req, res) => {
    const { project, perms } = loadProject(db, req.params.id, req.user);
    if (!perms.canManageMembers) throw forbidden('Only the project owner or an administrator can remove members');
    const memberId = Number(req.params.userId);
    if (memberId === project.owner_id) {
      throw badRequest('The project owner cannot be removed; a project must keep at least one member');
    }
    const member = db.prepare('SELECT * FROM users WHERE id = ?').get(memberId);
    const unassigned = tx(db, () => {
      const info = db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(project.id, memberId);
      if (info.changes === 0) throw notFound('That user is not a member of this project');
      // Assumption A3: tasks held by a removed member become unassigned (and are flagged in the activity log).
      const tasks = db
        .prepare('SELECT id, number FROM tasks WHERE project_id = ? AND assignee_id = ?')
        .all(project.id, memberId);
      db.prepare(
        `UPDATE tasks SET assignee_id = NULL, version = version + 1, updated_at = datetime('now')
         WHERE project_id = ? AND assignee_id = ?`
      ).run(project.id, memberId);
      for (const t of tasks) {
        logActivity(db, {
          projectId: project.id,
          taskId: t.id,
          userId: req.user.id,
          action: 'task.unassigned',
          detail: { reason: 'member removed', from: member?.name },
        });
      }
      logActivity(db, {
        projectId: project.id,
        userId: req.user.id,
        action: 'member.removed',
        detail: { memberId, memberName: member?.name, unassignedTasks: tasks.map((t) => `${project.key}-${t.number}`) },
      });
      return tasks.map((t) => `${project.key}-${t.number}`);
    });
    res.json({ project: serializeProject(db, project, perms), unassignedTasks: unassigned });
  });

  r.get('/projects/:id/activity', (req, res) => {
    const { project } = loadProject(db, req.params.id, req.user);
    const rows = db
      .prepare(
        `SELECT a.*, u.name AS user_name, t.number AS task_number FROM activity a
         JOIN users u ON u.id = a.user_id LEFT JOIN tasks t ON t.id = a.task_id
         WHERE a.project_id = ? ORDER BY a.id DESC LIMIT 200`
      )
      .all(project.id);
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
