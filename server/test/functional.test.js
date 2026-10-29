import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, daysFromToday } from './helpers.js';

let s;
before(async () => (s = await startServer()));
after(() => s.close());

test('TC-F-01 user registration creates an account and returns a session', async () => {
  const res = await s.call('POST', '/auth/register', {
    body: { name: 'Reg User', email: 'Reg.User@Example.com', password: 'longenough' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'reg.user@example.com', 'email is normalised to lower case');
  assert.ok(res.body.token);
  const me = await s.call('GET', '/me', { token: res.body.token });
  assert.equal(me.body.user.name, 'Reg User');
});

test('TC-F-01b first registered user is the administrator, later users are not', async () => {
  const fresh = await startServer();
  try {
    const first = await fresh.register('First');
    const second = await fresh.register('Second');
    assert.equal(first.role, 'admin');
    assert.equal(second.role, 'user');
  } finally {
    await fresh.close();
  }
});

test('TC-F-02 login with valid credentials, then logout invalidates the token', async () => {
  await s.call('POST', '/auth/register', { body: { name: 'Login', email: 'login@example.com', password: 'Password123' } });
  const res = await s.call('POST', '/auth/login', { body: { email: 'LOGIN@example.com', password: 'Password123' } });
  assert.equal(res.status, 200);
  const token = res.body.token;
  assert.equal((await s.call('GET', '/me', { token })).status, 200);
  assert.equal((await s.call('POST', '/auth/logout', { token })).status, 204);
  assert.equal((await s.call('GET', '/me', { token })).status, 401);
});

test('TC-F-03 password reset with a one-time token', async () => {
  await s.call('POST', '/auth/register', { body: { name: 'Forgetful', email: 'forget@example.com', password: 'Password123' } });
  const req = await s.call('POST', '/auth/forgot-password', { body: { email: 'forget@example.com' } });
  assert.equal(req.status, 200);
  const token = req.body.devResetToken;
  assert.ok(token);
  const reset = await s.call('POST', '/auth/reset-password', { body: { token, password: 'BrandNew123' } });
  assert.equal(reset.status, 200);
  assert.equal((await s.call('POST', '/auth/login', { body: { email: 'forget@example.com', password: 'BrandNew123' } })).status, 200);
  assert.equal((await s.call('POST', '/auth/login', { body: { email: 'forget@example.com', password: 'Password123' } })).status, 401);
  const reuse = await s.call('POST', '/auth/reset-password', { body: { token, password: 'Another123' } });
  assert.equal(reuse.status, 400, 'reset token is single-use');
});

test('TC-F-04 profile can be updated', async () => {
  const u = await s.register('Profile');
  const res = await s.call('PUT', '/me', { token: u.token, body: { name: 'Profile Renamed', email: u.email } });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, 'Profile Renamed');
});

test('TC-F-05 create a project: creator becomes owner and first member', async () => {
  const owner = await s.register('Owner');
  const res = await s.call('POST', '/projects', {
    token: owner.token,
    body: { name: 'Library', key: 'lib', description: 'Books', startDate: '2026-01-01', endDate: '2026-12-31' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.project.key, 'LIB', 'key is upper-cased');
  assert.equal(res.body.project.owner.id, owner.id);
  assert.deepEqual(res.body.project.members.map((m) => m.id), [owner.id]);
  const list = await s.call('GET', '/projects', { token: owner.token });
  assert.ok(list.body.projects.some((p) => p.key === 'LIB'));
});

test('TC-F-06 edit project details', async () => {
  const owner = await s.register('Editor');
  const p = await s.createProject(owner);
  const res = await s.call('PUT', `/projects/${p.id}`, {
    token: owner.token,
    body: { name: 'Renamed', description: 'New', version: p.version },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.project.name, 'Renamed');
});

test('TC-F-07 add a project member', async () => {
  const owner = await s.register('Owner');
  const member = await s.register('Member');
  const p = await s.createProject(owner);
  const res = await s.addMember(owner, p, member);
  assert.equal(res.status, 201);
  assert.ok(res.body.project.members.some((m) => m.id === member.id));
  const view = await s.call('GET', `/projects/${p.id}`, { token: member.token });
  assert.equal(view.status, 200, 'new member can open the project');
});

test('TC-F-08 create and assign a task: IDs use the project key and increment', async () => {
  const owner = await s.register('Owner');
  const dev = await s.register('Dev');
  const p = await s.createProject(owner, { key: 'ABC' });
  await s.addMember(owner, p, dev);
  const t1 = await s.createTask(owner, p, { title: 'First', priority: 'High', assigneeId: dev.id, dueDate: daysFromToday(3) });
  const t2 = await s.createTask(dev, p, { title: 'Second' });
  assert.equal(t1.status, 201);
  assert.equal(t1.body.task.key, 'ABC-1');
  assert.equal(t1.body.task.assignee.id, dev.id);
  assert.equal(t1.body.task.reporter.id, owner.id);
  assert.equal(t1.body.task.status, 'To Do');
  assert.equal(t2.body.task.key, 'ABC-2');
  assert.equal(t2.body.task.priority, 'Medium', 'priority defaults to Medium');
});

test('TC-F-09 change task status through the workflow', async () => {
  const owner = await s.register('Owner');
  const p = await s.createProject(owner);
  let task = (await s.createTask(owner, p)).body.task;
  for (const status of ['In Progress', 'In Review', 'Done']) {
    const res = await s.call('PATCH', `/tasks/${task.id}`, { token: owner.token, body: { status, version: task.version } });
    assert.equal(res.status, 200, `move to ${status}`);
    task = res.body.task;
    assert.equal(task.status, status);
  }
  // BR-05: owner can reopen
  const reopen = await s.call('PATCH', `/tasks/${task.id}`, { token: owner.token, body: { status: 'In Progress', version: task.version } });
  assert.equal(reopen.status, 200);
});

test('TC-F-10 search tasks by title and filter by status, priority, assignee', async () => {
  const owner = await s.register('Owner');
  const dev = await s.register('Dev');
  const p = await s.createProject(owner);
  await s.addMember(owner, p, dev);
  await s.createTask(owner, p, { title: 'Fix login bug', priority: 'High', assigneeId: dev.id });
  await s.createTask(owner, p, { title: 'Write login docs', priority: 'Low' });
  const t3 = (await s.createTask(owner, p, { title: 'Refactor board', priority: 'High', assigneeId: dev.id })).body.task;
  await s.call('PATCH', `/tasks/${t3.id}`, { token: owner.token, body: { status: 'In Progress', version: t3.version } });

  const get = async (qs) => (await s.call('GET', `/projects/${p.id}/tasks?${qs}`, { token: owner.token })).body.tasks.map((t) => t.title).sort();
  assert.deepEqual(await get('q=login'), ['Fix login bug', 'Write login docs']);
  assert.deepEqual(await get('q=LOGIN'), ['Fix login bug', 'Write login docs'], 'search is case-insensitive');
  assert.deepEqual(await get('status=In%20Progress'), ['Refactor board']);
  assert.deepEqual(await get('priority=High'), ['Fix login bug', 'Refactor board']);
  assert.deepEqual(await get(`assignee=${dev.id}`), ['Fix login bug', 'Refactor board']);
  assert.deepEqual(await get('assignee=unassigned'), ['Write login docs']);
  assert.deepEqual(await get(`q=login&priority=High&assignee=${dev.id}`), ['Fix login bug']);
});

test('TC-F-11 add a comment to a task', async () => {
  const owner = await s.register('Owner');
  const p = await s.createProject(owner);
  const task = (await s.createTask(owner, p)).body.task;
  const res = await s.call('POST', `/tasks/${task.id}/comments`, { token: owner.token, body: { body: '  Looks good  ' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.comment.body, 'Looks good');
  const detail = await s.call('GET', `/tasks/${task.id}`, { token: owner.token });
  assert.equal(detail.body.comments.length, 1);
  assert.ok(detail.body.activity.some((a) => a.action === 'comment.added'), 'activity log records the comment');
});

test('TC-F-12 dashboards: my tasks, due this week, overdue, admin totals', async () => {
  const owner = await s.register('Owner');
  const dev = await s.register('Dev');
  const p = await s.createProject(owner);
  await s.addMember(owner, p, dev);
  await s.createTask(owner, p, { title: 'Due today', assigneeId: dev.id, dueDate: daysFromToday(0) });
  const late = (await s.createTask(owner, p, { title: 'Late', assigneeId: dev.id, dueDate: daysFromToday(1) })).body.task;
  // Force a past due date directly (the API refuses to create one).
  s.db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(daysFromToday(-3), late.id);

  const dash = (await s.call('GET', '/dashboard', { token: dev.token })).body;
  assert.equal(dash.personal.assignedToMe.length, 2);
  assert.deepEqual(dash.personal.dueThisWeek.map((t) => t.title), ['Due today']);
  assert.deepEqual(dash.personal.overdue.map((t) => t.title), ['Late']);
  assert.equal(dash.personal.overdue[0].overdue, true);
  assert.equal(dash.management, null, 'plain members get no management section');

  const ownerDash = (await s.call('GET', '/dashboard', { token: owner.token })).body.management;
  assert.equal(ownerDash.scope, 'owned');
  assert.equal(ownerDash.totalProjects, 1);
  assert.equal(ownerDash.totalUsers, 2);
  assert.equal(ownerDash.tasksByStatus['To Do'], 2);
  assert.equal(ownerDash.overdue.length, 1);
  assert.equal(ownerDash.tasksPerMember[0].user.id, dev.id);
  assert.equal(ownerDash.tasksPerMember[0].total, 2);
});

test('TC-F-13 reporter can delete own task; owner can delete any task (BR-07)', async () => {
  const owner = await s.register('Owner');
  const dev = await s.register('Dev');
  const p = await s.createProject(owner);
  await s.addMember(owner, p, dev);
  const mine = (await s.createTask(dev, p)).body.task;
  const other = (await s.createTask(dev, p)).body.task;
  assert.equal((await s.call('DELETE', `/tasks/${mine.id}`, { token: dev.token })).status, 204);
  assert.equal((await s.call('DELETE', `/tasks/${other.id}`, { token: owner.token })).status, 204);
});
