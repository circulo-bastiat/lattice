#!/usr/bin/env node
// commanderclockcheck.mjs - 21 Oct (Dan: an automatic commander, every 3 h, act only if stuck): the brain tick mails the commander on its own clock.
// Cases on route.mjs commanderClockDue + the mail text, the wiring in brain.mjs (inside the real health pass, never under --dry) and roles.json
// health.commanderClockH, then anti-vacuity: mutated copies of route.mjs / brain.mjs / roles.json must each be caught. Not a Claude scheduled task.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { route: rd('./brain/route.mjs'), brain: rd('./brain/brain.mjs'), roles: rd('./brain/roles.json') };
const load = async (s) => { const d = mkdtempSync(join(tmpdir(), 'ccc-')); const f = join(d, 'route.mjs'); writeFileSync(f, s); return import('file://' + f.replace(/\\/g, '/') + '?' + Math.random()); };
const H = 3600e3, now = Date.parse('2026-10-21T20:00:00Z');
async function verdict(S) {
  const bad = []; const t = async (n, f) => { let r = false; try { r = !!(await f()); } catch { r = false; } if (!r) bad.push(n); };
  let M; try { M = await load(S.route); } catch (e) { return ['route.mjs does not load: ' + e.message]; }
  const due = (o) => M.commanderClockDue({ now, starts: [], lastClock: 0, hours: 3, ...o });
  await t('nothing ever ran -> due', () => due({}) === true);
  await t('a clock mail 2 h ago -> not due', () => due({ lastClock: now - 2 * H }) === false);
  await t('a clock mail 3 h ago -> due', () => due({ lastClock: now - 3 * H }) === true);
  await t('an alert-driven commander 1 h ago counts -> not due', () => due({ starts: [{ role: 'commander', at: now - H }] }) === false);
  await t('a commander 4 h ago does not -> due', () => due({ starts: [{ role: 'commander', at: now - 4 * H }] }) === true);
  await t('workers and fixers do not reset the clock', () => due({ starts: [{ role: 'worker', at: now - 60e3 }, { role: 'fixer', at: now - 60e3 }] }) === true);
  await t('hours 0 turns it off', () => due({ hours: 0 }) === false);
  await t('undefined history is fine', () => M.commanderClockDue({ now, hours: 3 }) === true);
  const tx = M.COMMANDER_CLOCK_TEXT;
  await t('the mail tells a healthy commander to end at once and a stuck one to fix the cause', () => /reply "healthy", post ONE/.test(tx) && /go\.mjs status/.test(tx) && /say --to log/.test(tx) && /CAUSE/.test(tx) && /go\.mjs reply|Reply to this mail/.test(tx));
  await t('wired in the real health pass after the dry return', () => /commanderClockDue\(\{ now, starts: h\.starts, lastClock: h\.commanderClock, hours: \(CFG\.health \|\| \{\}\)\.commanderClockH \?\? 3 \}\)/.test(S.brain) && S.brain.indexOf('commanderClockDue({ now') > S.brain.indexOf("if (process.argv.includes('--dry')) { for (const f of found)"));
  await t('it posts to the commander and stamps the clock', () => /post\('commander', COMMANDER_CLOCK_TEXT\)[\s\S]{0,120}h\.commanderClock = now/.test(S.brain));
  let C = {}; try { C = JSON.parse(S.roles); } catch { /* broken */ }
  await t('roles.json health.commanderClockH is 3', () => (C.health || {}).commanderClockH === 3);
  await t('the commander role can be woken by mail', () => (C.wake || {}).commander === 'commander');
  return bad;
}
const real = await verdict(SRC); let caught = 0;
const BREAKS = [
  ['never due', { ...SRC, route: SRC.route.replace('return !starts.some(', 'return false && !starts.some(') }],
  ['always due', { ...SRC, route: SRC.route.replace('if (now - (lastClock || 0) < ms) return false;', '') .replace('return !starts.some((x) => x && x.role === \'commander\' && now - x.at < ms);', 'return true;') }],
  ['an alert-driven commander does not reset it', { ...SRC, route: SRC.route.replace("x.role === 'commander' &&", "x.role === 'nobody' &&") }],
  ['hours 0 is not off', { ...SRC, route: SRC.route.replace('if (!(hours > 0)) return false;', '') }],
  ['mail text loses the healthy exit', { ...SRC, route: SRC.route.replace('reply \\"healthy\\", post ONE', 'post ONE') }],
  ['not wired into brain.mjs', { ...SRC, brain: SRC.brain.replace('commanderClockDue({ now, starts', 'commanderClockDueX({ now, starts') }],
  ['runs under --dry too', { ...SRC, brain: SRC.brain.replace("  if (commanderClockDue({ now,", "  if (true) {} if (commanderClockDue({ now,").replace("  console.log(`health: ${found.length ?", "  if (commanderClockDue({ now, starts: h.starts, lastClock: h.commanderClock, hours: (CFG.health || {}).commanderClockH ?? 3 })) {}\n  console.log(`health: ${found.length ?") }],
  ['clock never stamped', { ...SRC, brain: SRC.brain.replace('h.commanderClock = now; console.log(\'health: 3 h commander clock', 'console.log(\'health: 3 h commander clock') }],
  ['roles.json has no commanderClockH', { ...SRC, roles: SRC.roles.replace(', "commanderClockH": 3', '') }],
];
for (const [n, S] of BREAKS) { const r = await verdict(S); if (r.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`commanderclockcheck: ${real.length ? 'FAILED' : 'ok'}, ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
