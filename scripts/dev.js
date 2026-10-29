// Starts the API (port 4000) and the Vite dev server (port 5173) together.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(name, cwd, script, env = {}) {
  // A single command string (not an args array) keeps Windows' shell spawn free of DEP0190 warnings.
  const child = spawn(`npm run ${script}`, {
    cwd: path.join(root, cwd),
    shell: true,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `[${name}]`;
  child.stdout.on('data', (d) => process.stdout.write(d.toString().replace(/^(?=.)/gm, `${prefix} `)));
  child.stderr.on('data', (d) => process.stderr.write(d.toString().replace(/^(?=.)/gm, `${prefix} `)));
  child.on('exit', (code) => {
    console.log(`${prefix} exited with code ${code}`);
    process.exit(code ?? 0);
  });
  return child;
}

// The Vite proxy expects the API on 4000; pin it so an inherited PORT (e.g. from a launcher) can't collide with Vite.
const children = [run('api', 'server', 'dev', { PORT: '4000' }), run('web', 'client', 'dev')];
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => children.forEach((c) => c.kill()));
