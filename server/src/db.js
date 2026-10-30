import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

// Foreign keys are declared for documentation and local integrity, but the code never relies on
// ON DELETE CASCADE: remote Turso connections don't keep per-connection PRAGMAs.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  key              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description      TEXT NOT NULL DEFAULT '',
  owner_id         INTEGER NOT NULL REFERENCES users(id),
  start_date       TEXT,
  end_date         TEXT,
  next_task_number INTEGER NOT NULL DEFAULT 1,
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES projects(id),
  number            INTEGER NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  priority          TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High')),
  status            TEXT NOT NULL DEFAULT 'To Do' CHECK (status IN ('To Do', 'In Progress', 'In Review', 'Done')),
  assignee_id       INTEGER REFERENCES users(id),
  reporter_id       INTEGER NOT NULL REFERENCES users(id),
  due_date          TEXT,
  client_request_id TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, number),
  UNIQUE (project_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  author_id  INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  task_id    INTEGER,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, id);
`;

const normalize = (rs) => ({ changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid) });

// Same query helpers on the client and inside a transaction.
function queries(exec) {
  return {
    get: async (sql, ...args) => (await exec(sql, args)).rows[0],
    all: async (sql, ...args) => (await exec(sql, args)).rows,
    run: async (sql, ...args) => normalize(await exec(sql, args)),
  };
}

/**
 * Opens the database. With TURSO_DATABASE_URL set it uses a hosted Turso (libSQL) database, so data
 * survives restarts on hosts without a persistent disk; otherwise a local SQLite file.
 *
 * All writes go through one in-process lock: write transactions run one at a time, which keeps the
 * task-number counter, idempotency checks and optimistic-lock updates race-free. (The app runs as a
 * single server process.)
 */
export async function openDb(
  url = process.env.TURSO_DATABASE_URL,
  authToken = process.env.TURSO_AUTH_TOKEN,
  file = process.env.DB_FILE || path.resolve('data', 'tracker.db')
) {
  if (!url) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    url = `file:${file.replaceAll('\\', '/')}`;
  }
  const client = createClient({ url, authToken });
  if (url.startsWith('file:')) {
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA busy_timeout = 5000');
  }
  await client.executeMultiple(SCHEMA);

  let lock = Promise.resolve();
  const withLock = (fn) => {
    const result = lock.then(fn);
    lock = result.catch(() => {});
    return result;
  };
  const exec = (sql, args) => client.execute({ sql, args });
  const base = queries(exec);

  return {
    url,
    get: base.get,
    all: base.all,
    // A single write outside a transaction still waits for any open transaction.
    run: (sql, ...args) => withLock(() => base.run(sql, ...args)),
    // Runs fn(t) inside a write transaction; t has get/all/run. Commits if fn resolves, rolls back if it throws.
    tx: (fn) =>
      withLock(async () => {
        const t = await client.transaction('write');
        try {
          const result = await fn(queries((sql, args) => t.execute({ sql, args })));
          await t.commit();
          return result;
        } catch (err) {
          await t.rollback().catch(() => {});
          throw err;
        } finally {
          t.close();
        }
      }),
    close: () => client.close(),
  };
}
