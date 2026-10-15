// tools/laddercheck.mjs - #4975: the chaos drill. Simulates each of the four 9-10 Oct standstills (fill off, hosted minutes gone, disk full,
// CRLF PRs bouncing) plus one nothing-can-fix-it case against a fake GitHub and fake machine, and asserts the ladder recovers the first four
// by the right rung without paging, and pages exactly once on the last. Anti-vacuity: each break (a rung removed, the detector blinded)
// must make the drill fail.
import { stalled, climb, rungs } from './infra/ladder.mjs';

const MIN = 60e3, T0 = Date.parse('2026-10-10T00:00:00Z');
async function drill(fault, { drop = null, noStall = false } = {}) {
  const w = { fault, tr: 'hosted', said: [], paged: 0, ticks: 0 };
  const fixes = (k) => { if (w.fault === k) w.fault = null; };
  const gh = async (m, p, body) => {
    if (m === 'POST' && /brain\.yml\/dispatches/.test(p)) return fixes('fill');
    if (m === 'GET' && /variables\/TEST_RUNNER/.test(p)) return { value: w.tr };
    if (m === 'GET' && /land\.yml\/runs/.test(p)) return { workflow_runs: w.fault === 'minutes' ? [{ created_at: new Date(w.now - 120 * MIN).toISOString() }] : [] };
    if (m === 'PATCH' && /variables\/TEST_RUNNER/.test(p)) { w.tr = body.value; return fixes('minutes'); }
    return {};
  };
  const local = { freeDisk: async () => (w.fault === 'disk' ? (fixes('disk'), '3 GB free') : null) };
  const sweep = async () => ({ acts: w.fault === 'crlf' ? (fixes('crlf'), ['requeued #4969']) : [] });
  let st = null;
  for (w.now = T0; w.ticks < 12; w.now += 5 * MIN, w.ticks++) {
    const sick = w.fault !== null;
    let r = rungs({ gh, local, sweep, now: w.now }); if (drop) r = r.filter((x) => x.name !== drop);
    const out = await climb({ st, rungs: r, say: async (t) => w.said.push(t), page: async () => { w.paged++; },
      isStalled: !noStall && stalled({ now: w.now, lastMergeAt: w.now - 60 * MIN, lastRunAt: sick ? w.now - 60 * MIN : w.now, claimable: 3 }) });
    st = out.st;
    if (!sick && !out.acted) break;
  }
  return w;
}
const ok = async (fault, rung, opts) => { const w = await drill(fault, opts); return w.fault === null && w.paged === 0 && w.said.some((l) => l.startsWith(`ladder: ${rung} `)); };
const cases = [['fill', 'restart-fill'], ['minutes', 'flip-test-runner'], ['disk', 'free-disk'], ['crlf', 'relabel-bounced']];
let fail = 0; const bad = (m) => { fail = 1; console.log('FAIL', m); };

for (const [f, r] of cases) if (!(await ok(f, r))) bad(`standstill "${f}" not recovered by ${r}`);
{ const w = await drill('unfixable'); if (w.paged !== 1) bad(`unfixable: paged ${w.paged}x, want exactly 1`); }
if (stalled({ now: T0, lastMergeAt: T0 - 60 * MIN, lastRunAt: T0 - 60 * MIN, claimable: 0 })) bad('no claimable work must not stall');
if (stalled({ now: T0, lastMergeAt: T0 - 60 * MIN, lastRunAt: T0 - 5 * MIN, claimable: 3 })) bad('a recent worker run must not stall');
{ const w = await drill(null); if (w.said.length) bad('a healthy world must log nothing'); }

