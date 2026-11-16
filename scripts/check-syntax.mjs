// Sprawdzenie składni wszystkich plików JS projektu (node --check) — bez zależności.
// Projekt nie używa TypeScript ani bundlera, więc to odpowiednik kroku „typecheck/lint".
// Uruchomienie: npm run lint
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOTS   = ['server.js', 'swagger.js', 'lib', 'routes', 'scripts', 'test', 'public/assets/js'];
const files   = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) if (f !== 'node_modules') walk(join(p, f));
  } else if (/\.(m?js)$/.test(p)) files.push(p);
};
ROOTS.forEach(walk);

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(`✗ ${f}\n${r.stderr}`); }
}
console.log(`${files.length - failed}/${files.length} plików bez błędów składni.`);
process.exit(failed ? 1 : 0);
