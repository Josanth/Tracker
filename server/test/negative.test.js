import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, daysFromToday } from './helpers.js';

let s;
before(async () => (s = await startServer()));
after(() => s.close());

test('TC-N-01 invalid login: wrong password and unknown email give the same 401', async () => {
  await s.call('POST', '/auth/register', { body: { name: 'Val', email: 'val@example.com', password: 'Password123' } });
  const wrong = await s.call('POST', '/auth/login', { body: { email: 'val@example.com', password: 'nope-nope' } });
  const unknown = await s.call('POST', '/auth/login', { body: { email: 'ghost@example.com', password: 'Password123' } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error.message, unknown.body.error.message);
});

test('TC-N-02 registration validation: empty fields, bad email, short password, duplicate email', async () => {
  const empty = await s.call('POST', '/auth/register', { body: { name: ' ', email: '', password: '' } });
  assert.equal(empty.status, 400);
  assert.deepEqual(Object.keys(empty.body.error.fields).sort(), ['email', 'name', 'password']);

  for (const email of ['plainaddress', 'a@b', 'no@tld.', 'sp ace@x.com', '@missing.com']) {
    const res = await s.call('POST', '/auth/register', { body: { name: 'X', email, password: 'Password123' } });
    assert.equal(res.status, 400, `rejects ${email}`);
    assert.ok(res.body.error.fields.email);
  }

  const short = await s.call('POST', '/auth/register', { body: { name: 'X', email: 'short@example.com', password: '1234567' } });
  assert.equal(short.status, 400);
  assert.match(short.body.error.fields.password, /8 characters/);

  await s.call('POST', '/auth/register', { body: { name: 'Dup', email: 'dup@example.com', password: 'Password123' } });
  const dup = await s.call('POST', '/auth/register', { body: { name: 'Dup2', email: 'DUP@example.com', password: 'Password123' } });
  assert.equal(dup.status, 409, 'email uniqueness is case-insensitive');
});

test('TC-N-03 project validation: empty name, bad/duplicate key, end before start', async () => {
  const u = await s.register();
  const empty = await s.call('POST', '/projects', { token: u.token, body: { name: '', key: '' } });
  assert.equal(empty.status, 400);
  assert.ok(empty.body.error.fields.name && empty.body.error.fields.key);

  const badKey = await s.call('POST', '/projects', { token: u.token, body: { name: 'P', key: '1A' } });
  assert.equal(badKey.status, 400);

  const dates = await s.call('POST', '/projects', {
    token: u.token,
    body: { name: 'P', key: 'DATES', startDate: '2026-05-10', endDate: '2026-05-09' },
  });
  assert.equal(dates.status, 400);
  assert.match(dates.body.error.fields.endDate, /earlier than the start date/);

  await s.call('POST', '/projects', { token: u.token, body: { name: 'P', key: 'DUPK' } });
  const dup = await s.call('POST', '/projects', { token: u.token, body: { name: 'P2', key: 'dupk' } });
  assert.equal(dup.status, 409);
});

test('TC-N-04 project key cannot be changed and owner cannot be removed', async () => {
  const owner = await s.register();
  const p = await s.createProject(owner);
  const rekey = await s.call('PUT', `/projects/${p.id}`, { token: owner.token, body: { name: 'X', key: 'NEWKEY', version: p.version } });
  assert.equal(rekey.status, 400);
  const remove = await s.call('DELETE', `/projects/${p.id}/members/${owner.id}`, { token: owner.token });
  assert.equal(remove.status, 400, 'a project always keeps at least one member (the owner)');
});

test('TC-N-05 task validation: empty title, past due date, empty comment', async () => {
  const owner = await s.register();
  const p = await s.createProject(owner);
  const empty = await s.createTask(owner, p, { title: '   ' });
  assert.equal(empty.status, 400);
  assert.ok(empty.body.error.fields.title);

  const past = await s.createTask(owner, p, { title: 'Old', dueDate: daysFromToday(-1) });
  assert.equal(past.status, 400);
  assert.match(past.body.error.fields.dueDate, /past/);

  const bogusDate = await s.createTask(owner, p, { title: 'Bad date', dueDate: '2026-02-30' });
  assert.equal(bogusDate.status, 400);

  const t = (await s.createTask(owner, p)).body.task;
  const comment = await s.call('POST', `/tasks/${t.id}/comments`, { token: owner.token, body: { body: '   ' } });
  assert.equal(comment.status, 400);
});

test('TC-N-06 assigning a task to a non-member is rejected (BR-03)', async () => {
  const owner = await s.register();
  const outsider = await s.register();
  const p = await s.createProject(owner);
  const create = await s.createTask(owner, p, { title: 'T', assigneeId: outsider.id });
  assert.equal(create.status, 400);
  assert.match(create.body.error.fields.assigneeId, /member of this project/);

  const t = (await s.createTask(owner, p)).body.task;
  const update = await s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { assigneeId: outsider.id, version: t.version } });
  assert.equal(update.status, 400);
});

