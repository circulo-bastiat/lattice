// tools/infra/smoke.mjs - #3568: run by smoke.yml ON the runner under test. Same data links as full.mjs, then build + core
// + pack-entities + one browser stage; only a clean run marks the runner's fault issue smoke-passed; the brain (a PAT) then adds gpu.
import { spawnSync } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gh, ROOT } from './gh.mjs';
import { smokePassed } from './runnerguard.mjs';
const DATA = process.env.MCLITE_DATA;
for (const d of ['jars', '.mcdata', '.mcsnd', '.chromium', '.decomp'])
  if (DATA && existsSync(join(DATA, d)) && !existsSync(join(ROOT, d))) symlinkSync(join(DATA, d), join(ROOT, d), 'junction');
const run = (a) => { console.log('smoke: node ' + a.join(' ')); return spawnSync('node', a, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, MCLITE_PRESET: 'medium' } }).status === 0; };
const ok = run(['build.mjs']) && run(['tools/suite.mjs', '--core']) && run(['tools/suite.mjs', '--only', 'pack-entities']) && run(['tools/suite.mjs', '--only', 'becheck']);
const name = process.env.RUNNER_NAME;
if (!ok) { console.log(`SMOKE FAILED on ${name}: no gpu label`); process.exit(1); }
await smokePassed(gh, name);
console.log(`SMOKE OK on ${name}: gpu label follows (brain)`);
