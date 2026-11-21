#!/usr/bin/env node
// texauditjobcheck.mjs - #1529: proves the rules of the GPU texture audit JOB (tools/texauditjob.mjs, route.mjs
// texauditDue, go.mjs texaudit). The job is heavy and runs unattended, so its protections are the product:
//   (a) one at a time (mkdir lock; a dead owner's lock is taken over)   (b) per-mob / memory / run limits
//   (c) resumable by srcHash   (d) no foreground path   (e) the brain's due rule   (f) a GPU mismatch reaches the json + bus line
// Node only: fake page, fake compare, tiny limits; it never opens a browser. ANTI-VACUITY: each protection is broken in a
// temporary copy of the source and the same assertions must FAIL ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOB = join(ROOT, 'tools', 'texauditjob.mjs'), ROUTE = join(ROOT, 'tools', 'brain', 'route.mjs');
let N = 0;
console.error = () => {};   // the refusals under test print to stderr
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const guard = (p, ms = 4000) => Promise.race([p, tick(ms).then(() => ({ state: 'HUNG' }))]);
const T0 = Date.parse('2026-10-02T12:00:00Z'), HR = 3600e3;

/** Fakes for runJob. cfg: hang (mob whose render never resolves), mem (fake MB), mism (mob -> mismatching px), delay. */
function world(dir, cfg = {}) {
  const w = { dir, opens: [], closes: 0, targetsCalls: [], said: [], bugs: [], pngs: [], renders: 0, published: [], cur: null };
  const view = { name: 'front', n: [0, 0, 1], R: [1, 0, 0], Up: [0, 1, 0], r0: 0, u1: 0, W: 2, H: 2, col: new Uint8Array(16), edge: new Uint8Array(4), cov: new Uint8Array(4) };
  w.opt = {
    dir, mobs: cfg.mobs || ['cow', 'wolf', 'pig', 'sheep'], srcHash: cfg.srcHash || 'hashA', res: 1,
    limits: { perMobMs: 80, runMs: 60e3, memMB: 100, ...(cfg.limits || {}) },
    now: cfg.now ? () => cfg.now(w) : () => Date.now(),
    memOf: () => cfg.mem || 0,
    say: (l) => w.said.push(l),
    publish: async (s) => { w.published.push(s); },
    fileBugs: async (mobs, rows, o) => { w.bugs.push({ mobs, rows, source: o.source }); },
    targets: async (mob) => { w.targetsCalls.push(mob); w.cur = mob; return [{ layer: 'main', texKey: undefined, key: mob, views: [view] }]; },
    compare: async () => ({ px: 4, mism: (cfg.mism || {})[w.cur] || 0, band: 0, diff: new Uint8Array(16) }),
    diffPng: async (f) => { w.pngs.push(f); writeFileSync(f, 'png'); },
    openPage: async (backend) => {
      w.opens.push(backend);
      return { pid: 999999, backend, close: async () => { w.closes++; },
        render: async () => {
          w.renders++;
          if (cfg.hang && w.cur === cfg.hang) return new Promise(() => {});
          if (cfg.delay) await tick(cfg.delay);
          return { ok: true, backend, W: 2, H: 2, rgba: Buffer.alloc(16).toString('base64'), cullMode: 'back' };
        } };
    },
  };
  return w;
}
const tmp = () => mkdtempSync(join(tmpdir(), 'texaudit-'));
const rd = (f) => JSON.parse(readFileSync(f, 'utf8'));

// (d) the foreground-path scan: does this text start the job? (suite stages, suite.mjs, go.mjs, RUN.md must never)
const startsJob = (text) => /texauditjob/.test(text);

