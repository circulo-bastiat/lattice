// moblockstepproof (#8084): writes tools/mobproof/out/lockstep.json for the proof matrix (#7520) from the recorded pilot results.
// Input: tools/referee/lockstep/pilot-results/<srcHash>/<lane>-<salt>.json = { lane, salt, same, firstDiv? } (firstDiv = first tick the engine
// diverged from the server, absent/null = none). Salts with same:false are server-unstable and skipped. A lane needs 20 stable recorded salts
// to be judged; fewer = absent (missing), never green. lane -> mob through tools/referee/lanes.d/<file>.json ({ id, mob }).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { creditedResults } from './referee/lockstep/inputs.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const rd = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

// #9003: `resultsDirs` (newest first) + `root`: a result counts only while its recorded `inputs` equal the lane's CURRENT input hashes (any dir).
// `resultsDir` (one dir, no credit test) is kept for the old fixtures.
export function lockstepRows({ lanesDir, resultsDir, resultsDirs, root, n = 20, roster = rd(join(HERE, 'mobl3-mobs.json'))?.mobs || {} }) {
  const laneMob = {};
  if (existsSync(lanesDir)) for (const f of readdirSync(lanesDir)) { const j = rd(join(lanesDir, f)); if (j && j.mob && !j.damage) laneMob[j.id || f.slice(0, -5)] = j.mob; }
  const per = {};
  // a lane whose id is itself a roster row but whose mob differs (llama_decor -> llama) is credited under its own id too
  const asRow = (r) => (roster[r.lane] && laneMob[r.lane] !== r.lane ? r.lane : null);
  if (resultsDirs) for (const r of Object.values(creditedResults(null, root, resultsDirs))) {
    if (!laneMob[r.lane] || r.same === false) continue;
    if (asRow(r)) (per[r.lane] = per[r.lane] || {})[r.salt] = r;
    (per[laneMob[r.lane]] = per[laneMob[r.lane]] || {})[r.salt] = r;
  }
  if (resultsDir && existsSync(resultsDir)) for (const f of readdirSync(resultsDir)) {
    const r = f.endsWith('.json') ? rd(join(resultsDir, f)) : null;
    if (!r || !laneMob[r.lane] || r.same === false || !Number.isInteger(r.salt)) continue;
    if (asRow(r)) (per[r.lane] = per[r.lane] || {})[r.salt] = r;
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
  // #9011: a roster row that is not itself a lane (fish -> cod, salmon, ...) is credited only when EVERY lane whose mob is one of its
  // entity types is credited; entity types without a lane are ignored; a lane with no row keeps the group missing, a diverging lane keeps it red.
  const lanes = new Set(Object.values(laneMob));
  for (const [row, ents] of Object.entries(roster)) {
    if (lanes.has(row)) continue;
    const need = [...new Set(ents)].filter((e) => lanes.has(e));
    if (!need.length || !need.every((m) => out[m])) continue;
    const failed = {}; let checked = Infinity;
    for (const m of need) { checked = Math.min(checked, out[m].checked); for (const [s, t] of Object.entries(out[m].failed)) failed[`${m}:${s}`] = t; }
    out[row] = { pass: Object.keys(failed).length === 0, checked, notCovered: [], failed, lanes: need };
  }
  return out;
}

export function allDirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

export function newestDir(root) {
  if (!existsSync(root)) return null;
  const ds = readdirSync(root).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return ds[0] || null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = lockstepRows({ lanesDir: join(HERE, 'referee', 'lanes.d'), resultsDirs: process.argv[2] ? [process.argv[2]] : allDirs(join(HERE, 'referee', 'lockstep', 'pilot-results')) });
  const o = join(HERE, 'mobproof', 'out'); mkdirSync(o, { recursive: true });
  writeFileSync(join(o, 'lockstep.json'), JSON.stringify(rows, null, 1) + '\n');
  const gone = lockstepRows({ lanesDir: join(HERE, 'referee', 'lanes.d'), resultsDir: join(o, 'no-such-dir') });   // anti-vacuity (D-30): no result files must yield no rows
  if (Object.keys(gone).length) { console.log('moblockstepproof: FAIL, rows without result files'); process.exit(1); }
  console.log(`moblockstepproof: 1 breaks caught; ${Object.keys(rows).length} mobs recorded, ${Object.values(rows).filter((r) => r.pass).length} green`);
}
