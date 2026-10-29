import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedDemo } from './demo-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4000;
const db = openDb(process.env.DB_FILE || path.join(here, '..', 'data', 'tracker.db'));

// Hosted demo: free hosting tiers start with an empty disk, so load the demo data on first start.
if (process.env.SEED_DEMO === 'true' && db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  seedDemo(db);
  console.log('Empty database: loaded demo data');
}

const app = createApp(db, {
  // No email service, so a public demo can opt in to showing the reset link on the page.
  exposeResetToken: process.env.NODE_ENV !== 'production' || process.env.SHOW_RESET_LINK === 'true',
  staticDir: path.join(here, '..', '..', 'client', 'dist'),
});

app.listen(port, () => console.log(`Tracker API listening on http://localhost:${port}`));
