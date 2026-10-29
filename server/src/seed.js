// Resets the database and loads demo data. Usage: npm run seed
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { seedDemo, DEMO_PASSWORD } from './demo-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.DB_FILE || path.join(here, '..', 'data', 'tracker.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
const users = seedDemo(openDb(file));

console.log(`Seeded ${file}`);
console.log(`Accounts (password for all: ${DEMO_PASSWORD}):`);
for (const u of users) console.log(`  ${u.email}`);
