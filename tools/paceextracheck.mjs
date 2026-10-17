#!/usr/bin/env node
// paceextracheck.mjs - #4954 (Dan, 10 Oct: "1 worker, and if the 5-hour window would likely not overflow with another, have the fill add it,
// otherwise keep it at 1"). FILL_WORKERS is the BASE; fill.paceExtra adds sessions only while usageCap's pacing says they fit the window.
// 1. behaviour cases (paceExtra / fillWant / fillCount / fillShape)  2. wiring (brain passes usage, roles.json sets paceExtra)  3. anti-vacuity.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const P = (f) => fileURLToPath(new URL('../' + f, import.meta.url)), rd = (f) => readFileSync(P(f), 'utf8');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const ROUTE = rd('tools/brain/route.mjs'), BRAIN = rd('tools/brain/brain.mjs'), ROLES = JSON.parse(rd('tools/brain/roles.json'));
let seq = 0;
async function load(src) {                       // route.mjs imports nothing, so a mutated copy beside it loads on its own
  const f = P(`tools/brain/_paceextra${process.pid}_${seq++}.tmp.mjs`);
  writeFileSync(f, src);
  try { return await import(pathToFileURL(f).href); } finally { unlinkSync(f); }
}
const NOW = Date.parse('2026-10-10T20:00:00Z');                       // 16:00 ET: outside the 08:00-14:00 quiet window
const usage = (pct, hLeft, atAgoMin = 1, week = 10) => ({ acct: 'max', window: { pct, resets_at: new Date(NOW + hLeft * 3600e3).toISOString() }, week: { pct: week }, at: new Date(NOW - atAgoMin * 60e3).toISOString(), weekCap: 90 });
const CFG = JSON.parse(JSON.stringify(ROLES));
async function cases(R, cfg = CFG) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(n); };
  const W = (o, u, c = cfg) => R.fillWant(c, NOW, o, u);
  t('roomy window (30%, 3.5 h left): base 1 -> 2', () => W('1', usage(30, 3.5)) === 2);
  t('Pro never gets the extra, even with a roomy window', () => W('1', { ...usage(30, 3.5), acct: 'pro' }) === 1);
  t('Max does', () => W('1', { ...usage(30, 3.5), acct: 'max' }) === 2);
  t('tight window (80%, 1 h left): stays 1', () => W('1', usage(80, 1)) === 1);
  t('window nearly reset (5%, 0.25 h left): base 1 -> 2, never more than paceExtra', () => W('1', usage(5, 0.25)) === 2);
  t('unknown usage (null): stays 1', () => W('1', null) === 1);
  t('stale usage (40 min old): stays 1', () => W('1', usage(10, 4, 40)) === 1);
  t('window spent (95%): no extra', () => W('1', usage(95, 2)) === 1);
  t('week spent: no extra', () => W('1', usage(10, 4, 1, 95)) === 1);
  t('base 0 (LOOP-OFF) never gets an extra', () => W('0', usage(10, 4)) === 0);
  t('no usage argument (old callers) = old behaviour', () => W('1') === 1);
  t('paceExtra 0 = off', () => W('1', usage(10, 4), { ...cfg, fill: { ...cfg.fill, paceExtra: 0 } }) === 1);
  t('no pacing configured (usageCap Infinity) is NOT evidence of room', () => W('1', usage(10, 4), { ...cfg, fill: { ...cfg.fill, sessionPctPerHour: undefined } }) === 1);
  t('fillCount: 0 running, roomy -> starts 2', () => R.fillCount(cfg, NOW, 0, '1', usage(30, 3.5), null) === 2);
  t('fillCount: 1 running, roomy -> starts 1 more', () => R.fillCount(cfg, NOW, 1, '1', usage(30, 3.5), null) === 1);
  t('fillCount: 2 running -> 0', () => R.fillCount(cfg, NOW, 2, '1', usage(30, 3.5), null) === 0);
  t('fillCount: 1 running, tight -> 0', () => R.fillCount(cfg, NOW, 1, '1', usage(80, 1), null) === 0);
  t('fillShape total follows the extra when usage rides in ctx', () => R.fillShape(cfg, NOW, '1', { usage: usage(30, 3.5), claimable: 9, drain: 4, budgetSlots: 2 }).total === 2);
  t('fillShape without usage in ctx stays at the base', () => R.fillShape(cfg, NOW, '1', { claimable: 9, drain: 4, budgetSlots: 2 }).total === 1);
  return bad;
}
const real = await load(ROUTE), bad = await cases(real);
ok(bad.length === 0, 'behaviour: ' + bad.join(' | '));
const wiring = (S) => { const b = [];
  if (!/testerBugs: \(H\.testerRuns \|\| \[\]\)\.map\(\(r\) => r\.bugs\), usage,/.test(S.b)) b.push('brain.mjs does not pass usage into fillShape');
  if (!/fillWant\(cfg, now, override, usage\), usageCap/.test(S.r)) b.push('fillCount does not pass usage to fillWant');
  if (!/fillWant\(cfg, now, override, ctx\.usage\)/.test(S.r)) b.push('fillShape does not pass ctx.usage to fillWant');
  if (!(S.j.fill && S.j.fill.paceExtra >= 1)) b.push('roles.json fill.paceExtra is not set');
  return b; };
const S0 = { b: BRAIN, r: ROUTE, j: ROLES };
ok(wiring(S0).length === 0, 'wiring: ' + wiring(S0).join(' | '));
for (const [n, f] of [
  ['extra added without checking room', (s) => s.replace('cap >= base + x ? x : 0', 'cap >= 1 ? x : 0')],
  ['unconfigured pacing (Infinity) counts as room', (s) => s.replace('Number.isFinite(cap) && ', '')],
  ['base 0 gets an extra', (s) => s.replace('|| !(base > 0)', '')],
  ['fillCount ignores usage for the extra', (s) => s.replace('fillWant(cfg, now, override, usage), usageCap', 'fillWant(cfg, now, override), usageCap')],
  ['fillShape ignores usage for the extra', (s) => s.replace('fillWant(cfg, now, override, ctx.usage)', 'fillWant(cfg, now, override)')],
  ['Pro gets the extra too', (s) => s.replace('if (only && !only.includes(usage.acct)) return 0;', '')],
  ['extra ignores paceExtra size', (s) => s.replace('? x : 0;', '? 5 : 0;')],
]) { const m = f(ROUTE); let c = false; if (m !== ROUTE) { try { c = (await cases(await load(m))).length > 0; } catch { c = true; } } ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
for (const [n, f] of [
  ['brain.mjs stops passing usage to fillShape', (S) => ({ ...S, b: S.b.replace(' usage, budgetSlots:', ' budgetSlots:') })],
  ['roles.json loses paceExtra', (S) => ({ ...S, j: { ...S.j, fill: { ...S.j.fill, paceExtra: 0 } } })],
]) { const m = f(S0); const c = JSON.stringify(m) !== JSON.stringify(S0) && wiring(m).length > 0; ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
console.log(`paceextracheck: ${asserts} assertions, ${fails} failed, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
