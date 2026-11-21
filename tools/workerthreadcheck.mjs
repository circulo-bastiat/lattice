#!/usr/bin/env node
// workerthreadcheck.mjs — #4981: the Worker Threads setting, measured against a REAL worker pool.
//
//   node tools/workerthreadcheck.mjs [dist/mclite.html]
//
// Drives the slider's own row (`videoRows()` -> the 't:slide' set) through every N, through quick
// drags up, down, up-down-up and a same-N repeat, with gen jobs in flight during the drags. After
// each sequence settles it asserts that the label, the pool, the in-flight budgets, and the job
// accounting all agree on ONE number, and that no job was lost or stranded on a retired worker.
// Anti-vacuity: four corrupted snapshots (a label one off, a pool one too big, a stranded job, a
// lost job) must each be flagged by the same judge.

import { resolve } from 'node:path';
import { open, sleep } from './cdp.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } };

// Everything the game says or uses as a worker count, read in one place.
const SNAP = () => {
  const J = MCL.Jobs, W = MCL.World;
  const row = MCL.Options.videoRows().filter((r) => r.t === 'slide' && r.label().indexOf('Worker Threads') === 0)[0];
  const orphans = Array.from(J.inflight.values()).filter((e) => e.w && J.workers.indexOf(e.w) < 0 && J.retiring.indexOf(e.w) < 0).length;
  return { max: MCL.ENV.workersMax || 4, setting: MCL.Settings.workers, want: J.clampSize(MCL.Settings.workers),
    label: row ? row.label() : '', mode: J.mode, live: J.workers.length, target: J.target, pending: J.pending,
    retiring: J.retiring.length, genCap: W.genCap, meshCap: W.meshCap, maxGen: W.maxGenInflight, maxMesh: W.maxMeshInflight,
    orphans: orphans, sent: window.__jobs.sent, answered: window.__jobs.answered, nulls: window.__jobs.nulls };
};

const settled = () => {
  const J = MCL.Jobs, want = J.clampSize(MCL.Settings.workers);
  return (J.mode === 'workers' && J.pending === 0 && J.retiring.length === 0 && J.workers.length === want && J.target === want) ? 1 : 0;
};

const drained = () => (window.__jobs.sent > 0 && window.__jobs.answered === window.__jobs.sent) ? 1 : 0;

// Page functions are built from source text so each can carry its literal steps.
const fn = (body) => eval('(' + body + ')');

function judge(s) {
  const p = [];
  if (s.mode !== 'workers') p.push('mode is ' + s.mode + ', not workers');
  if (s.label.split(' — ')[0] !== 'Worker Threads: ' + s.want + ' of ' + s.max) p.push('label "' + s.label + '" is not the pool\'s "' + s.want + ' of ' + s.max + '"');
  if (s.live !== s.want) p.push('pool has ' + s.live + ' workers, want ' + s.want);
  if (s.target !== s.want) p.push('pool target ' + s.target + ', want ' + s.want);
  if (s.pending !== 0 || s.retiring !== 0) p.push('not settled: pending ' + s.pending + ', retiring ' + s.retiring);
  if (s.genCap !== Math.max(s.maxGen, s.live)) p.push('gen budget ' + s.genCap + ' is not the pool\'s ' + Math.max(s.maxGen, s.live));
  if (s.meshCap !== Math.max(s.maxMesh, Math.ceil(s.live * 1.5))) p.push('mesh budget ' + s.meshCap + ' is not the pool\'s ' + Math.max(s.maxMesh, Math.ceil(s.live * 1.5)));
  if (s.orphans !== 0) p.push(s.orphans + ' job(s) stranded on a worker that is gone');
  if (s.answered !== s.sent) p.push('jobs lost: ' + s.sent + ' sent, ' + s.answered + ' answered');
  if (s.nulls !== 0) p.push(s.nulls + ' job(s) answered null (no worker ran them)');
  return p;
}

