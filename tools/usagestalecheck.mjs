#!/usr/bin/env node
// usagestalecheck.mjs - #2246 (3 Oct): usaged re-published a ~20 h old reading as fresh (both Claude logins' tokens had expired),
// so the fill caps, the 95% rule and the brain's "reading N min old" ran on frozen numbers. keepStale() must keep a failed
// account's last good reading usable only for STALE_OK_MIN, then mark it UNKNOWN ({ok:false}) with its true age and lastGood.
// 1. behaviour cases  2. wiring (publish uses it, readAt on fresh readings, launch.mjs/go.mjs say UNKNOWN)  3. anti-vacuity.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const rd = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const SRC = rd('tools/usaged.mjs');
const FN = (src) => { const a = src.indexOf('export const STALE_OK_MIN'), b = src.indexOf('async function publish(');
  return new Function(src.slice(a, b).replace(/export /g, '') + '\nreturn { keepStale, STALE_OK_MIN };')(); };
const T0 = Date.parse('2026-10-03T22:00:00Z'), GOOD = { ok: true, email: 'a@b', week: { pct: 18 }, window: { pct: 84 }, readAt: '2026-10-03T01:59:00Z' };
function cases({ keepStale }) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(n); };
  const run = (oldAcc, fresh, oldAt = '2026-10-03T02:00:00Z') => { const rec = { at: new Date(T0).toISOString(), accounts: fresh }; keepStale(rec, { at: oldAt, accounts: oldAcc }, T0); return rec.accounts; };
  t('20 h old reading -> UNKNOWN, not ok', () => { const a = run({ pro: GOOD }, { pro: { ok: false, why: 'HTTP 401' } }).pro; return a.ok === false && a.stale && /UNKNOWN/.test(a.why) && /20 h/.test(a.why) && !a.window; });
  t('unknown still carries the old numbers as lastGood with their true readAt', () => { const a = run({ pro: GOOD }, { pro: { ok: false, why: 'x' } }).pro; return a.lastGood.week.pct === 18 && a.lastGood.readAt === GOOD.readAt; });
  t('a 5 min old reading (a blip) stays usable and says stale', () => { const a = run({ pro: { ...GOOD, readAt: '2026-10-03T21:55:00Z' } }, { pro: { ok: false, why: 'x' } }).pro; return a.ok && a.stale && a.window.pct === 84; });
  t('a reading with no readAt falls back to the old file time', () => { const a = run({ pro: { ok: true, window: { pct: 1 } } }, { pro: { ok: false, why: 'x' } }, '2026-10-03T21:50:00Z').pro; return a.ok && a.readAt === '2026-10-03T21:50:00Z'; });
  t('an already-UNKNOWN account keeps its ORIGINAL age (does not look fresh again)', () => { const first = run({ pro: GOOD }, { pro: { ok: false, why: 'x' } }).pro; const again = run({ pro: first }, { pro: { ok: false, why: 'x' } }).pro; return again.ok === false && again.lastGood.readAt === GOOD.readAt; });
  t('a fresh good reading is never overwritten by an old one', () => run({ pro: GOOD }, { pro: { ok: true, window: { pct: 3 } } }).pro.window.pct === 3);
  t('an account that never had a reading stays as is', () => run({ default: { ok: false, why: 'no login' } }, { default: { ok: false, why: 'no login' } }).default.why === 'no login');
  return bad;
}
const real = FN(SRC), bad = cases(real);
ok(bad.length === 0, 'keepStale behaviour: ' + bad.join(' | '));
const LAUNCH = rd('tools/brain/launch.mjs'), GO = rd('tools/go.mjs');
const wiring = (S) => { const bad = [];
  if (!/keepStale\(rec, old\)/.test(S.u)) bad.push('publish does not call keepStale');
  if (!/rest\.ok \? \{ \.\.\.rest, readAt: rec\.at \}/.test(S.u)) bad.push('fresh readings carry no readAt');
  if (!/a1\.readAt \|\| U2\.at/.test(S.l)) bad.push('launch.mjs ages the reading by the file time');
  if (!/usage UNKNOWN/.test(S.l)) bad.push('launch.mjs does not say UNKNOWN');
  if (!/'UNKNOWN - '/.test(S.g)) bad.push('go.mjs status does not say UNKNOWN');
  return bad; };
