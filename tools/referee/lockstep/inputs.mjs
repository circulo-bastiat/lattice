// lockstep/inputs.mjs -- #9003: which files a pilot result depends on, and the credit rule.
// A result <lane>-<salt>.json carries `inputs` = { repo-relative path: sha256 } for exactly the files that lane's output depends on:
// the lane's lanes.d/<lane>.json, its <lane>lane.mjs engine file when it has one, and the shared harness files, where the code fenced
// `LANE:<id>` ... `END LANE` (any comment style) belongs to that lane only and is cut out of every OTHER lane's hash. So an edit inside
// one lane's fenced block (or its own files) touches one lane; an edit to unfenced shared code touches every lane that loads it.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), TOOLS = join(HERE, '..', '..');
export const SHARED = ['referee/lockstep/SeedAgent.java', 'referee/lockstep/run.mjs', 'referee/runchase.mjs', 'referee/chasescen.mjs', 'referee/server.mjs'];
const h = (b) => createHash('sha256').update(b).digest('hex');
/** shared file text as seen by `lane`: other lanes' fenced blocks removed */
export function laneView(text, lane) {
  const out = []; let skip = false;
  for (const line of text.split('\n')) {
    const m = /\bLANE:([\w-]+)/.exec(line);
    if (m) { skip = m[1] !== lane; if (skip) continue; }
    else if (/\bEND LANE\b/.test(line)) { const was = skip; skip = false; if (was) continue; }
    if (!skip) out.push(line);
  }
  return out.join('\n');
}
/** { path: sha256 } the lane's results depend on, with files read from `root` (tools/ by default) */
export function currentInputs(lane, root = TOOLS) {
  const files = [...SHARED, `referee/lanes.d/${lane}.json`, `referee/steplanes.d/${lane}.json`, `referee/lockstep/${lane}lane.mjs`], o = {};
  for (const f of files) { const p = join(root, f); if (existsSync(p)) o[f] = h(laneView(readFileSync(p, 'utf8'), lane)); }
  return o;
}
export const sameInputs = (a, b) => !!a && !!b && JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
/** a result is credited iff it records inputs equal to the lane's current ones */
export const credited = (r, root) => !!r && !!r.lane && sameInputs(r.inputs, currentInputs(r.lane, root));
/** every credited result under `resultsRoot`, newest dir first (first seen wins per lane+salt) */
export function creditedResults(resultsRoot, root, dirsNewestFirst) {
  const cache = {}, out = {};
  for (const d of dirsNewestFirst) for (const f of readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    let r; try { r = JSON.parse(readFileSync(join(d, f), 'utf8')); } catch { continue; }
    if (!r || !r.lane || !Number.isInteger(r.salt) || !r.inputs) continue;
    const k = `${r.lane}-${r.salt}`; if (out[k]) continue;
    const cur = cache[r.lane] || (cache[r.lane] = currentInputs(r.lane, root));
    if (sameInputs(r.inputs, cur)) out[k] = r;
  }
  return out;
}
