#!/usr/bin/env node
// pilotplancheck.mjs - #6574: the pilot's scheduling (cache skip, job cap, time budget, partial/done summary) is right.
// ANTI-VACUITY: each break below mutates the scheduler's source and must be caught ("<n> breaks caught").
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./referee/lockstep/pilotplan.mjs', import.meta.url), 'utf8');
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
let N = 0;
async function run(src) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const P = await load(src);
  const ts = P.taskList(['zombie', 'cow'], 4, 3);
  ok(ts.length === 6 && ts[0].lane === 'zombie' && ts[0].salt === 4 && ts[2].salt === 6 && ts[3].lane === 'cow' && ts[3].salt === 4, 'taskList: lane-major, salts from..from+n-1');
  const cached = { 'zombie-4': { same: true }, 'cow-5': { same: false } };
  const part = P.partition(ts, cached);
  ok(part.done.length === 2 && part.pending.length === 4, 'partition: two cached tasks are skipped');
  ok(part.pending.every((t) => !cached[P.taskKey(t)]), 'partition: pending holds only uncached tasks');
  const base = { elapsedMs: 0, budgetMs: 420e3, estMs: 130e3, running: 0, jobs: 3, pending: 5, startedThisCall: 0 };
  ok(P.mayStart(base) === true, 'mayStart: an idle pilot with work and budget starts a salt');
  ok(P.mayStart({ ...base, running: 3, startedThisCall: 3 }) === false, 'mayStart: the job cap holds');
  ok(P.mayStart({ ...base, running: 2, startedThisCall: 2 }) === true, 'mayStart: below the job cap another salt starts');
  ok(P.mayStart({ ...base, pending: 0 }) === false, 'mayStart: nothing pending -> no start');
  ok(P.mayStart({ ...base, running: 1, startedThisCall: 1, elapsedMs: 300e3 }) === false, 'mayStart: a salt that would end after the budget is not started (300 s + 130 s > 420 s)');
  ok(P.mayStart({ ...base, running: 1, startedThisCall: 1, elapsedMs: 290e3 }) === true, 'mayStart: a salt that ends exactly inside the budget starts (290 s + 130 s <= 420 s)');
  ok(P.mayStart({ ...base, elapsedMs: 900e3 }) === true, 'mayStart: the first salt of a call starts even past the budget (a call always makes progress)');
  ok(P.mayStart({ ...base, elapsedMs: 900e3, startedThisCall: 1 }) === false, 'mayStart: once something ran this call the budget binds again');
  ok(P.estimate([]) === P.DEFAULT_EST_MS, 'estimate: default before any salt finished');
  ok(P.estimate([100e3, 200e3, 150e3]) >= 200e3, 'estimate: at least the slowest finished salt');
  const lanes = ['zombie'], tasks = P.taskList(lanes, 0, 20);
  const all = Object.fromEntries(tasks.map((t) => [P.taskKey(t), { same: t.salt !== 7 }]));
  const done = P.summary({ tasks, results: all, lanes, from: 0, n: 20, again: 'x' });
  ok(done.pilot === 'done' && done.runs === 20 && done.divergences.length === 1 && done.divergences[0].salt === 7, 'summary: all 20 salts -> done, with the diverging salt listed');
  const part2 = P.summary({ tasks, results: Object.fromEntries(tasks.slice(0, 12).map((t) => [P.taskKey(t), { same: true }])), lanes, from: 0, n: 20, again: 'node pilot.mjs --seeds 20' });
  ok(part2.pilot === 'partial' && part2.remaining === 8 && part2.finished === 12 && part2.again === 'node pilot.mjs --seeds 20', 'summary: 12 of 20 -> partial, 8 remaining, with the command to run again');
  const chunk = P.summary({ tasks: P.taskList(lanes, 5, 5), results: Object.fromEntries(P.taskList(lanes, 5, 5).map((t) => [P.taskKey(t), { same: true }])), lanes, from: 5, n: 5, again: 'x' });
  ok(chunk.pilot === 'chunk' && chunk.from === 5, 'summary: a finished partial range is a chunk line');
  return f;
}
const rep = (a, b) => (s) => { if (!s.includes(a)) throw new Error('no such text: ' + a); return s.split(a).join(b); };
const fails = await run(SRC), total = N;
const BREAKS = [
  ['the cache is ignored', rep('(cached[taskKey(t)] ? done : pending).push(t)', 'pending.push(t)')],
  ['the job cap is ignored', rep(' || running >= jobs', '')],
  ['the budget is ignored', rep('return elapsedMs + estMs <= budgetMs;', 'return true;')],
  ['the budget check is off by the estimate', rep('elapsedMs + estMs <= budgetMs', 'elapsedMs <= budgetMs')],
  ['no forced first salt', rep('if (running === 0 && startedThisCall === 0) return true;', '')],
  ['the forced first salt never stops binding', rep('startedThisCall === 0', 'true')],
  ['estimate uses the fastest salt', rep('Math.max(...durationsMs)', 'Math.min(...durationsMs)')],
  ['estimate has no default', rep(': DEFAULT_EST_MS)', ': 0)')],
  ['a partial run is reported as finished', rep('if (remaining) return', 'if (false) return')],
  ['remaining is miscounted', rep('remaining, divergences: bad, again', 'remaining: 0, divergences: bad, again')],
  ['divergences are dropped', rep('!results[taskKey(t)].same)', 'false)')],
  ['salts start at 0 instead of from', rep('salt: from + i', 'salt: i')],
];
let caught = 0;
for (const [name, mut] of BREAKS) {
  let r; try { r = await run(mut(SRC)); } catch (e) { r = [`threw: ${e.message}`]; if (/no such text/.test(e.message)) fails.push(`break "${name}": ${e.message}`); }
  if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
}
console.log(`pilotplancheck: ${total} assertions, ${fails.length} failures, ${caught} breaks caught`);
for (const x of fails) console.log(`  ✗ ${x}`);
process.exit(fails.length ? 1 : 0);
