import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s;
before(async () => (s = await startServer()));
after(() => s.close());

test('TC-E-01 concurrent updates: second writer with a stale version gets 409, nothing is overwritten', async () => {
  const owner = await s.register();
  const dev = await s.register();
  const p = await s.createProject(owner);
  await s.addMember(owner, p, dev);
  const t = (await s.createTask(owner, p, { title: 'Original' })).body.task;

  // Both users loaded version 1.
  const first = await s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { title: 'Owner edit', version: t.version } });
  const second = await s.call('PATCH', `/tasks/${t.id}`, { token: dev.token, body: { title: 'Dev edit', version: t.version } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'VERSION_CONFLICT');
  assert.equal(second.body.error.current.title, 'Owner edit', 'conflict response carries the latest data');

  const now = (await s.call('GET', `/tasks/${t.id}`, { token: owner.token })).body.task;
  assert.equal(now.title, 'Owner edit');

  // Retrying with the fresh version succeeds.
  const retry = await s.call('PATCH', `/tasks/${t.id}`, { token: dev.token, body: { title: 'Dev edit', version: now.version } });
  assert.equal(retry.status, 200);
});

test('TC-E-01b truly parallel status changes: exactly one wins', async () => {
  const owner = await s.register();
  const p = await s.createProject(owner);
  const t = (await s.createTask(owner, p)).body.task;
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { status: 'In Progress', version: t.version } })
    )
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 4);
});

test('TC-E-02 duplicate submission (refresh / retry) with the same clientRequestId creates one task', async () => {
  const owner = await s.register();
  const p = await s.createProject(owner);
  const body = { title: 'Only once', clientRequestId: 'req-123' };
  const [a, b] = await Promise.all([s.createTask(owner, p, body), s.createTask(owner, p, body)]);
  const c = await s.createTask(owner, p, body);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 201]);
  assert.equal(c.status, 200);
  assert.equal(c.headers.get('idempotent-replay'), 'true');
  assert.equal(a.body.task.id, b.body.task.id);
  const tasks = (await s.call('GET', `/projects/${p.id}/tasks`, { token: owner.token })).body.tasks;
  assert.equal(tasks.length, 1);
});

test('TC-E-03 invalid transitions: To Do → Done and skipping steps are rejected; one step back is allowed', async () => {
  const owner = await s.register();
  const p = await s.createProject(owner);
  let t = (await s.createTask(owner, p)).body.task;

  const skip = await s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { status: 'Done', version: t.version } });
  assert.equal(skip.status, 409);
  assert.equal(skip.body.error.code, 'INVALID_TRANSITION');
  assert.deepEqual(skip.body.error.allowed, ['In Progress']);

  const skip2 = await s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { status: 'In Review', version: t.version } });
  assert.equal(skip2.status, 409);

  t = (await s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { status: 'In Progress', version: t.version } })).body.task;
  t = (await s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { status: 'In Review', version: t.version } })).body.task;
  const back = await s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { status: 'In Progress', version: t.version } });
  assert.equal(back.status, 200, 'review can send a task back one step');

  const bogus = await s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { status: 'Blocked', version: back.body.task.version } });
  assert.equal(bogus.status, 400);
});

test('TC-E-04 multiple tabs: a tab holding stale data cannot overwrite, and reads are consistent', async () => {
  const owner = await s.register();
  const p = await s.createProject(owner);
  const t = (await s.createTask(owner, p)).body.task;
  // Tab A and tab B share one session token.
  const tabA = await s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { priority: 'High', version: t.version } });
  assert.equal(tabA.status, 200);
  const tabB = await s.call('PATCH', `/tasks/${t.id}`, { token: owner.token, body: { priority: 'Low', version: t.version } });
  assert.equal(tabB.status, 409, 'tab B is told to refresh instead of silently overwriting');
  const fromList = (await s.call('GET', `/projects/${p.id}/tasks`, { token: owner.token })).body.tasks[0];
  const fromDetail = (await s.call('GET', `/tasks/${t.id}`, { token: owner.token })).body.task;
  assert.equal(fromList.priority, 'High');
  assert.equal(fromDetail.version, fromList.version);
});

test('TC-E-05 removing a member unassigns their tasks in that project only', async () => {
  const owner = await s.register();
  const dev = await s.register();
  const p1 = await s.createProject(owner);
  const p2 = await s.createProject(owner);
  await s.addMember(owner, p1, dev);
  await s.addMember(owner, p2, dev);
  const t1 = (await s.createTask(owner, p1, { assigneeId: dev.id })).body.task;
  const t2 = (await s.createTask(owner, p2, { assigneeId: dev.id })).body.task;

  const res = await s.call('DELETE', `/projects/${p1.id}/members/${dev.id}`, { token: owner.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.unassignedTasks, [t1.key]);

  const after1 = (await s.call('GET', `/tasks/${t1.id}`, { token: owner.token })).body.task;
  const after2 = (await s.call('GET', `/tasks/${t2.id}`, { token: owner.token })).body.task;
  assert.equal(after1.assignee, null);
  assert.ok(after1.version > t1.version, 'version bumps so open editors detect the change');
  assert.equal(after2.assignee.id, dev.id);
  assert.equal((await s.call('GET', `/projects/${p1.id}`, { token: dev.token })).status, 403, 'removed member loses access');
});

test('TC-E-06 non-member opening a project URL directly gets 403; unknown project 404', async () => {
  const owner = await s.register();
  const outsider = await s.register();
  const p = await s.createProject(owner);
  assert.equal((await s.call('GET', `/projects/${p.id}`, { token: outsider.token })).status, 403);
  assert.equal((await s.call('GET', '/projects/999999', { token: outsider.token })).status, 404);
  assert.equal((await s.call('GET', '/projects/abc', { token: outsider.token })).status, 404);
});

test('TC-E-07 task numbers stay unique under parallel creation', async () => {
  const owner = await s.register();
  const p = await s.createProject(owner, { key: 'PAR' });
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => s.createTask(owner, p, { title: `T${i}` })));
  const keys = results.map((r) => r.body.task.key);
  assert.equal(new Set(keys).size, 10);
  assert.deepEqual([...keys].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1])), Array.from({ length: 10 }, (_, i) => `PAR-${i + 1}`));
});

test('TC-E-08 numbers are not reused after a task is deleted', async () => {
  const owner = await s.register();
  const p = await s.createProject(owner, { key: 'DEL' });
  const t1 = (await s.createTask(owner, p)).body.task;
  await s.call('DELETE', `/tasks/${t1.id}`, { token: owner.token });
  const t2 = (await s.createTask(owner, p)).body.task;
  assert.equal(t2.key, 'DEL-2');
});