async function suite(J, R) {
  const f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  const dirs = [];
  const D = () => { const d = tmp(); dirs.push(d); return d; };

  // ---- (a) lock
  {
    const d = D(), w1 = world(d, { delay: 120 }), w2 = world(d);
    const p1 = J.runJob(w1.opt);
    await tick(40);
    const r2 = await guard(J.runJob(w2.opt));
    ok(r2.state === 'refused', '(a) a second run while one holds the lock must refuse');
    ok(w2.opens.length === 0 && w2.targetsCalls.length === 0, '(a) the refused run must not open a page');
    const r1 = await guard(p1, 20000);
    ok(r1.state === 'done', '(a) the first run finishes');
    ok(!existsSync(join(d, 'render.lock')), '(a) the lock is released when the run ends');
    const d2 = D(), dead = spawnSync(process.execPath, ['-e', '0']).pid;
    mkdirSyncP(join(d2, 'render.lock'));
    writeFileSync(join(d2, 'render.lock', 'owner.json'), JSON.stringify({ pid: dead, start: Date.now() }));
    const w3 = world(d2), r3 = await guard(J.runJob(w3.opt));
    ok(r3.state === 'done' && w3.opens.length > 0, '(a) a stale lock (dead pid) is taken over');
    const d3 = D(); mkdirSyncP(join(d3, 'render.lock'));
    writeFileSync(join(d3, 'render.lock', 'owner.json'), JSON.stringify({ pid: process.pid, start: Date.now() - 2 * HR }));
    const w4 = world(d3, { limits: { runMs: 60e3 } }), r4 = await guard(J.runJob(w4.opt));
    ok(r4.state === 'done', '(a) a lock older than runMs + 5 min is stale even with a live pid');
  }
  // ---- (b) limits
  {
    const d = D(), w = world(d, { hang: 'wolf' }), s = await guard(J.runJob(w.opt));
    ok(s.state === 'done' && s.mobs && s.mobs.wolf && s.mobs.wolf.error === 'timeout', "(b) a render that never resolves is cut at perMobMs and recorded 'timeout'");
    ok(s.mobs && s.mobs.pig && s.mobs.pig.error === null && w.targetsCalls.includes('sheep'), '(b) the next mob still runs after a timeout');
    ok(w.closes >= 1, '(b) the stuck page is closed');
    const d2 = D(), w2 = world(d2, { mem: 5000 }), s2 = await guard(J.runJob(w2.opt));
    ok(s2.mobs && s2.mobs.cow && s2.mobs.cow.error === 'memory' && Object.keys(s2.mobs).length === 4, "(b) a browser over memMB is recorded 'memory' and the run moves on");
    const d3 = D(); let done = 0;
    const w3 = world(d3, { limits: { runMs: 1500 }, now: () => 1e6 + 1000 * done }); const rr = w3.opt.targets; w3.opt.targets = async (m) => { done++; return rr(m); };
    const s3 = await guard(J.runJob(w3.opt));
    ok(s3.state === 'aborted' && Object.keys(s3.mobs).length < 4, "(b) runMs stops the run with state 'aborted'");
  }
  // ---- (c) resume
  {
    const mk = (d, hash, runMs) => { let done = 0; const w = world(d, { srcHash: hash, limits: { runMs }, now: () => 1e6 + 1000 * done }); const t = w.opt.targets; w.opt.targets = async (m) => { done++; return t(m); }; return w; };
    const d = D(), w1 = mk(d, 'hashA', 1500), s1 = await guard(J.runJob(w1.opt));
    ok(s1.state === 'aborted' && w1.targetsCalls.length === 2, '(c) setup: the first run aborts after two mobs');
    const w2 = mk(d, 'hashA', 1e9), s2 = await guard(J.runJob(w2.opt));
    ok(s2.state === 'done' && w2.targetsCalls.join() === 'pig,sheep', `(c) a rerun with the same srcHash renders only the remaining mobs (got ${w2.targetsCalls.join()})`);
    const d2 = D(); await guard(J.runJob(mk(d2, 'hashA', 1500).opt));
    const w4 = mk(d2, 'hashB', 1e9), s4 = await guard(J.runJob(w4.opt));
    ok(w4.targetsCalls.length === 4 && s4.srcHash === 'hashB', '(c) a changed srcHash renders every mob again');
  }
  // ---- (d) no foreground path
  {
    const d = D(), w = world(d), code = await J.cli({}, w.opt);
    ok(code !== 0 && w.opens.length === 0 && w.targetsCalls.length === 0, '(d) the CLI without MCLITE_TEXAUDIT_BG=1 refuses and opens nothing');
    const d2 = D(), w2 = world(d2), code2 = await J.cli({ MCLITE_TEXAUDIT_BG: '1' }, w2.opt);
    ok(code2 === 0 && w2.opens.length > 0, '(d) with MCLITE_TEXAUDIT_BG=1 (the brain spawn) it runs');
  }
  return { f, dirs };
}
function mkdirSyncP(p) { spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(p)},{recursive:true})`]); }

// ---- (e) the brain's due rule (route.mjs)
function dueSuite(R) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const last = { at: T0 - 4 * HR, srcHash: 'A' }, base = { last, srcHash: 'B', now: T0, busy: false, running: false };
  ok(R.texauditDue(base).run === true, '(e) changed sources, 4 h since the last run, idle: run');
  ok(R.texauditDue({ ...base, last: null }).run === true, '(e) never run: run');
  ok(R.texauditDue({ ...base, srcHash: 'A' }).run === false, '(e) unchanged sources: do not run');
  ok(R.texauditDue({ ...base, last: { at: T0 - 2 * HR, srcHash: 'A' } }).run === false, '(e) under 3 h since the last run: do not run');
  ok(R.texauditDue({ ...base, busy: true }).run === false, '(e) busy machine: do not run');
  ok(R.texauditDue({ ...base, running: true }).run === false, '(e) already running: do not run');
  ok(R.texauditDue({ ...base, last: { at: T0 - 3 * HR, srcHash: 'A' } }).run === true, '(e) exactly 3 h: run');
  return f;
}

// ---- (f) a GPU mismatch lands in the result json, the png and the bus line
async function mismSuite(J) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const d = tmp(), w = world(d, { mism: { wolf: 3 } }), s = await guard(J.runJob(w.opt));
  const j = existsSync(join(d, 'wolf', 'main.json')) ? rd(join(d, 'wolf', 'main.json')) : null;
  ok(j && j.srcHash === 'hashA' && j.backends.webgl2.mism === 3 && j.backends.webgpu.mism === 3 && j.backends.webgl2.cullMode === 'back', '(f) the mismatch lands in wolf/main.json for both backends');
  ok(j && j.backends.webgl2.views[0].mism === 3, '(f) per-view mism is recorded');
  ok(w.pngs.length === 2 && w.pngs.some((p) => p.endsWith('main.png')) && w.pngs.some((p) => p.endsWith('main.webgpu.png')), '(f) a diff png per mismatching backend');
  ok(w.said.length === 1 && /wolf/.test(w.said[0]) && /wolf \(6 px webgl2 3 webgpu 3/.test(w.said[0]), '(f) ONE bus line names the mismatching mob');
  ok(w.bugs.map((b) => b.source).join() === 'webgl2,webgpu' && w.bugs[0].mobs.join() === 'wolf' && w.bugs[0].rows.wolf.mism === 3, '(f) bugs are filed per backend for the mismatching mob only');
  ok(rd(join(d, 'cow', 'main.json')).backends.webgl2.mism === 0 && s.mobs.cow.mism === 0 && s.mobs.wolf.mism === 6, '(f) clean mobs stay clean; summary totals both backends');
  ok(w.published.length === 1 && w.published[0].mobs.wolf.mism === 6, '(f) the summary is published');
  rmSync(d, { recursive: true, force: true });
  return f;
}

// ---- (d) static: nothing but the brain starts the job; go.mjs texaudit is read-only
function staticSuite() {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const stages = readdirSync(join(ROOT, 'tools', 'stages.d')).filter((x) => x.endsWith('.json') && x !== 'texauditjobcheck.json');
  const bad = stages.filter((x) => startsJob(readFileSync(join(ROOT, 'tools', 'stages.d', x), 'utf8')));
  ok(bad.length === 0, `(d) no stage runs the job (found in ${bad.join(', ')})`);
  for (const p of ['tools/suite.mjs', 'tools/go.mjs', 'RUN.md']) ok(!startsJob(readFileSync(join(ROOT, p), 'utf8')), `(d) ${p} must not start the job`);
  ok(startsJob('{ "file": "tools/texauditjob.mjs" }') && startsJob('spawn("node tools/texauditjob.mjs")'), '(d) the scan itself finds a stage / spawn that starts the job');
  const d = tmp();
  const r = spawnSync(process.execPath, [JOB], { env: { ...process.env, MCLITE_TEXAUDIT_BG: '', MCLITE_TEXAUDIT_DIR: join(d, 'x') }, encoding: 'utf8' });
  ok(r.status !== 0 && !existsSync(join(d, 'x')) && /background/.test(r.stderr), '(d) the real CLI without MCLITE_TEXAUDIT_BG=1 exits non-zero and touches nothing');
  const env = { ...process.env, MCLITE_TEXAUDIT_DIR: d };
  const g = (...a) => spawnSync(process.execPath, [join(ROOT, 'tools', 'go.mjs'), 'texaudit', ...a], { env, encoding: 'utf8' });
  for (const sub of ['run', 'render', 'start']) { const x = g(sub); ok(x.status !== 0 && !existsSync(join(d, 'summary.json')) && !existsSync(join(d, 'render.lock')), `(d) go.mjs texaudit ${sub} is refused`); }
  writeFileSync(join(d, 'summary.json'), JSON.stringify({ srcHash: 'abc', state: 'done', at: T0, elapsedMs: 5000, mobs: { wolf: { mism: 6, webgl2: 3, webgpu: 3, error: null }, cow: { mism: 0, error: 'timeout' } } }));
  const s = g('status');
  ok(s.status === 0 && /wolf.*mism 6.*webgl2 3.*webgpu 3/.test(s.stdout) && /cow.*ERROR timeout/.test(s.stdout) && /abc/.test(s.stdout), '(d/f) go.mjs texaudit status prints state, srcHash, per-backend mism and errors');
  ok(g().status === 0, '(d) bare go.mjs texaudit is the status');
  rmSync(d, { recursive: true, force: true });
  return f;
}

async function all(J, R, withStatic) {
  const a = await suite(J, R);
  const out = [...a.f, ...dueSuite(R), ...(await mismSuite(J)), ...(withStatic ? staticSuite() : [])];
  for (const d of a.dirs) try { rmSync(d, { recursive: true, force: true }); } catch {}
  return out;
}

const J0 = await import(pathToFileURL(JOB).href), R0 = await import(pathToFileURL(ROUTE).href);
const fails = await all(J0, R0, true);
console.log(`texauditjobcheck: real sources, ${N} assertions, ${fails.length} failed`);
for (const x of fails) console.log('   ✗ ' + x);

// ---- anti-vacuity: a protection broken in a temporary copy must be caught
const BREAKS = [
  ['job', 'lock disabled', 'if (!takeLock(dir, limits, t0))', 'if (false)'],
  ['job', 'a dead owner is never stale', ' || !alive(o.pid)', ''],
  ['job', 'perMobMs ignored', 'deadline - Date.now()', '1e9'],
  ['job', 'memMB ignored', '> limits.memMB', '> 1e12'],
  ['job', 'runMs ignored', 'now() - t0 >= limits.runMs', 'false'],
  ['job', 'resume ignored', 'if (resume && mobDone(', 'if (false && mobDone('],
  ['job', 'changed srcHash still resumes', 'prev.srcHash === srcHash &&', 'true &&'],
  ['job', 'env gate removed', "env.MCLITE_TEXAUDIT_BG !== '1'", 'false'],
  ['job', 'mismatch not counted', 'R.mism += c.mism', 'R.mism += 0'],
  ['job', 'bus line without the mismatching mobs', 'mismatching: ${bad.map', 'mismatching: ${[].map'],
  ['job', 'bugs not filed', 'if (bad.length && (opt.fileBugs', 'if (false && (opt.fileBugs'],
  ['route', 'due rule inverted (sources)', 'last.srcHash === srcHash', 'last.srcHash !== srcHash'],
  ['route', '3 h rule dropped', 'now - last.at < 3 * 3600e3', 'false'],
  ['route', 'busy ignored', 'if (busy)', 'if (false)'],
  ['route', 'running ignored', 'if (running)', 'if (false)'],
];
const srcs = { job: readFileSync(JOB, 'utf8'), route: readFileSync(ROUTE, 'utf8') };
let caught = 0; const miss = [];
for (const [which, name, from, to] of BREAKS) {
  if (!srcs[which].includes(from)) { miss.push(`break "${name}": ${which} source no longer contains ${from} - update this check`); continue; }
  const base = which === 'job' ? JOB : ROUTE, tmpf = join(dirname(base), `.break-${process.pid}-${which}.mjs`);
  writeFileSync(tmpf, srcs[which].split(from).join(to));
  let bf;
  try {
    const m = await import(pathToFileURL(tmpf).href);
    bf = await all(which === 'job' ? m : J0, which === 'route' ? m : R0, false);
  } catch (e) { bf = [`threw ${e.message}`]; }
  finally { rmSync(tmpf, { force: true }); }
  if (bf.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else miss.push(`break NOT caught: ${name}`);
}
console.log(`${caught} breaks caught (of ${BREAKS.length})`);
for (const x of miss) console.log('   ✗ ' + x);
const bad = fails.length + miss.length;
console.log(`\ntexauditjobcheck: ${N} assertions, ${bad} failed`);
process.exit(bad ? 1 : 0);