const S0 = { u: SRC, l: LAUNCH, g: GO };
ok(wiring(S0).length === 0, 'wiring: ' + wiring(S0).join(' | '));
for (const [n, f] of [
  ['a stale reading is kept ok forever', (s) => s.replace('ageMin <= STALE_OK_MIN', 'true')],
  ['kept reading loses its true age (uses now)', (s) => s.replace('const readAt = good.readAt || old.at', 'const readAt = new Date(nowMs).toISOString()')],
  ['unknown forgets the numbers', (s) => s.replace('lastGood: { ...g, readAt } }', '}')],
  ['unknown account is not ok:false', (s) => s.replace('{ ok: false, stale: true, why:', '{ ok: true, stale: true, why:')],
  ['an UNKNOWN account is not remembered across cycles', (s) => s.replace('u.lastGood && { ...u.lastGood, ok: true }', 'null')],
]) { const m = f(SRC); const c = m !== SRC && cases(FN(m)).length > 0; ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
for (const [n, f] of [
  ['publish stops calling keepStale', (S) => ({ ...S, u: S.u.replace('keepStale(rec, old);', '') })],
  ['fresh readings lose readAt', (S) => ({ ...S, u: S.u.replace('{ ...rest, readAt: rec.at }', 'rest') })],
  ['launch.mjs ages by the file time again', (S) => ({ ...S, l: S.l.replace('a1.readAt || U2.at', 'U2.at') })],
  ['launch.mjs silent when unknown', (S) => ({ ...S, l: S.l.replace('usage UNKNOWN', 'usage') })],
]) { const m = f(S0); const c = JSON.stringify(m) !== JSON.stringify(S0) && wiring(m).length > 0; ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
// #4938 (10 Oct): the brain must not budget from a `stale` account reading with no/old readAt (the old process published those as ok for 8 h),
// and the service must restart itself when its code changes, and go.mjs status must show a LIVE per-account reading.
{
  const ROUTE = rd('tools/brain/route.mjs'), BRAIN = rd('tools/brain/brain.mjs');
  const mk = (r) => new Function(r.slice(r.indexOf('export const acctFresh'), r.indexOf('export function pickAccount')).replace(/export /g, '') + '\nreturn acctFresh;')();
  const af = (R) => { const f = mk(R), N = Date.parse('2026-10-10T01:00:00Z'), bad = [];
    if (f({ ok: true, stale: true, week: { pct: 90 } }, N)) bad.push('stale with no readAt must be unknown');
    if (f({ ok: true, stale: true, readAt: '2026-10-10T00:00:00Z' }, N)) bad.push('stale 60 min old must be unknown');
    if (!f({ ok: true, stale: true, readAt: '2026-10-10T00:45:00Z' }, N)) bad.push('stale 15 min old (a blip) is usable');
    if (!f({ ok: true, week: { pct: 1 } }, N)) bad.push('a plain good reading is usable');
    if (f(undefined, N)) bad.push('missing account is unknown'); return bad; };
  ok(af(ROUTE).length === 0, 'acctFresh: ' + af(ROUTE).join(' | '));
  const w2 = (S) => { const b = [];
    if (!/!x \|\| !x\.week \|\| !acctFresh\(x, now\)/.test(S.r)) b.push('pickAccount ignores per-account staleness');
    if (!/a && a\.window && acctFresh\(a, now\)/.test(S.b)) b.push('brain fill budgets from a stale account');
    if (!/mt\(\) !== started/.test(S.u) || !/process\.exit\(0\)/.test(S.u)) b.push('usaged --serve does not restart itself on a code change');
    if (!/usage LIVE/.test(S.g)) b.push('go.mjs status shows no LIVE usage');
    return b; };
  const W0 = { r: ROUTE, b: BRAIN, u: SRC, g: GO };
  ok(w2(W0).length === 0, 'wiring #4938: ' + w2(W0).join(' | '));
  for (const [n, f] of [
    ['acctFresh trusts a stale reading with no readAt', () => { const b = af(ROUTE.replace('!(x.stale && !(x.readAt && now - Date.parse(x.readAt) <= 30 * 60e3))', 'true')); return b.length > 0; }],
    ['pickAccount stops checking acctFresh', () => w2({ ...W0, r: ROUTE.replace(' || !acctFresh(x, now)', '') }).length > 0],
    ['brain fill stops checking acctFresh', () => w2({ ...W0, b: BRAIN.replace(' && acctFresh(a, now)', '') }).length > 0],
    ['usaged stops restarting itself', () => w2({ ...W0, u: SRC.replace('mt() !== started', 'false') }).length > 0],
    ['go.mjs status loses the LIVE read', () => w2({ ...W0, g: GO.replaceAll('usage LIVE', 'usage') }).length > 0],
  ]) { const c = f(); ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
}
console.log(`usagestalecheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
