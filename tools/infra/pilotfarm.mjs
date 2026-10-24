#!/usr/bin/env node
// pilotfarm.mjs -- 21 Oct (Dan: "audit to see if we can mass build anything, so we do not have to reach this"):
// ONE job tops up the lockstep pilot credit of EVERY lane on the hosted runners, instead of ~35 worker issues "lockstep <mob> x20 seeds".
// Audit that led here: tools/referee/lockstep/pilot-results held 4705 real-server results over all 123 lanes, but almost none were
// credited (#9003 input hashes), because 23 edits to the shared harness (run.mjs, chasescen.mjs, runchase.mjs, server.mjs, SeedAgent.java)
// landed in two days outside a LANE: fence, and each one dropped the credit of every lane. A worker per mob can never catch up with that.
//   node tools/infra/pilotfarm.mjs                 plan: lanes short of 20 credited stable salts, fewest missing first, and which shared file dropped what
//   node tools/infra/pilotfarm.mjs --run [--lanes 6] [--jobs 3]   run the shortest K lanes on the mirror (needs MIRROR_REPO / MIRROR_TOKEN) and write the
//                                                    results into pilot-results/<srcHash>/ -- commit that directory (any branch; the lander takes it)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentInputs, sameInputs, SHARED } from '../referee/lockstep/inputs.mjs';

export const NEED = 20;
/** 22 Oct (#9536): ship the NEW result files to their own branch farm/<run>-p<n> so a killed run keeps what it proved. `sh(args)` runs git (injectable for the check).
 *  Shipped paths go to .git/info/exclude so the final workflow step ships only the remainder. Returns the branch, or null when nothing is new. */
export function shipBatch({ sh, run, n, dir = 'tools/referee/lockstep/pilot-results', exclude, drop }) {
  if (drop) drop(dir);   // #9844: dead results never leave the runner
  sh(['add', dir]);
  let names = '';
  try { names = String(sh(['diff', '--cached', '--name-only']) || ''); } catch { names = ''; }
  const files = names.split('\n').filter(Boolean);
  if (!files.length) return null;
  const br = `farm/${run}-p${n}`;
  sh(['-c', 'user.name=pilot-farm', '-c', 'user.email=farm@invalid.invalid', 'commit', '-q', '-m', `pilot farm: ${files.length} lockstep results (batch ${n})`]);
  sh(['-c', 'credential.helper=', 'push', '-q', 'origin', `HEAD:refs/heads/${br}`]);
  sh(['reset', '-q', '--mixed', 'HEAD~1']);
  if (exclude) exclude(files);
  return br;
}
/** #9844: delete the result files under `dir` whose recorded inputs no longer equal currentInputs() of the tree at `root` (a farm PR must never carry dead results).
 *  Returns the dropped file names; `say(text)` (optional) tells the bus. */
export function dropDead(dir, root, say) {
  const dead = [], cache = {};
  if (!existsSync(dir)) return dead;
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.json')) one(f); } };
  const one = (f) => {
    let r; try { r = JSON.parse(readFileSync(f, 'utf8')); } catch { return; }
    if (!r || !r.lane || !r.inputs) return;
    const cur = cache[r.lane] || (cache[r.lane] = currentInputs(r.lane, root));
    if (!sameInputs(r.inputs, cur)) { unlinkSync(f); dead.push(f); }
  };
  walk(dir);
  if (dead.length && say) say(`pilotfarm: dropped ${dead.length} dead result file(s) (inputs differ from master's currentInputs) before shipping`);
  return dead;
}
const gitSh = (args) => execFileSync('git', args, { encoding: 'utf8' });

/** every result under `dirs` as { lane, salt, same, inputs }, newest dir first; first seen wins per lane+salt */
export function readResults(dirs) {
  const seen = new Set(), out = [];
  for (const d of dirs) for (const f of readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    let r; try { r = JSON.parse(readFileSync(join(d, f), 'utf8')); } catch { continue; }
    if (!r || !r.lane || !Number.isInteger(r.salt) || !r.inputs) continue;
    const k = `${r.lane}-${r.salt}`; if (seen.has(k)) continue; seen.add(k); out.push(r);
  }
  return out;
}
/** per lane: credited stable salts (same runs a/b), how many are still short, and which shared files made the rest stale.
 *  `cur(lane)` = the lane's current inputs. A lane with no results at all is short NEED. */
