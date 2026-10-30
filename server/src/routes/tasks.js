import { Router } from 'express';
import { authenticate, publicUser } from '../auth.js';
import { loadProject, loadTask, isProjectMember, logActivity } from '../access.js';
import { checkTransition, allowedTransitions } from '../workflow.js';
import {
  Validator,
  PRIORITIES,
  STATUSES,
  badRequest,
  conflict,
  forbidden,
  trimOrEmpty,
  emptyToNull,
  today,
} from '../util.js';

export const TASK_SELECT = `
  SELECT t.*, p.key AS project_key,
         a.name AS assignee_name, a.email AS assignee_email,
         r.name AS reporter_name, r.email AS reporter_email,
         (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN users a ON a.id = t.assignee_id
  JOIN users r ON r.id = t.reporter_id`;

export function serializeTask(row, now = today()) {
  return {
    id: row.id,
    key: `${row.project_key}-${row.number}`,
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name, email: row.assignee_email } : null,
    reporter: { id: row.reporter_id, name: row.reporter_name, email: row.reporter_email },
    dueDate: row.due_date,
    // BR-06: overdue is derived, never stored, so it can't drift out of sync.
    overdue: !!row.due_date && row.due_date < now && row.status !== 'Done',
    commentCount: row.comment_count,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireMember(perms) {
  if (!perms.isMember) throw forbidden('Only project members can work on this project\'s tasks');
}

async function validateAssignee(db, v, projectId, assigneeId) {
  if (assigneeId === null) return;
  if (!Number.isInteger(assigneeId) || !(await isProjectMember(db, projectId, assigneeId))) {
    v.error('assigneeId', 'A task can only be assigned to a member of this project'); // BR-03
  }
}

export default function taskRoutes(db) {
  const r = Router();
  const auth = authenticate(db);
  const getTask = (id) => db.get(`${TASK_SELECT} WHERE t.id = ?`, id);

  r.get('/projects/:id/tasks', auth, async (req, res) => {
    const { project } = await loadProject(db, req.params.id, req.user);
    const where = ['t.project_id = ?'];
    const params = [project.id];
    const q = trimOrEmpty(req.query.q);
    if (q) {
      where.push('t.title LIKE ?');
      params.push(`%${q}%`);
    }
    if (req.query.status) {
      where.push('t.status = ?');
      params.push(req.query.status);
    }
    if (req.query.priority) {
      where.push('t.priority = ?');
      params.push(req.query.priority);
    }
    if (req.query.assignee === 'unassigned') {
      where.push('t.assignee_id IS NULL');
    } else if (req.query.assignee === 'me') {
      where.push('t.assignee_id = ?');
      params.push(req.user.id);
    } else if (req.query.assignee) {
      where.push('t.assignee_id = ?');
      params.push(Number(req.query.assignee));
    }
    if (req.query.overdue === 'true') {
      where.push("t.due_date < ? AND t.status <> 'Done'");
      params.push(today());
    }
    const rows = await db.all(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.number DESC`, ...params);
    res.json({ tasks: rows.map((row) => serializeTask(row)) });
  });

  r.post('/projects/:id/tasks', auth, async (req, res) => {
    const { project, perms } = await loadProject(db, req.params.id, req.user);
    requireMember(perms);
    const title = trimOrEmpty(req.body.title);
    const description = trimOrEmpty(req.body.description);
    const priority = req.body.priority || 'Medium';
    const dueDate = emptyToNull(req.body.dueDate);
    const assigneeId = emptyToNull(req.body.assigneeId) === null ? null : Number(req.body.assigneeId);
    const clientRequestId = emptyToNull(req.body.clientRequestId);

    const v = new Validator();
    v.required('title', title, 'Task title');
    if (title.length > 200) v.error('title', 'Task title must be 200 characters or fewer');
    if (!PRIORITIES.includes(priority)) v.error('priority', 'Priority must be Low, Medium or High');
    if (v.date('dueDate', dueDate, 'Due date') && dueDate && dueDate < today()) {
      v.error('dueDate', 'Due date cannot be in the past');
    }
    await validateAssignee(db, v, project.id, assigneeId);
    v.throwIfAny();

    const result = await db.tx(async (t) => {
      // Idempotency: a retried submit (refresh, double click, network retry) carries the same
      // clientRequestId and gets the original task back instead of a duplicate.
      if (clientRequestId) {
        const existing = await t.get('SELECT id FROM tasks WHERE project_id = ? AND client_request_id = ?', project.id, String(clientRequestId));
        if (existing) return { id: existing.id, replay: true };
      }
      // Allocate the next number under the write lock so IDs are unique within the project.
      const { next_task_number: number } = await t.get('SELECT next_task_number FROM projects WHERE id = ?', project.id);
      await t.run('UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = ?', project.id);
      const info = await t.run(
        `INSERT INTO tasks (project_id, number, title, description, priority, assignee_id, reporter_id, due_date, client_request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        project.id,
        number,
        title,
        description,
        priority,
        assigneeId,
        req.user.id,
        dueDate,
        clientRequestId === null ? null : String(clientRequestId)
      );
      await logActivity(t, {
        projectId: project.id,
        taskId: info.lastInsertRowid,
        userId: req.user.id,
        action: 'task.created',
        detail: { title },
      });
      return { id: info.lastInsertRowid, replay: false };
    });
    res.status(result.replay ? 200 : 201);
    if (result.replay) res.set('Idempotent-Replay', 'true');
    res.json({ task: serializeTask(await getTask(result.id)) });
  });

  r.get('/tasks/:taskId', auth, async (req, res) => {
    const { task, perms } = await loadTask(db, req.params.taskId, req.user);
    const comments = (
      await db.all(
        `SELECT c.*, u.name, u.email FROM comments c JOIN users u ON u.id = c.author_id
         WHERE c.task_id = ? ORDER BY c.id`,
        task.id
      )
    ).map((c) => ({ id: c.id, body: c.body, author: { id: c.author_id, name: c.name, email: c.email }, createdAt: c.created_at }));
    const activity = (
      await db.all(
        `SELECT a.*, u.name AS user_name FROM activity a JOIN users u ON u.id = a.user_id
         WHERE a.task_id = ? ORDER BY a.id DESC`,
        task.id
      )
    ).map((a) => ({ id: a.id, action: a.action, detail: JSON.parse(a.detail), user: { id: a.user_id, name: a.user_name }, createdAt: a.created_at }));
    const isReporter = task.reporter_id === req.user.id;
    res.json({
      task: serializeTask(await getTask(task.id)),
      comments,
      activity,
      permissions: {
        canEdit: perms.isMember,
        canDelete: perms.isMember && (isReporter || perms.isOwner), // BR-07
        allowedStatuses: perms.isMember ? allowedTransitions(task.status, perms) : [],
      },
    });
  });

  r.patch('/tasks/:taskId', auth, async (req, res) => {
    const { task, perms } = await loadTask(db, req.params.taskId, req.user);
    requireMember(perms);
    const body = req.body;
    if (body.version === undefined) throw badRequest('version is required for updates', { version: 'Required' });

    const v = new Validator();
    const changes = {};
    if (body.title !== undefined) {
      changes.title = trimOrEmpty(body.title);
      v.required('title', changes.title, 'Task title');
    }
    if (body.description !== undefined) changes.description = trimOrEmpty(body.description);
    if (body.priority !== undefined) {
      changes.priority = body.priority;
      if (!PRIORITIES.includes(body.priority)) v.error('priority', 'Priority must be Low, Medium or High');
    }
    if (body.dueDate !== undefined) {
      changes.due_date = emptyToNull(body.dueDate);
      // Existing past due dates may stay as they are, but a changed due date can't be set in the past.
      if (v.date('dueDate', changes.due_date, 'Due date') && changes.due_date && changes.due_date !== task.due_date && changes.due_date < today()) {
        v.error('dueDate', 'Due date cannot be in the past');
      }
    }
    if (body.assigneeId !== undefined) {
      changes.assignee_id = emptyToNull(body.assigneeId) === null ? null : Number(body.assigneeId);
      await validateAssignee(db, v, task.project_id, changes.assignee_id);
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) v.error('status', `Unknown status "${body.status}"`);
      else {
        const problem = checkTransition(task.status, body.status, perms);
        if (problem) {
          throw conflict('INVALID_TRANSITION', problem, {
            from: task.status,
            to: body.status,
            allowed: allowedTransitions(task.status, perms),
          });
        }
        changes.status = body.status;
      }
    }
    v.throwIfAny();

    const columns = Object.keys(changes);
    const stale = await db.tx(async (t) => {
      if (!columns.length) {
        const { version } = await t.get('SELECT version FROM tasks WHERE id = ?', task.id);
        return Number(body.version) !== version;
      }
      const sets = columns.map((c) => `${c} = ?`).join(', ');
      // Optimistic locking: the update only applies if nobody else changed the task since the client loaded it.
      const info = await t.run(
        `UPDATE tasks SET ${sets}, version = version + 1, updated_at = datetime('now') WHERE id = ? AND version = ?`,
        ...columns.map((c) => changes[c]),
        task.id,
        Number(body.version)
      );
      if (info.changes === 0) return true;
      const diff = {};
      for (const c of columns) if (task[c] !== changes[c]) diff[c] = { from: task[c], to: changes[c] };
      if (diff.assignee_id) {
        const name = async (id) => (id ? (await t.get('SELECT name FROM users WHERE id = ?', id))?.name : null);
        diff.assignee_id = { from: await name(diff.assignee_id.from), to: await name(diff.assignee_id.to) };
      }
      if (Object.keys(diff).length) {
        await logActivity(t, { projectId: task.project_id, taskId: task.id, userId: req.user.id, action: 'task.updated', detail: diff });
      }
      return false;
    });
    const current = serializeTask(await getTask(task.id));
    if (stale) {
      throw conflict('VERSION_CONFLICT', 'This task was changed by someone else. Review the latest version and try again.', { current });
    }
    res.json({ task: current });
  });

  r.delete('/tasks/:taskId', auth, async (req, res) => {
    const { task, perms } = await loadTask(db, req.params.taskId, req.user);
    requireMember(perms);
    if (task.reporter_id !== req.user.id && !perms.isOwner) {
      throw forbidden('Only the reporter or the project owner can delete a task'); // BR-07
    }
    await db.tx(async (t) => {
      await t.run('DELETE FROM comments WHERE task_id = ?', task.id);
      await t.run('DELETE FROM tasks WHERE id = ?', task.id);
      await logActivity(t, {
        projectId: task.project_id,
        userId: req.user.id,
        action: 'task.deleted',
        detail: { number: task.number, title: task.title },
      });
    });
    res.status(204).end();
  });

  r.post('/tasks/:taskId/comments', auth, async (req, res) => {
    const { task, perms } = await loadTask(db, req.params.taskId, req.user);
    requireMember(perms);
    const body = trimOrEmpty(req.body.body);
    const v = new Validator();
    v.required('body', body, 'Comment');
    if (body.length > 5000) v.error('body', 'Comment must be 5000 characters or fewer');
    v.throwIfAny();
    const comment = await db.tx(async (t) => {
      const info = await t.run('INSERT INTO comments (task_id, author_id, body) VALUES (?, ?, ?)', task.id, req.user.id, body);
      await logActivity(t, { projectId: task.project_id, taskId: task.id, userId: req.user.id, action: 'comment.added', detail: {} });
      return t.get('SELECT * FROM comments WHERE id = ?', info.lastInsertRowid);
    });
    res.status(201).json({
      comment: { id: comment.id, body: comment.body, author: publicUser(req.user), createdAt: comment.created_at },
    });
  });

  return r;
}
