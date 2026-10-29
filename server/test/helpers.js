import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { today } from '../src/util.js';

export async function startServer() {
  const db = openDb(':memory:');
  const app = createApp(db, { exposeResetToken: true });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function call(method, path, { token, body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  let counter = 0;
  async function register(name = `User ${++counter}`) {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${counter}.${Date.now()}@test.dev`;
    const res = await call('POST', '/auth/register', { body: { name, email, password: 'Password123' } });
    if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    return { ...res.body.user, token: res.body.token };
  }

  let keyCounter = 0;
  async function createProject(owner, extra = {}) {
    const res = await call('POST', '/projects', {
      token: owner.token,
      body: { name: 'Test Project', key: `TP${++keyCounter}`, ...extra },
    });
    if (res.status !== 201) throw new Error(`project failed: ${JSON.stringify(res.body)}`);
    return res.body.project;
  }

  async function addMember(owner, project, user) {
    return call('POST', `/projects/${project.id}/members`, { token: owner.token, body: { userId: user.id } });
  }

  async function createTask(user, project, extra = {}) {
    return call('POST', `/projects/${project.id}/tasks`, { token: user.token, body: { title: 'A task', ...extra } });
  }

  return {
    db,
    call,
    register,
    createProject,
    addMember,
    createTask,
    close: () => new Promise((r) => server.close(r)),
  };
}

export function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return today(d);
}