test('TC-N-07 non-member cannot view or work on a project (BR-01)', async () => {
  const owner = await s.register();
  const outsider = await s.register();
  const p = await s.createProject(owner);
  const t = (await s.createTask(owner, p)).body.task;
  const checks = [
    ['GET', `/projects/${p.id}`],
    ['GET', `/projects/${p.id}/tasks`],
    ['POST', `/projects/${p.id}/tasks`, { title: 'sneaky' }],
    ['GET', `/tasks/${t.id}`],
    ['PATCH', `/tasks/${t.id}`, { title: 'hijack', version: t.version }],
    ['POST', `/tasks/${t.id}/comments`, { body: 'hi' }],
    ['GET', `/projects/${p.id}/activity`],
  ];
  for (const [method, path, body] of checks) {
    const res = await s.call(method, path, { token: outsider.token, body });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  const list = await s.call('GET', '/projects', { token: outsider.token });
  assert.ok(!list.body.projects.some((x) => x.id === p.id), 'project hidden from non-member list');
  assert.equal((await s.call('GET', `/projects/${p.id}`)).status, 401, 'anonymous request is 401');
});

test('TC-N-08 only owner/admin can manage members (BR-02)', async () => {
  const owner = await s.register();
  const member = await s.register();
  const third = await s.register();
  const p = await s.createProject(owner);
  await s.addMember(owner, p, member);
  const add = await s.call('POST', `/projects/${p.id}/members`, { token: member.token, body: { userId: third.id } });
  assert.equal(add.status, 403);
  const remove = await s.call('DELETE', `/projects/${p.id}/members/${owner.id}`, { token: member.token });
  assert.equal(remove.status, 403);
  const edit = await s.call('PUT', `/projects/${p.id}`, { token: member.token, body: { name: 'mine now', version: p.version } });
  assert.equal(edit.status, 403);
});

test('TC-N-09 only reporter or owner can delete a task (BR-07)', async () => {
  const owner = await s.register();
  const a = await s.register();
  const b = await s.register();
  const p = await s.createProject(owner);
  await s.addMember(owner, p, a);
  await s.addMember(owner, p, b);
  const t = (await s.createTask(a, p)).body.task;
  assert.equal((await s.call('DELETE', `/tasks/${t.id}`, { token: b.token })).status, 403);
});

test('TC-N-10 only the owner can reopen a Done task (BR-05)', async () => {
  const owner = await s.register();
  const dev = await s.register();
  const p = await s.createProject(owner);
  await s.addMember(owner, p, dev);
  let t = (await s.createTask(dev, p)).body.task;
  for (const status of ['In Progress', 'In Review', 'Done']) {
    t = (await s.call('PATCH', `/tasks/${t.id}`, { token: dev.token, body: { status, version: t.version } })).body.task;
  }
  const res = await s.call('PATCH', `/tasks/${t.id}`, { token: dev.token, body: { status: 'In Review', version: t.version } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'INVALID_TRANSITION');
});

test('TC-N-11 password reset with an invalid token fails; unknown emails are not revealed', async () => {
  const bad = await s.call('POST', '/auth/reset-password', { body: { token: 'garbage', password: 'Password123' } });
  assert.equal(bad.status, 400);
  const unknown = await s.call('POST', '/auth/forgot-password', { body: { email: 'nobody@example.com' } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.devResetToken, undefined);
});
