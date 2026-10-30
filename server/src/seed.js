// Resets the database and loads demo data. Usage: npm run seed
// With TURSO_DATABASE_URL set, this wipes and reseeds the hosted database instead of the local file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { seedDemo, DEMO_PASSWORD } from './demo-data.js';

const TABLES = ['comments', 'activity', 'tasks', 'project_members', 'projects', 'password_resets', 'sessions', 'users'];

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.DB_FILE || path.join(here, '..', 'data', 'tracker.db');
if (!process.env.TURSO_DATABASE_URL) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}
const db = await openDb(undefined, undefined, file);
await db.tx(async (t) => {
  for (const table of TABLES) await t.run(`DELETE FROM ${table}`);
  await t.run("DELETE FROM sqlite_sequence WHERE name IN ('users', 'projects', 'tasks', 'comments', 'activity')");
});
const users = await seedDemo(db);
db.close();

console.log(`Seeded ${db.url}`);
console.log(`Accounts (password for all: ${DEMO_PASSWORD}):`);
for (const u of users) console.log(`  ${u.email}`);
