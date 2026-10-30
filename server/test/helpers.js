import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { today } from '../src/util.js';

// Pass `file` (and `keepFile: true` on the first server) to restart a server on the same database.
export async function startServer({ file = path.join(os.tmpdir(), `tracker-test-${crypto.randomUUID()}.db`), keepFile = false } = {}) {
  // A local database file per suite (the libSQL client opens extra connections, so :memory: won't do).
  const db = await openDb(`file:${file.split(path.sep).join('/')}`);
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
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
      if (keepFile) return;
      for (const f of [file, `${file}-wal`, `${file}-shm`]) {
        try {
          fs.rmSync(f, { force: true });
        } catch {
          // Windows can keep the file locked briefly after close; a stray temp file is harmless.
        }
      }
    },
  };
}

export function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return today(d);
}