export function farmPlan(lanes, results, cur, need = NEED) {
  const by = {};
  for (const l of lanes) by[l] = { lane: l, credited: 0, stale: 0, droppedBy: {} };
  for (const r of results) {
    const e = by[r.lane]; if (!e) continue;
    const c = cur(r.lane);
    if (sameInputs(r.inputs, c)) { if (r.same) e.credited++; continue; }
    e.stale++;
    for (const f of Object.keys(c)) if (r.inputs[f] !== c[f]) e.droppedBy[f] = (e.droppedBy[f] || 0) + 1;
  }
  const rows = Object.values(by).map((e) => ({ ...e, missing: Math.max(0, need - e.credited) }));
  return rows.sort((a, b) => a.missing - b.missing || a.lane.localeCompare(b.lane));
}
/** lanes still short, shortest first; at most k */
export const nextLanes = (plan, k) => plan.filter((p) => p.missing > 0).slice(0, k);
/** #9973: `first` (lane ids, FARM_FIRST / --first) leads the queue in the given order, only while the lane is still short; the rest keep the shortest-first order */
export const nextLanesFirst = (plan, k, first = []) => {
  const rest = nextLanes(plan, Infinity), lead = first.map((l) => rest.find((p) => p.lane === l)).filter(Boolean);
  return [...lead, ...rest.filter((p) => !lead.includes(p))].slice(0, k);
};
/** how many lanes each shared file's current text has dropped (the number to read before editing it outside a LANE fence) */
export function droppers(plan) {
  const o = {};
  for (const p of plan) for (const f of Object.keys(p.droppedBy)) if (SHARED.includes(f)) o[f] = (o[f] || 0) + 1;
  return o;
}
/** EARLY CUTOFF (22 Oct, Dan: "there has to be a better way"): a result depends only on the SERVER-side harness files, so after a harness edit the stored server
 *  output hashes are usually still right. Group a lane's stale STABLE results by their old inputs; for every group bigger than `k` the lowest `k` salts are re-run on
 *  the current harness. If each probe's server hash equals the stored one, the rest of that group is carried forward (re-written with the current inputs, carried:true). */
