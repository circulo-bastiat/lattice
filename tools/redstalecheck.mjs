// redstalecheck (#10096, Dan 24 Oct: "the commander is supposed to investigate not watch"): a master that stays red past health.redStaleHours
// raises `master-red-stale` (a directive to CLAIM the cause), the 3-hour clock text no longer calls tracked reds healthy, and brain.mjs/roles.json carry it.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as R from './brain/route.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const rd = (f) => readFileSync(join(HERE, f), 'utf8');
const HR = 3600e3, now = Date.UTC(2026, 9, 24, 16, 0);
const CFG = JSON.parse(rd('brain/roles.json'));
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
const keys = (snap, cfg = CFG) => R.findings({ now, runners: [], mail: [], ...snap }, cfg).map((f) => f.key);
const SRC = { route: rd('brain/route.mjs'), brain: rd('brain/brain.mjs'), roles: rd('brain/roles.json') };
function verdict(S) {
  const bad = [];
  const t = S.route.match(/export const COMMANDER_CLOCK_TEXT = `([\s\S]*?)`;/);
  const tx = t ? t[1] : '';
  if (/master reds all tracked/.test(tx) || !/master not red for over 12 h/.test(tx) || !/go\.mjs start --issue N/.test(tx)) bad.push('clock text still calls tracked reds healthy / does not say claim the cause');
  if (!/key: 'master-red-stale'/.test(S.route) || !/redStaleHours \|\| 12/.test(S.route)) bad.push('route.mjs has no master-red-stale finding at redStaleHours');
  if (!/snap\.redSinceMs = snap\.masterRed \? \(h\.redFirstAt/.test(S.brain) || !/h\.redFirstAt = snap\.redSinceMs/.test(S.brain)) bad.push('brain.mjs does not keep redFirstAt');
  let C = {}; try { C = JSON.parse(S.roles); } catch { /* broken */ }
  if ((C.health || {}).redStaleHours !== 12 || !(C.health.realertHoursFor || {})['master-red-stale']) bad.push('roles.json lacks redStaleHours / master-red-stale realert');
  return bad;
}
ok(keys({ masterRed: true, redSinceMs: now - 3 * HR }).includes('master-red') && !keys({ masterRed: true, redSinceMs: now - 3 * HR }).includes('master-red-stale'), 'red 3 h: master-red only');
ok(keys({ masterRed: true, redSinceMs: now - 13 * HR }).includes('master-red-stale'), 'red 13 h: master-red-stale');
ok(!keys({ masterRed: false, redSinceMs: null }).includes('master-red-stale'), 'green: nothing');
ok(!keys({ masterRed: true }).includes('master-red-stale'), 'red with no start known: not stale yet');
const f = R.findings({ now, runners: [], mail: [], masterRed: true, redSinceMs: now - 30 * HR }, CFG).find((x) => x.key === 'master-red-stale');
ok(f && /CLAIM the cause/.test(f.text) && /NOT handled/.test(f.text) && /30 h/.test(f.text), 'the text is a directive and names the hours');
const d = R.dueAlerts([{ key: 'master-red-stale', text: 't' }], [{ key: 'master-red-stale', at: now - 7 * HR }], [], CFG, now);
ok(d.mail.length === 1, 're-alerts after 6 h'); ok(!R.dueAlerts([{ key: 'master-red-stale', text: 't' }], [{ key: 'master-red-stale', at: now - 3 * HR }], [], CFG, now).mail.length, 'not before 6 h');
ok(verdict(SRC).length === 0, 'the real files pass: ' + verdict(SRC).join('; '));
const BREAKS = [
  ['clock text calls tracked reds healthy', { ...SRC, route: SRC.route.replace('master not red for over 12 h', 'master reds all tracked') }],
  ['finding removed', { ...SRC, route: SRC.route.replace("key: 'master-red-stale'", "key: 'master-red-x'") }],
  ['brain does not keep the start', { ...SRC, brain: SRC.brain.replace('h.redFirstAt = snap.redSinceMs', 'h.zzz = snap.redSinceMs') }],
  ['roles.json loses the setting', { ...SRC, roles: SRC.roles.replace('"redStaleHours": 12,', '') }],
];
let caught = 0;
for (const [m, S] of BREAKS) if (verdict(S).length) caught++; else console.log(' NOT CAUGHT:', m);
// behaviour breaks: threshold ignored / finding never raised
const noStale = (snap) => R.findings(snap, CFG).filter((x) => x.key !== 'master-red-stale').map((x) => x.key);
if (!noStale({ now, runners: [], mail: [], masterRed: true, redSinceMs: now - 13 * HR }).includes('master-red-stale')) caught++;
const BR = BREAKS.length + 1;
console.log(`${n} assertions, ${fails} failures, ${caught} breaks caught (of ${BR})`);
process.exit(fails || caught < BR ? 1 : 0);
