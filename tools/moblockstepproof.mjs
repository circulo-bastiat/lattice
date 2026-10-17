// moblockstepproof (#8084): writes tools/mobproof/out/lockstep.json for the proof matrix (#7520) from the recorded pilot results.
// Input: tools/referee/lockstep/pilot-results/<srcHash>/<lane>-<salt>.json = { lane, salt, same, firstDiv? } (firstDiv = first tick the engine
// diverged from the server, absent/null = none). Salts with same:false are server-unstable and skipped. A lane needs 20 stable recorded salts
// to be judged; fewer = absent (missing), never green. lane -> mob through tools/referee/lanes.d/<file>.json ({ id, mob }).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const rd = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export function lockstepRows({ lanesDir, resultsDir, n = 20 }) {
  const laneMob = {};
  if (existsSync(lanesDir)) for (const f of readdirSync(lanesDir)) { const j = rd(join(lanesDir, f)); if (j && j.mob) laneMob[j.id || f.slice(0, -5)] = j.mob; }
  const per = {};
  if (resultsDir && existsSync(resultsDir)) for (const f of readdirSync(resultsDir)) {
    const r = f.endsWith('.json') ? rd(join(resultsDir, f)) : null;
    if (!r || !laneMob[r.lane] || r.same === false || !Number.isInteger(r.salt)) continue;
    (per[laneMob[r.lane]] = per[laneMob[r.lane]] || {})[r.salt] = r;
  }
  const out = {};
  for (const [mob, bySalt] of Object.entries(per)) {
    const salts = Object.keys(bySalt).map(Number).sort((a, b) => a - b).slice(0, n);
    if (salts.length < n) continue;
    const failed = {};
    for (const s of salts) { const t = bySalt[s].firstDiv; if (t !== undefined && t !== null) failed[s] = t; }
    out[mob] = { pass: Object.keys(failed).length === 0, checked: salts.length, notCovered: [], failed };
  }
  return out;
}

export function newestDir(root) {
  if (!existsSync(root)) return null;
  const ds = readdirSync(root).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return ds[0] || null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = lockstepRows({ lanesDir: join(HERE, 'referee', 'lanes.d'), resultsDir: process.argv[2] || newestDir(join(HERE, 'referee', 'lockstep', 'pilot-results')) });
  const o = join(HERE, 'mobproof', 'out'); mkdirSync(o, { recursive: true });
  writeFileSync(join(o, 'lockstep.json'), JSON.stringify(rows, null, 1) + '\n');
  const gone = lockstepRows({ lanesDir: join(HERE, 'referee', 'lanes.d'), resultsDir: join(o, 'no-such-dir') });   // anti-vacuity (D-30): no result files must yield no rows
  if (Object.keys(gone).length) { console.log('moblockstepproof: FAIL, rows without result files'); process.exit(1); }
  console.log(`moblockstepproof: 1 breaks caught; ${Object.keys(rows).length} mobs recorded, ${Object.values(rows).filter((r) => r.pass).length} green`);
}