// #5105 (11 Oct): caps are not a stall; a rung that kills the process runs once; a page re-arms after REARM_MIN
import { readFileSync } from 'node:fs';
import * as LADDER from './infra/ladder.mjs';
import { usageCap, accountWeekCap } from './brain/route.mjs';
const CFG = JSON.parse(readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8'));
const capCase = (L) => {
  const U = (mw, mk, pw, pk) => ({ at: new Date(T0).toISOString(), accounts: { max: { window: { pct: mw }, week: { pct: mk } }, pro: { window: { pct: pw }, week: { pct: pk } } } });
  const st = (u) => L.stalled({ now: T0, lastMergeAt: T0 - 300 * MIN, lastRunAt: T0 - 300 * MIN, claimable: 9, capped: L.allCapped(CFG, u, T0, usageCap, accountWeekCap) });
  return !st(U(0, 100, 90, 59)) && st(U(0, 0, 3, 60)) && st(null);   // 11 Oct 07:00Z: both capped = no stall; 11:10Z: room = stall; no usage = stall
};
const killCase = async (L) => {   // the 08:26Z rung: it never returns (the runner restart killed the pass)
  let saved = null, ran = 0;
  const R = [{ name: 'a', run: async () => null }, { name: 'kill', run: () => { ran++; return new Promise(() => {}); } }, { name: 'c', run: async () => 'fixed' }];
  const go = (st) => Promise.race([L.climb({ st, isStalled: true, rungs: R, say: async () => {}, page: async () => {}, save: async (x) => { saved = x; }, now: T0 }), new Promise((r) => setTimeout(r, 30))]);
  await go(null); await go(saved);
  return ran === 1;
};
const rearmCase = async (L) => {
  const said = [], R = [{ name: 'x', run: async () => null }];
  let o = await L.climb({ st: null, isStalled: true, rungs: R, say: async (t) => said.push(t), page: async () => {}, now: T0 });
  o = await L.climb({ st: o.st, isStalled: true, rungs: R, say: async (t) => said.push(t), page: async () => {}, now: T0 + 30 * MIN });
  const quiet = o.acted === null;
  o = await L.climb({ st: o.st, isStalled: true, rungs: R, say: async (t) => said.push(t), page: async () => {}, now: T0 + 121 * MIN });
  return quiet && o.acted === 'page';
};
const LSRC = readFileSync(new URL('./infra/ladder.mjs', import.meta.url), 'utf8'), LLOC = readFileSync(new URL('./infra/ladderlocal.mjs', import.meta.url), 'utf8');
const vmRungSafe = (src) => /export const restartRunners = \(\) => async \(\) => null;/.test(src) && !/systemctl restart/.test(src);
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
if (!capCase(LADDER)) bad('every account at its usage cap must not stall; room on an account (or unknown usage) must');
if (!(await killCase(LADDER))) bad('a rung that kills the pass ran again on the next pass (state not saved before the rung)');
if (!(await rearmCase(LADDER))) bad('after a page the ladder must stay quiet, then climb again after REARM_MIN');
if (!vmRungSafe(LLOC)) bad('the VM restart-runners rung restarts the runner it runs on');
const B5105 = [
  ['caps count as a stall', LSRC.replace('if (capped || !(claimable > 0)', 'if (!(claimable > 0)'), capCase],
  ['state saved after the rung', LSRC.replace('    await save({ ...st, i: st.i + 1 });', ''), killCase],
  ['no re-arm', LSRC.replace('if (st.paged && now - (st.pagedAt || 0) >= REARM_MIN * 60e3) st = { i: 0, paged: false };', ''), rearmCase],
];
let caught = 0;
for (const [n, src, fn] of B5105) if (!(await fn(await load(src)))) caught++; else bad(`break not caught: ${n}`);
if (!vmRungSafe(LLOC.replace('async () => null;', "async () => { spawnSync('sudo', ['systemctl restart']); return 'x'; };"))) caught++; else bad('break not caught: VM rung restarts itself');
for (const [f, r] of cases) if (!(await ok(f, r, { drop: r }))) caught++; else bad(`break not caught: ${r} removed but "${f}" still recovered`);
if (!(await ok('fill', 'restart-fill', { noStall: true }))) caught++; else bad('break not caught: blinded detector');
console.log(`${caught} breaks caught`); process.exit(fail);
