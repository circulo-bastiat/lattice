#!/usr/bin/env node
// pacecalcheck.mjs - #7631 (Dan, 15 Oct: "it should recalibrate automatically"): the fill pacing uses the MEASURED burn per session (window and week), not the fixed
// roles.json sessionPctPerHour. 1. behaviour of measuredRate / usageCap  2. wiring in brain.mjs  3. anti-vacuity (a mutated copy must fail the cases).
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const P = (f) => fileURLToPath(new URL('../' + f, import.meta.url)), rd = (f) => readFileSync(P(f), 'utf8');
let asserts = 0, fails = 0, breaks = 0, missed = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const ROUTE = rd('tools/brain/route.mjs'), BRAIN = rd('tools/brain/brain.mjs'), ROLES = JSON.parse(rd('tools/brain/roles.json'));
let seq = 0;
async function load(src) { const f = P(`tools/brain/_pacecal${process.pid}_${seq++}.tmp.mjs`); writeFileSync(f, src); try { return await import(pathToFileURL(f).href); } finally { unlinkSync(f); } }
const NOW = Date.parse('2026-10-10T20:00:00Z'), H = 3600e3, RS = new Date(NOW + 4 * H).toISOString(), WRS = new Date(NOW + 60 * H).toISOString();
// 3 sessions for 2 h, window 10% -> 19% (4.5 pts/h => 1.5 per session-hour); week 60 -> 61 (0.5 pts/h => 0.167 per session-hour)
const S = (m, run, win, wk, rs = RS) => ({ at: NOW - m * 60e3, running: run, win: { pct: win, resets_at: rs }, week: { pct: wk, resets_at: WRS } });
const samples = [S(120, 3, 10, 60), S(90, 3, 12.25, 60), S(60, 3, 14.5, 60.5), S(30, 3, 16.75, 61), S(0, 3, 19, 61)];
const usage = (extra = {}, pct = 19, hLeft = 4) => ({ acct: 'max', window: { pct, resets_at: new Date(NOW + hLeft * H).toISOString() }, week: { pct: 61, resets_at: WRS }, at: new Date(NOW - 60e3).toISOString(), weekCap: 96, ...extra });
const cfg = JSON.parse(JSON.stringify(ROLES));
async function cases(R) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(n); };
  const r = R.measuredRate(samples, NOW, 'win', 3, 1);
  t('window burn measured ~1.5 per session-hour', () => r > 1.4 && r < 1.6);
  t('too few session-hours = null', () => R.measuredRate([S(10, 1, 10, 60), S(0, 1, 12, 60)], NOW, 'win') === null);
  t('rise below minRise = null', () => R.measuredRate([S(120, 3, 10, 60), S(60, 3, 10.2, 60), S(0, 3, 10.4, 60)], NOW, 'win') === null);
  t('a window reset between samples is never a rise', () => R.measuredRate([S(120, 3, 10, 60), S(90, 3, 12, 60), S(60, 3, 40, 60, 'next'), S(30, 3, 41, 60, 'next'), S(0, 3, 42, 60, 'next')], NOW, 'win', 3, 1) < 1);
  t('a gap over 1 h is skipped', () => R.measuredRate([S(240, 3, 10, 60), S(0, 3, 40, 60)], NOW, 'win', 5, 1) === null);
  t('rate is clamped to 12', () => R.measuredRate([S(60, 5, 0, 60), S(30, 5, 40, 60), S(0, 5, 80, 60)], NOW, 'win', 3, 1) === 12);
  t('the fixed 3 caps a window start at 6 (+1 paceExtra = Max 7)', () => R.usageCap(cfg, usage({}, 0, 5), NOW) === 6);
  t('the measured 1.5 lifts it: floor(90/5/1.5)=12', () => R.usageCap(cfg, usage({ perSession: 1.5 }, 0, 5), NOW) === 12);
  t('the week pace bounds it: needs 35 pts in 60 h at 0.167/session-h = 3.5 -> 3', () => R.usageCap(cfg, usage({ perSession: 1.5, weekPerSession: 0.167 }, 0, 5), NOW) === 3);
  t('a lighter week burn allows more: 0.05 -> 11', () => R.usageCap(cfg, usage({ perSession: 1.5, weekPerSession: 0.05 }, 0, 5), NOW) === 11);
  t('a spent window or week is still 0', () => R.usageCap(cfg, usage({ perSession: 1.5 }, 95, 2), NOW) === 0 && R.usageCap(cfg, { ...usage({ perSession: 1.5 }), week: { pct: 97, resets_at: WRS } }, NOW) === 0);
  t('stale usage is still 1', () => R.usageCap(cfg, { ...usage({ perSession: 1.5 }), at: new Date(NOW - 40 * 60e3).toISOString() }, NOW) === 1);
  t('pushPace keeps 8 h', () => R.pushPace([S(600, 1, 1, 1)], S(0, 1, 1, 1), NOW).length === 1);
  return bad;
}
const bad = await cases(await load(ROUTE)); for (const b of bad) ok(false, b); ok(bad.length === 0, 'behaviour cases pass');
ok(/measuredRate\(h\.pace, now, 'win', 3, 1\)/.test(BRAIN) && /usage\.weekPerSession = measuredRate\(h\.pace, now, 'week', 8, 1\)/.test(BRAIN), 'brain.mjs feeds the measured rates into usage');
ok(/h\.pace = pushPace\(h\.pace, \{ at: now, running, win: usage\.window, week: usage\.week \}, now\)/.test(BRAIN), 'brain.mjs records a sample every pass');
ok(/usage\.perSession > 0 \? usage\.perSession : F\.sessionPctPerHour/.test(ROUTE), 'usageCap prefers the measured value');
for (const [name, mut] of [
  ['usageCap ignores the measured burn', ROUTE.replace('usage.perSession > 0 ? usage.perSession : F.sessionPctPerHour', 'F.sessionPctPerHour')],
  ['no week pace', ROUTE.replace('usage.weekPerSession > 0 &&', 'false &&')],
  ['a reset counts as a rise', ROUTE.replace('|| a[key].resets_at !== b[key].resets_at', '')],
  ['no clamp', ROUTE.replace('Math.min(12, Math.max(0.05, rise / sh))', 'rise / sh')],
  ['one session-hour not required', ROUTE.replace('sh >= 1 &&', 'sh > 0 &&')],
]) { const b2 = await cases(await load(mut)).catch(() => ['load failed']); if (b2.length) { breaks++; console.log('  ✓ break caught: ' + name); } else { missed++; console.log('  NOT CAUGHT ' + name); } }
console.log(`pacecalcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails || missed ? 1 : 0);
