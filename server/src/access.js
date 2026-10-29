import { forbidden, notFound } from './util.js';

// Loads a project and enforces BR-01 (members only; administrators may also view).
export function loadProject(db, projectId, user) {
  const id = Number(projectId);
  const project = Number.isInteger(id) ? db.prepare('SELECT * FROM projects WHERE id = ?').get(id) : null;
  if (!project) throw notFound('Project not found');
  const isMember = !!db
    .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(project.id, user.id);
  const isAdmin = user.role === 'admin';
  if (!isMember && !isAdmin) throw forbidden('You are not a member of this project');
  const isOwner = project.owner_id === user.id;
  return {
    project,
    perms: {
      isMember,
      isOwner,
      isAdmin,
      canEditProject: isOwner || isAdmin,
      canManageMembers: isOwner || isAdmin, // BR-02
      canReopen: isOwner, // BR-05
    },
  };
}

export function loadTask(db, taskId, user) {
  const id = Number(taskId);
  const task = Number.isInteger(id) ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) : null;
  if (!task) throw notFound('Task not found');
  const ctx = loadProject(db, task.project_id, user);
  return { task, ...ctx };
}

export function isProjectMember(db, projectId, userId) {
  return !!db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
}

export function logActivity(db, { projectId, taskId = null, userId, action, detail = {} }) {
  db.prepare('INSERT INTO activity (project_id, task_id, user_id, action, detail) VALUES (?, ?, ?, ?, ?)').run(
    projectId,
    taskId,
    userId,
    action,
    JSON.stringify(detail)
  );
}
