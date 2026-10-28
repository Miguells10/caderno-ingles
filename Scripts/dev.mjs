import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, options = {}) => spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
const build = run(npm, ['run', 'build']);
const ok = await new Promise(resolve => build.once('exit', code => resolve(code === 0)));
if (!ok) process.exit(1);
const vite = run(npm, ['exec', '--', 'vite', '--host', '127.0.0.1']);
let electron;
const stop = () => { vite.kill(); electron?.kill(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (let i = 0; i < 40; i++) {
  try { const response = await fetch('http://127.0.0.1:5173'); if (response.ok) break; } catch {}
  await delay(250);
}
electron = run('node_modules/.bin/electron', ['.'], { env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' } });
electron.on('exit', code => { vite.kill(); process.exit(code ?? 0); });
