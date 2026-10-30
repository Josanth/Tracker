import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedDemo } from './demo-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4000;
// TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) selects a hosted database; otherwise a local SQLite file.
const db = await openDb(undefined, undefined, process.env.DB_FILE || path.join(here, '..', 'data', 'tracker.db'));
console.log(`Database: ${db.url.startsWith('file:') ? db.url : 'hosted Turso database'}`);

// Load the demo data only into a brand-new, empty database; existing data is never touched.
if (process.env.SEED_DEMO === 'true' && (await db.get('SELECT COUNT(*) AS n FROM users')).n === 0) {
  await seedDemo(db);
  console.log('Empty database: loaded demo data');
}

const app = createApp(db, {
  // No email service, so a public demo can opt in to showing the reset link on the page.
  exposeResetToken: process.env.NODE_ENV !== 'production' || process.env.SHOW_RESET_LINK === 'true',
  staticDir: path.join(here, '..', '..', 'client', 'dist'),
});

app.listen(port, () => console.log(`Tracker API listening on http://localhost:${port}`));
