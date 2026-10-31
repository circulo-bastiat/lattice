#!/usr/bin/env node
// lockstepsilverfishcheck -- #6492 (G17-L4 rollout): silverfish x 20 salts on the real 1.18.2 server vs the engine, via lockstep/pilot.mjs
// (finished salts are cached, so a re-run is fast). Prints 'divergences: N'; exit 1 on any. Anti-vacuity (D-30): a doctored
// summary with one divergence, and one with too few runs, must be refused by the same verdict.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareTraces } from './lockstep/trace.mjs';
const verdict = (s) => !!s && s.pilot === 'done' && s.runs >= 20 && Array.isArray(s.divergences) && s.divergences.length === 0;
const pilot = fileURLToPath(new URL('./lockstep/pilot.mjs', import.meta.url));
let last = null;
for (let i = 0; i < 6 && !(last && last.pilot === 'done'); i++) {
  const r = spawnSync(process.execPath, [pilot, '--lanes', 'silverfish', '--seeds', '20'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const lines = (r.stdout || '').trim().split('\n');
  try { last = JSON.parse(lines[lines.length - 1]); } catch { last = null; }
}
let breaks = 0;
const base = { pilot: 'done', runs: 20, divergences: [] };
if (!verdict(base)) { console.log('FAIL verdict rejects a clean summary'); process.exit(1); }
if (!verdict({ ...base, divergences: [{ lane: 'silverfish', salt: 3, tick: 7, field: 'pos' }] })) breaks++;
if (!verdict({ ...base, runs: 19 })) breaks++;
if (compareTraces([{ tick: 0, pos: [0, 0, 0] }], [{ tick: 0, pos: [0, 1e-9, 0] }], { fields: ['pos'] })) breaks++;
const n = last && Array.isArray(last.divergences) ? last.divergences.length : -1;
console.log(`${breaks} breaks caught; divergences: ${n} over ${last ? last.runs : 0} salts (unstable server salts excluded: ${last && last.unstable ? last.unstable.length : 0})`);
process.exit(verdict(last) && breaks === 3 ? 0 : 1);
