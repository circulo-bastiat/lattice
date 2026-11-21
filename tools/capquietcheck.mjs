#!/usr/bin/env node
// capquietcheck.mjs - CAPQUIET (Dan, 10 Nov: 'do a deep fixing'). 9-10 Nov: the Pro week sat at Dan's cap, so no role could start, yet the brain
// kept mailing the commander its 3-hour clock, raised 'mail-unanswered ... the wake did not work' every 2 h, re-sent the enlarger its slice hourly and
// logged 'not started' on every retry (14 mails + dozens of log lines in a day, all noise). CLASS: a role HELD by the usage cap must be quiet until
// the cap that holds it ends, and that end is the WEEK reset when the week is what caps. Pure cases on route.mjs + the wiring in brain.mjs/launch.mjs,
// then anti-vacuity: each break below must be caught.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { route: rd('./brain/route.mjs'), brain: rd('./brain/brain.mjs'), launch: rd('./brain/launch.mjs') };
const CFG = JSON.parse(rd('./brain/roles.json'));
const load = async (s) => { const d = mkdtempSync(join(tmpdir(), 'cq-')); const f = join(d, 'route.mjs'); writeFileSync(f, s); return import('file://' + f.replace(/\\/g, '/') + '?' + Math.random()); };
const now = Date.parse('2026-11-10T12:00:00Z'), WK = '2026-11-13T07:00:00Z', WIN = '2026-11-10T14:00:00Z', M20 = 21 * 60e3;
async function verdict(S) {
  const bad = []; const t = async (n, f) => { let r = false; try { r = !!(await f()); } catch { r = false; } if (!r) bad.push(n); };
  let M; try { M = await load(S.route); } catch (e) { return ['route.mjs does not load: ' + e.message]; }
  const weekCapped = { window: { pct: 2, resets_at: WIN }, week: { pct: 61, resets_at: WK }, weekCap: 60 };
  await t('week at its cap parks to the WEEK reset', () => M.capParkUntil(weekCapped, now) >= Date.parse(WK));
  await t('fill.maxWeekPct is used when the account has no cap of its own', () => M.capParkUntil({ ...weekCapped, weekCap: undefined }, now, 60) >= Date.parse(WK));
  await t('week under its cap parks to the window reset only', () => { const u = M.capParkUntil({ ...weekCapped, week: { pct: 40, resets_at: WK } }, now); return u >= Date.parse(WIN) && u < Date.parse(WIN) + 5 * 60e3; });
  await t('no reset times at all still parks 30 min', () => { const u = M.capParkUntil({ window: { pct: 90 } }, now); return u > now + 29 * 60e3 && u < now + 32 * 60e3; });
  const held = { commander: { reason: 'x', at: now, until: Date.parse(WK) } };
  await t('capHeld: parked with a future until', () => M.capHeld(held, 'commander', now) === true);
  await t('capHeld: not after the reset, not another role, not plain parked mail', () => M.capHeld(held, 'commander', Date.parse(WK) + 1) === false && M.capHeld(held, 'fixer', now) === false && M.capHeld({ commander: { reason: 'x', at: now } }, 'commander', now) === false && M.capHeld(null, 'commander', now) === false);
  const mail = [{ id: 1, to: 'commander', from: 'brain', created_at: new Date(now - M20).toISOString() }];
  const keys = (snap) => M.findings({ now, mail, ...snap }, CFG).map((f) => f.key);
  await t('unanswered mail alerts when the commander is NOT held', () => keys({}).includes('mail-unanswered'));
  await t('no unanswered alert while the commander is held by the cap', () => !keys({ commanderCapHeld: true }).includes('mail-unanswered'));
  await t('parked mail is not due before the week reset', () => M.pendingMailDue(held, [], CFG, now + 6 * 3600e3).length === 0);
  await t('parked mail is due after it', () => (M.pendingMailDue(held, [], CFG, Date.parse(WK) + 60e3)[0] || {}).role === 'commander');
  await t('parked mail is due at once when the cap is raised', () => (M.pendingMailDue(held, [], CFG, now + 60e3, () => true)[0] || {}).role === 'commander' && M.pendingMailDue(held, [], CFG, now + 60e3, () => false).length === 0);
  await t('brain: no clock mail to a held commander', () => /if \(!capHeld\(pendingMail\(\), 'commander', now\) && commanderClockDue\(/.test(S.brain));
  await t('brain: the health snapshot carries the hold', () => /snap\.commanderCapHeld = capHeld\(pendingMail\(\), 'commander', now\);[^\n]*\n\s*const found = findings\(snap, CFG\)/.test(S.brain));
  await t('brain: no enlarger round while the enlarger is held', () => /let d = capHeld\(pendingMail\(\), 'enlarger', now\) \? \{ act: 'none'/.test(S.brain));
  await t('brain: a raised cap releases parked mail (fresh usage only)', () => /pendingMailDue\(pendingMail\(\), history\(\)\.starts, CFG, now, \(r\) => !!usage && !\(usage\.at && now - Date\.parse\(usage\.at\) > 30 \* 60e3\) && usageCap\(roleCapCfg\(CFG, r\), usage, now\) > 0\)/.test(S.brain) && /import \{[^}]*\bcapHeld\b[^}]*\broleCapCfg\b[^}]*\} from '\.\/route\.mjs'/.test(S.brain));
  await t('launch: parks with the week cap and logs the skip once', () => /capParkUntil\(usage, now, \(CFG\.fill \|\| \{\}\)\.maxWeekPct\)/.test(S.launch) && /if \(!capHeld\(pendingMail\(\), role, now\)\) await post\('log', `brain: \$\{role\} not started/.test(S.launch) && /import \{[^}]*\bcapHeld\b[^}]*\} from '\.\/route\.mjs'/.test(S.launch));
  return bad;
}
const real = await verdict(SRC); for (const b of real) console.log('FAIL ' + b);
const rep = (s, a, b) => { if (!s.includes(a)) throw new Error('break text not found: ' + a.slice(0, 50)); return s.replace(a, b); };
const BREAKS = [
  ['week reset ignored', { ...SRC, route: rep(SRC.route, 'return (w > now ? Math.max(w, base) : base) + 30e3;', 'return base + 30e3;') }],
  ['fill.maxWeekPct ignored', { ...SRC, route: rep(SRC.route, '(usage.weekCap ?? maxWeekPct)', '(usage.weekCap ?? null)') }],
  ['week always parks', { ...SRC, route: rep(SRC.route, '(usage.week.pct || 0) >= wc', '(usage.week.pct || 0) >= 0') }],
  ['capHeld always true', { ...SRC, route: rep(SRC.route, 'return !!(p && p.until > now); };', 'return true; };') }],
  ['capHeld never true', { ...SRC, route: rep(SRC.route, 'return !!(p && p.until > now); };', 'return false; };') }],
  ['unanswered alert ignores the hold', { ...SRC, route: rep(SRC.route, 'const stale = snap.commanderCapHeld ? [] : ', 'const stale = ') }],
  ['unanswered alert never fires', { ...SRC, route: rep(SRC.route, 'const stale = snap.commanderCapHeld ? [] : ', 'const stale = true ? [] : ') }],
  ['raised cap does not release', { ...SRC, route: rep(SRC.route, ' || !!(uncapped && uncapped(r)))', ')') }],
  ['release ignores until', { ...SRC, route: rep(SRC.route, '(now >= (p.until || 0) || !!(uncapped && uncapped(r)))', 'true') }],
  ['clock mails a held commander', { ...SRC, brain: rep(SRC.brain, "if (!capHeld(pendingMail(), 'commander', now) && commanderClockDue(", 'if (commanderClockDue(') }],
  ['snapshot lacks the hold', { ...SRC, brain: rep(SRC.brain, "snap.commanderCapHeld = capHeld(pendingMail(), 'commander', now);", '') }],
  ['enlarger round while held', { ...SRC, brain: rep(SRC.brain, "let d = capHeld(pendingMail(), 'enlarger', now) ? { act: 'none', why: 'the enlarger is parked at the usage cap' } : ", 'let d = ') }],
  ['brain release not wired', { ...SRC, brain: rep(SRC.brain, 'CFG, now, (r) => !!usage && ', 'CFG, now, (r) => false && ') }],
  ['stale usage releases', { ...SRC, brain: rep(SRC.brain, '!(usage.at && now - Date.parse(usage.at) > 30 * 60e3) && usageCap(roleCapCfg', 'usageCap(roleCapCfg') }],
  ['launch parks to the window', { ...SRC, launch: rep(SRC.launch, 'capParkUntil(usage, now, (CFG.fill || {}).maxWeekPct)', 'capParkUntil(usage, now)') }],
  ['launch logs every skip', { ...SRC, launch: rep(SRC.launch, "if (!capHeld(pendingMail(), role, now)) await post('log'", "await post('log'") }],
];
let caught = 0; for (const [n, S] of BREAKS) { if ((await verdict(S)).length) caught++; else console.log('NOT CAUGHT: ' + n); }
console.log(`capquietcheck: ${real.length ? 'FAIL' : 'ok'}, ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