export function carryPlan(stale, k = 2, maxGroups = 4) {
  const g = new Map();
  for (const r of stale) if (r.same === true && r.a) { const key = JSON.stringify(Object.entries(r.inputs).sort()); if (!g.has(key)) g.set(key, []); g.get(key).push(r); }
  return [...g.values()].filter((rs) => rs.length > k).sort((a, b) => b.length - a.length).slice(0, maxGroups).map((rs) => ({ rs, probe: rs.map((r) => r.salt).sort((x, y) => x - y).slice(0, k) }));
}
/** the results to write for the groups whose every probe came back stable and byte-identical (fresh = this run's probe results) */
export function carryForward(groups, fresh, curInputs) {
  const fs = new Map(fresh.filter((f) => f.same === true && f.a).map((f) => [f.salt, f])), out = [];
  for (const { rs, probe } of groups) {
    if (!probe.every((s) => fs.has(s) && fs.get(s).a === rs.find((r) => r.salt === s).a)) continue;
    for (const r of rs) if (!probe.includes(r.salt)) out.push({ ...r, inputs: curInputs, carried: true });
  }
  return out;
}
/** pilot.mjs's cache key for the shared dir: a hash of exactly these sources (same formula as pilot.mjs, proved by pilotfarmcheck) */
export function srcHash(here = join(dirname(fileURLToPath(import.meta.url)), '..', 'referee', 'lockstep')) {
  const SRCS = [join(here, 'SeedAgent.java'), join(here, 'run.mjs'), join(here, '..', 'runchase.mjs'), join(here, '..', 'chasescen.mjs'), join(here, '..', 'server.mjs')];
  return createHash('sha256').update(SRCS.map((f) => (existsSync(f) ? readFileSync(f) : '')).join('\u0000')).digest('hex').slice(0, 12);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', 'referee', 'lockstep'), root = join(HERE, 'pilot-results');
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
  // 22 Oct: the STEP lanes (referee/steplanes.d, #9199) are pilot lanes too (inputs.mjs hashes steplanes.d/<lane>.json, chasescen loads STEP_LANES); farming only lanes.d left step.json at 0 lanes
  const laneIds = (d) => (existsSync(join(HERE, '..', d)) ? readdirSync(join(HERE, '..', d)) : []).filter((f) => f.endsWith('.json') && !/\.na\.json$/.test(f)).map((f) => f.slice(0, -5));
  const sayBus = (t) => { try { execFileSync(process.execPath, [join(HERE, '..', '..', 'go.mjs'), 'say', '--to', 'log', t], { stdio: 'ignore' }); } catch {} };
  if (process.argv.includes('--drop-dead')) { const n = dropDead(join(root), join(HERE, '..', '..'), sayBus).length; console.log(`pilotfarm: dropped ${n} dead result file(s)`); process.exit(0); }
  const lanes = [...new Set([...laneIds('lanes.d'), ...laneIds('steplanes.d')])];
  const dirs = existsSync(root) ? readdirSync(root).map((d) => join(root, d)).reverse() : [];
  const plan = farmPlan(lanes, readResults(dirs), (l) => currentInputs(l));
  const short = plan.filter((p) => p.missing > 0);
  console.log(`pilotfarm: ${lanes.length} lanes, ${plan.length - short.length} credited ${NEED}/${NEED}, ${short.length} short (${short.reduce((s, p) => s + p.missing, 0)} salts missing, ~${Math.round(short.reduce((s, p) => s + p.missing, 0) * 220 / 3600)} server-hours)`);
  console.log('shared files whose current text dropped lanes: ' + JSON.stringify(droppers(plan)));
  if (!process.argv.includes('--run')) { for (const p of short.slice(0, 25)) console.log(`  ${p.lane}: ${p.credited}/${NEED} credited, ${p.stale} stale`); process.exit(0); }
  const { runPilot } = await import('./mirror.mjs');
  const K = +arg('--lanes', 6), J = Math.max(1, +arg('--jobs', 3)), sharedDir = join(root, srcHash(HERE));
  mkdirSync(sharedDir, { recursive: true });
  let wrote = 0, failed = 0, carried = 0, batch = 0, lastShip = Date.now();
  const everyMs = +arg('--ship-every', 0) * 60000;   // minutes; 0 = only the workflow's final step ships
  const shipMaybe = () => {
    if (!everyMs || Date.now() - lastShip < everyMs || !process.env.GITHUB_RUN_ID) return;
    lastShip = Date.now();
    try {
      const br = shipBatch({ sh: gitSh, drop: (d) => dropDead(join(HERE, '..', '..', '..', d), join(HERE, '..', '..'), sayBus), run: process.env.GITHUB_RUN_ID, n: ++batch, exclude: (fs) => writeFileSync(join(gitSh(['rev-parse', '--git-dir']).trim(), 'info', 'exclude'), fs.join('\n') + '\n', { flag: 'a' }) });
      if (br) console.log(`pilotfarm: shipped ${br}`);
    } catch (e) { console.error(`pilotfarm: ship failed: ${String(e.message || e).slice(0, 160)}`); }
  };
  if (!process.argv.includes('--no-carry')) {   // early cutoff: probe every stale lane first (1 hosted job per group), carry what the server still reproduces byte for byte
    const old = readResults(dirs), todo = lanes.map((l) => ({ lane: l, groups: carryPlan(old.filter((r) => r.lane === l && !sameInputs(r.inputs, currentInputs(l)))) })).filter((x) => x.groups.length);
    console.log(`pilotfarm: early cutoff probes ${todo.length} lane(s)`);
    await Promise.all(Array.from({ length: Math.min(J, todo.length) }, async () => {
      while (todo.length) {
        const { lane, groups } = todo.shift();
        try {
          const probe = new Set(groups.flatMap((g) => g.probe)), have = new Set(Array.from({ length: NEED }, (_, i) => i).filter((i) => !probe.has(i)));
          const fresh = await runPilot(lane, 0, NEED, have);
          for (const r of fresh) { writeFileSync(join(sharedDir, `${lane}-${r.salt}.json`), JSON.stringify({ ...r, inputs: currentInputs(lane) })); wrote++; }
          for (const r of carryForward(groups, fresh, currentInputs(lane))) { writeFileSync(join(sharedDir, `${lane}-${r.salt}.json`), JSON.stringify(r)); carried++; }
        } catch (e) { failed++; console.error(`pilotfarm: carry ${lane}: ${String(e.message || e).slice(0, 160)}`); }
        shipMaybe();
      }
    }));
    console.log(`pilotfarm: carried ${carried} result(s) forward without a real-server run`);
  }
  const plan2 = farmPlan(lanes, readResults(existsSync(root) ? readdirSync(root).map((d) => join(root, d)).reverse() : []), (l) => currentInputs(l));
  const queue = nextLanesFirst(plan2, K, String(arg('--first', process.env.FARM_FIRST || '')).split(',').map((x) => x.trim()).filter(Boolean)).map((p) => p.lane);   // #9973
  await Promise.all(Array.from({ length: Math.min(J, queue.length) }, async () => {
    while (queue.length) {
      const lane = queue.shift();
      try {
        const have = new Set(readdirSync(sharedDir).filter((f) => f.startsWith(lane + '-')).map((f) => +f.slice(lane.length + 1, -5)));
        for (const r of await runPilot(lane, 0, NEED, have)) { writeFileSync(join(sharedDir, `${lane}-${r.salt}.json`), JSON.stringify({ ...r, inputs: currentInputs(lane) })); wrote++; }
      } catch (e) { failed++; console.error(`pilotfarm: ${lane}: ${String(e.message || e).slice(0, 160)}`); }
      shipMaybe();
    }
  }));
  console.log(`pilotfarm: wrote ${wrote} fresh + ${carried} carried results into ${sharedDir}, ${failed} lane(s) failed; commit that directory`);
  process.exit(failed && !wrote ? 1 : 0);
}
