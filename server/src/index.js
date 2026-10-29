import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4000;
const db = openDb(process.env.DB_FILE || path.join(here, '..', 'data', 'tracker.db'));
const app = createApp(db, { staticDir: path.join(here, '..', '..', 'client', 'dist') });

app.listen(port, () => console.log(`Tracker API listening on http://localhost:${port}`));
