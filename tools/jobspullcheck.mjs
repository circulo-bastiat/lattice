#!/usr/bin/env node
// jobspullcheck.mjs — C2ME-3b (#9181): Jobs workers PULL the highest-priority ticket (lowest prio number,
// then oldest) instead of being pushed work by least-loaded; proven on a fake slow pool.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['09_jobs.js'], dom: false, initReg: false });
const J = M.Jobs;
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function pool(n) {
  J.wait.length = 0; J.inflight.clear(); J.mode = 'workers'; J.workers.length = 0;
  const log = [];
  for (let i = 0; i < n; i++) {
    const w = { load: 0, got: [], postMessage(m) { this.got.push(m.id); log.push(m.id); }, terminate() {} };
    J.workers.push(w);
  }
  return log;
}
// finish the oldest job a fake worker holds (a slow pool: nothing completes until we say so)
const finish = (w) => J._onMessage({ data: { t: 'gen:done', id: w.got.shift(), sec: null, hmap: null } });

// 1. a flood of low-priority gens, then one urgent: the urgent job is the next one any worker pulls
let log = pool(2);
const ids = [];
J.DEPTH = 1;
for (let i = 0; i < 6; i++) { J.requestGen(i, 0, 5); ids.push(J.lastId); }
ok(log.length === 2, 'only DEPTH jobs per worker are handed out, got ' + log.length);
J.requestGen(99, 0, 0); const urgent = J.lastId;
finish(J.workers[0]);
ok(log[2] === urgent, 'urgent ticket pulled next, got ' + log[2] + ' want ' + urgent);
finish(J.workers[1]);
ok(log[3] === ids[2], 'equal priorities stay FIFO');
ok(J.wait.length === 3, 'queue holds the rest, got ' + J.wait.length);
// 2. cancel removes a waiting ticket
const victim = ids[5]; J.cancel(victim);
ok(J.wait.length === 2 && !J.wait.some((t) => t.msg.id === victim), 'cancel drops a waiting ticket');
// 3. a slow worker does not hoard: the fast one drains the whole queue
log = pool(2); J.DEPTH = 1;
for (let i = 0; i < 5; i++) J.requestGen(i, 0, 1);
const slow = J.workers[0], fast = J.workers[1];
let n = 0; while (fast.got.length && n++ < 10) finish(fast);
ok(slow.got.length === 1 && J.wait.length === 0, 'fast worker took every ticket the slow one did not, wait=' + J.wait.length);

// anti-vacuity: with FIFO (prio ignored) the urgent assertion must fail
breaks++;
log = pool(1); J.DEPTH = 1;
J.requestGen(0, 0, 5); J.requestGen(1, 0, 5); J.requestGen(2, 0, 5);
const keep = J._best; J._best = () => 0;
const u2 = (J.requestGen(9, 0, 0), J.lastId);
finish(J.workers[0]);
const brokenCaught = log[1] !== u2;
J._best = keep;
ok(brokenCaught, 'anti-vacuity: FIFO dispatch must miss the urgent ticket');

console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `jobspullcheck: ${pass} checks ok, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
