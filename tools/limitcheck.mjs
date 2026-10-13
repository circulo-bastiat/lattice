#!/usr/bin/env node
// limitcheck.mjs - #1937: an account LIMIT ("You've hit your session limit · resets 11:20pm (America/New_York)") is not a
// burned run, the account counts as out until the stated reset, and the boondoggle pause mails the fixer, not Dan's phone.
// 1. parseLimit on the real 3 Oct message and variants  2. applyLimits makes the fill/pickAccount stop and switch account
// 3. wiring in launch.mjs / brain.mjs  4. anti-vacuity: broken parsers / appliers / wirings must each fail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLimit, applyLimits, pickAccount, usageCap } from './brain/route.mjs';
const rd = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const NOW = Date.parse('2026-10-03T03:13:50Z');
const REAL = "You've hit your session limit · resets 11:20pm (America/New_York)";   // verbatim, bus #1936 03:13:50Z

function parseCases(parse) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(n); };
  t('the real 3 Oct message -> session until 03:20Z', () => { const r = parse(REAL, NOW); return r && r.kind === 'session' && r.until === Date.parse('2026-10-03T03:20:00Z'); });
  t('a bare time already past today -> tomorrow', () => parse(REAL, Date.parse('2026-10-03T03:25:00Z')).until === Date.parse('2026-10-04T03:20:00Z'));
  t('a dated weekly reset in EDT', () => { const r = parse("You've hit your weekly limit · resets Oct 4, 7am (America/New_York)", NOW); return r && r.kind === 'weekly' && r.until === Date.parse('2026-10-04T11:00:00Z'); });
  t('another zone with minutes', () => parse('hit your session limit · resets 4:30pm (Europe/London)', NOW).until === Date.parse('2026-10-03T15:30:00Z'));
  t('no reset given -> out for an hour, never "not a limit"', () => { const r = parse("You've hit your usage limit", NOW); return r && r.until === NOW + 3600e3; });
  t('an ordinary result is not a limit', () => parse('PR #1913 queued for the lander. 5 assertions, 0 failures', NOW) === null);
  t('a result that merely talks about limits is not one', () => parse('the 100-minute limit killed a check; rate limits are fine', NOW) === null);
  return bad;
}
{ const b = parseCases(parseLimit); ok(!b.length, 'parseLimit: ' + b.join('; ')); }

const CFG = { accounts: [{ name: 'max', maxWeekPct: 96 }, { name: 'pro' }], fill: { maxWindowPct: 90, maxWeekPct: 80 } };
const U = { at: new Date(NOW - 13 * 60e3).toISOString(), accounts: { max: { window: { pct: 10 }, week: { pct: 97 } }, pro: { window: { pct: 84, resets_at: '2026-10-03T05:10:00Z' }, week: { pct: 18 } } } };
function applyCases(apply) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(n); };
  const lim = { pro: Date.parse('2026-10-03T03:20:00Z') };
  t('the limited account reads 100% until its reset', () => apply(U, lim, NOW).accounts.pro.window.pct === 100 && apply(U, lim, NOW).accounts.pro.window.resets_at === '2026-10-03T03:20:00.000Z');
  t('the fill stops on it (usageCap 0)', () => { const a = apply(U, lim, NOW).accounts.pro; return usageCap(CFG, { ...a, at: U.at }, NOW) === 0; });
  t('pickAccount moves to a free account', () => pickAccount({ ...CFG, accounts: [{ name: 'pro' }, { name: 'max', maxWeekPct: 99 }] }, NOW, () => true, apply(U, lim, NOW)) === 'max');
  t('after the reset nothing is changed', () => apply(U, lim, Date.parse('2026-10-03T03:21:00Z')) === U);
  t('the other account is untouched', () => apply(U, lim, NOW).accounts.max.window.pct === 10);
  t('the input is not mutated', () => { apply(U, lim, NOW); return U.accounts.pro.window.pct === 84; });
  t('works with no usage reading at all', () => apply(null, lim, NOW).accounts.pro.window.pct === 100);
  return bad;
}
{ const b = applyCases(applyLimits); ok(!b.length, 'applyLimits: ' + b.join('; ')); }

const SRC = { launch: rd('tools/brain/launch.mjs'), brain: rd('tools/brain/brain.mjs') };
function wiring(S) {
  const bad = [];
  if (!/const limit = parseLimit\(/.test(S.launch)) bad.push('launch.mjs does not read the limit message');
  if (!/if \(issueNo && !limit\)/.test(S.launch)) bad.push('a limit death still counts as a burned run');
  if (!/h\.limits = \{/.test(S.launch)) bad.push('launch.mjs does not record the account as out');
  if (!/U = applyLimits\(U, history\(\)\.limits, now\)/.test(S.launch)) bad.push('launch.mjs picks an account ignoring known limits');
  if (!/applyLimits\(JSON\.parse\([^\n]*MCLITE_USAGE[^\n]*history\(\)\.limits, now\)/.test(S.brain)) bad.push('the fill ignores known limits');
  if (/post\('dan', 'brain: worker fill PAUSED/.test(S.brain) || !/post\('fixer', 'brain: worker fill PAUSED/.test(S.brain)) bad.push('the boondoggle pause pages Dan instead of starting the fixer');
  return bad;
}
{ const b = wiring(SRC); ok(!b.length, 'wiring: ' + b.join('; ')); }

// anti-vacuity
const BROKEN = [
  ['parser: never a limit', 'p', () => null],
  ['parser: ignores the zone (UTC)', 'p', (s, n) => { const r = parseLimit(s, n); return r && /New_York|London/.test(s) && /resets/.test(s) ? { ...r, until: r.until - 4 * 3600e3 } : r; }],
  ['parser: any "limit" word counts', 'p', (s, n) => (/limit/i.test(s) ? parseLimit(s, n) || { kind: 'x', until: n + 3600e3 } : null)],
  ['applier: does nothing', 'a', (U) => U],
  ['applier: never expires', 'a', (U, l) => applyLimits(U, Object.fromEntries(Object.keys(l || {}).map((k) => [k, Infinity])), NOW)],
  ['applier: mutates usage', 'a', (U, l, n) => { const o = applyLimits(U, l, n); if (U && U.accounts && U.accounts.pro && o !== U) U.accounts.pro.window.pct = 100; return o; }],
];
for (const [n, kind, fn] of BROKEN) {
  const Usave = JSON.stringify(U);
  const c = (kind === 'p' ? parseCases(fn) : applyCases(fn)).length > 0;
  Object.assign(U, JSON.parse(Usave));
  ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); }
}
for (const [n, f] of [
  ['limit death counted as a burn', (S) => ({ ...S, launch: S.launch.replace('if (issueNo && !limit)', 'if (issueNo)') })],
  ['limit not recorded', (S) => ({ ...S, launch: S.launch.replace('h.limits = {', 'h.limitz = {') })],
  ['fill ignores limits', (S) => ({ ...S, brain: S.brain.replace(/applyLimits\((JSON\.parse\([^\n]*?MCLITE_USAGE[^\n]*?'null'\)), history\(\)\.limits, now\)/g, '$1') })],
  ['pause pages Dan again', (S) => ({ ...S, brain: S.brain.replace("post('fixer', 'brain: worker fill PAUSED", "post('dan', 'brain: worker fill PAUSED") })],
]) { const m = f(SRC); const c = JSON.stringify(m) !== JSON.stringify(SRC) && wiring(m).length > 0; ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
console.log(`limitcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
