#!/usr/bin/env node
// #9003 one-off: write `inputs` into the result files of the old pilot-results/<srcHash> dirs. For each dir, find the commit whose 5 shared
// files hash (the old pilot.mjs formula) to the dir name, check those files out into a /tmp tree, and compute currentInputs() there.
//   node tools/referee/lockstep/backfill-inputs.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED, currentInputs } from './inputs.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..', '..'), RES = join(HERE, 'pilot-results');
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const old = (c) => { const parts = []; for (const f of SHARED) { const b = git('show', `${c}:tools/${f}`); parts.push(b ? b.toString('utf8') : ''); } return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 12); };
for (const d of readdirSync(RES)) {
  const files = readdirSync(join(RES, d)).filter((f) => f.endsWith('.json'));
  const first = JSON.parse(readFileSync(join(RES, d, files[0]), 'utf8'));
  const commits = git('log', '--format=%H', '--', ...SHARED.map((f) => 'tools/' + f)).toString().trim().split('\n');
  const c = commits.find((x) => old(x) === d);
  if (!c) { console.log(d, 'NO commit hashes to it: left uncredited'); continue; }
  const tree = mkdtempSync(join(tmpdir(), 'bf-'));
  const lanes = new Set(files.map((f) => JSON.parse(readFileSync(join(RES, d, f), 'utf8')).lane));
  const inputsOf = {};
  for (const lane of lanes) {
    for (const f of [...SHARED, `referee/lanes.d/${lane}.json`, `referee/lockstep/${lane}lane.mjs`]) { const b = git('show', `${c}:tools/${f}`); const cur = join(ROOT, 'tools', f);
      // a lane file that did not exist at that commit (lanes.d/<lane>.json arrived later) gets today's content: the result is credited exactly while it is unchanged from now on
      const body = b || (!SHARED.includes(f) && existsSync(cur) ? readFileSync(cur) : null);
      if (body) { mkdirSync(dirname(join(tree, f)), { recursive: true }); writeFileSync(join(tree, f), body); } }
    inputsOf[lane] = currentInputs(lane, tree);
  }
  for (const f of files) { const p = join(RES, d, f), r = JSON.parse(readFileSync(p, 'utf8')); r.inputs = inputsOf[r.lane]; writeFileSync(p, JSON.stringify(r)); }
  console.log(d, 'commit', c.slice(0, 9), files.length, 'results,', lanes.size, 'lanes');
}
