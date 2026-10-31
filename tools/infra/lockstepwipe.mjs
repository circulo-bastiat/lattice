#!/usr/bin/env node
// lockstepwipe.mjs (#9844): a PR that edits a SHARED lockstep file outside a LANE fence changes currentInputs() of every lane, and creditedResults() (#9003)
// then drops every recorded result: #9742 took the lockstep proof column from 72 to 1 and nobody was told. This is the lander's core gate:
//   node tools/infra/lockstepwipe.mjs [--base origin/master] [--max 5]     exit 1 when more than --max lanes lose credit, unless the PR says `lockstep-wipe: ack`
// The acknowledgement is read from the env LOCKSTEP_ACK_TEXT (the PR body) and from the commit messages of base..HEAD. A bounce also mails the bus (to: commander).
import { existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentInputs, sameInputs, SHARED } from '../referee/lockstep/inputs.mjs';
const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_LANES = 5;
export const ACK = /lockstep-wipe:\s*ack/i;
/** every lane id with a lanes.d / steplanes.d file under `root` (same rule as pilotfarm) */
export function laneIds(root = TOOLS) {
  const ids = (d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)) : []).filter((f) => f.endsWith('.json') && !/\.na\.json$/.test(f)).map((f) => f.slice(0, -5));
  return [...new Set([...ids('referee/lanes.d'), ...ids('referee/steplanes.d')])].sort();
}
/** lanes whose inputs differ between the two trees, and the shared files that differ for them */
export function wipedLanes(baseRoot, headRoot, lanes = laneIds(headRoot)) {
  const wiped = [], files = new Set();
  for (const l of lanes) {
    const a = currentInputs(l, baseRoot), b = currentInputs(l, headRoot);
    if (sameInputs(a, b)) continue;
    wiped.push(l);
    for (const f of SHARED) if (a[f] !== b[f]) files.add(f);
  }
  return { wiped, files: [...files] };
}
export const verdict = ({ wiped, files }, ackText = '', max = MAX_LANES) =>
  wiped.length <= max ? { ok: true, msg: `lockstep-wipe: ${wiped.length} lane(s) change inputs (limit ${max})` }
  : ACK.test(ackText) ? { ok: true, ack: true, msg: `lockstep-wipe: ${wiped.length} lanes lose credit (${files.join(', ')}); acknowledged by the PR` }
  : { ok: false, msg: `lockstep-wipe: this change drops the pilot credit of ${wiped.length} lanes (limit ${max}) because ${files.join(', ')} changed outside a LANE:<id> ... END LANE fence. Fence the lane-specific code, or put \`lockstep-wipe: ack\` in the PR body / a commit message if shared code really must change.` };

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
  const base = arg('--base', 'origin/master'), max = +arg('--max', MAX_LANES), git = (a) => execFileSync('git', a, { encoding: 'utf8', cwd: join(TOOLS, '..') });
  try { git(['rev-parse', '--verify', '-q', base]); } catch { console.log(`lockstep-wipe: no ${base} here, nothing to compare (skipped)`); process.exit(0); }
  const tmp = mkdtempSync(join(tmpdir(), 'lsw-'));
  try {
    const want = new Set([...SHARED, ...(git(['ls-tree', '-r', '--name-only', base, 'tools/referee/lanes.d', 'tools/referee/steplanes.d', 'tools/referee/lockstep']).split('\n').filter((f) => /lanes\.d\/.*\.json$|lane\.mjs$/.test(f)).map((f) => f.replace(/^tools\//, '')))]);
    for (const f of want) { let t; try { t = git(['show', `${base}:tools/${f}`]); } catch { continue; } mkdirSync(join(tmp, dirname(f)), { recursive: true }); writeFileSync(join(tmp, f), t); }
    const r = wipedLanes(tmp, TOOLS, [...new Set([...laneIds(tmp), ...laneIds(TOOLS)])].sort());
    const ack = (process.env.LOCKSTEP_ACK_TEXT || '') + '\n' + git(['log', '--format=%B', `${base}..HEAD`]);
    const v = verdict(r, ack, max);
    console.log(v.msg);
    if (v.ack || !v.ok) spawnSync(process.execPath, [join(TOOLS, 'go.mjs'), 'say', '--to', 'commander', `${v.ok ? 'ACKED' : 'BOUNCED'} lockstep wipe: ${r.wiped.length} lanes lose pilot credit (${r.files.join(', ')})`], { stdio: 'ignore' });
    process.exit(v.ok ? 0 : 1);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