const page = await open(FILE, { port: 9461, width: 900, height: 560 });
if (!page) { console.log('no browser'); process.exit(1); }
await page.waitFor(() => (window.MCL && MCL.Hud && MCL.Hud.mode === 'title') ? 1 : 0, 60000);
await page.evaluate(() => { MCL.Main.play({}); });
const booted = await page.waitFor(() => (window.MCL && MCL.Main && MCL.Main.ready === true && MCL.Jobs && MCL.Jobs.mode === 'workers') ? 1 : 0, 180000);
ok(!!booted, 'the game boots with a real worker pool');
if (!booted) { await page.close(); process.exit(1); }

await page.evaluate(() => { window.__jobs = { sent: 0, answered: 0, nulls: 0 }; });
const max = await page.evaluate(() => MCL.ENV.workersMax || 4);
const mode = await page.evaluate(() => MCL.Jobs.mode);
ok(mode === 'workers', 'the pool is a real worker pool (mode ' + mode + ')');

const setSteps = (steps) => fn(`() => {
  var row = MCL.Options.videoRows().filter(function (r) { return r.t === 'slide' && r.label().indexOf('Worker Threads') === 0; })[0];
  var max = MCL.ENV.workersMax || 4;
  ${JSON.stringify(steps)}.forEach(function (n) { row.set(max > 1 ? (n - 1) / (max - 1) : 1); });
}`);
const postJobs = fn(`() => {
  window.__jobs = { sent: 0, answered: 0, nulls: 0 };
  for (var i = 0; i < 60; i++) {
    window.__jobs.sent++;
    MCL.Jobs.requestGen(300 + i, 300).then(function (r) { window.__jobs.answered++; if (!r) window.__jobs.nulls++; },
                                             function () { window.__jobs.answered++; });
  }
}`);

const k = Math.max(2, Math.min(max, 2));
const seqs = [
  { name: 'every N, idle', steps: Array.from({ length: max }, (_, i) => i + 1), load: false, each: true },
  { name: 'drag up while loading', steps: Array.from({ length: max }, (_, i) => i + 1), load: true },
  { name: 'drag down while loading', steps: Array.from({ length: max }, (_, i) => max - i), load: true },
  { name: 'up-down-up in quick succession', steps: [max, 1, max], load: true },
  { name: 'two drags on the same N', steps: [k, k], load: true },
];

const samples = [];
for (const seq of seqs) {
  const frames = seq.each ? seq.steps.map((n) => [n]) : [seq.steps];
  for (const group of frames) {
    console.log('   . ' + seq.name + ' ' + JSON.stringify(group));
    if (seq.load) await page.evaluate(postJobs);
    await page.evaluate(setSteps(group));
    const settledOk = await page.waitFor(settled, 30000);
    if (seq.load) await page.waitFor(drained, 60000);
    await sleep(400);
    const s = (await page.evaluate(SNAP)) || { mode: 'no snapshot' };
    samples.push({ seq: seq.name, group, s });
    const problems = judge(s);
    ok(!!settledOk && problems.length === 0,
      seq.name + ' ' + JSON.stringify(group) + ': ' + (problems.length ? problems.join('; ') : 'label ' + s.label + ' = pool ' + s.live + ' = budgets'));
  }
}

const judgeBreaks = (good) => {
  const cases = {
    'label one off the pool': Object.assign({}, good, { label: 'Worker Threads: ' + (good.want + 1) + ' of ' + good.max }),
    'pool one worker too big': Object.assign({}, good, { live: good.want + 1 }),
    'a job stranded on a gone worker': Object.assign({}, good, { orphans: 1 }),
    'a job lost in the drag': Object.assign({}, good, { answered: good.sent - 1 }),
  };
  for (const [name, bad] of Object.entries(cases)) {
    if (judge(bad).length > 0) { breaks++; console.log('   ✓ break caught: ' + name); }
    else { fails.push('anti-vacuity: not caught: ' + name); console.log('   ✗ not caught: ' + name); }
  }
};
judgeBreaks(samples[samples.length - 1].s);

fails.forEach((m) => console.log('FAIL  ' + m));
console.log(`${breaks} breaks caught`);
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
await page.close();
process.exit(fails.length ? 1 : 0);
