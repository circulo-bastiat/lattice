// #11345: a role mail dropped at the usage cap is parked until the window resets, and requests runs at a higher cap.
import { readFileSync } from 'node:fs';
import * as R from './brain/route.mjs';
const CFG0 = JSON.parse(readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8')); const CFG = { ...CFG0, fill: { ...CFG0.fill, maxWindowPct: 40 } };
const launch = readFileSync(new URL('./brain/launch.mjs', import.meta.url), 'utf8');
const T0 = Date.parse('2026-11-09T06:36:00Z'), reset = '2026-11-09T08:00:00Z';
function run(S) {
  const bad = [];
  const usage = { window: { pct: 50, resets_at: reset }, week: { pct: 49 }, at: new Date(T0).toISOString() };
  if (S.R.usageCap(S.cfg(CFG, 'worker'), usage, T0) !== 0) bad.push('a worker at 50% is not capped');
  if (S.R.usageCap(S.cfg(CFG, 'requests'), usage, T0) === 0) bad.push('requests at 50% is capped (it has its own higher cap)');
  const until = S.R.capParkUntil(usage, T0);
  if (!(until >= Date.parse(reset))) bad.push('park time is before the window reset');
  const pm = { requests: { reason: 'req #11344', at: T0, until } };
  if (S.R.pendingMailDue(pm, [], CFG, T0 + 60e3).length !== 0) bad.push('parked mail is due before the reset');
  if (S.R.pendingMailDue(pm, [], CFG, Date.parse(reset) + 60e3)[0]?.role !== 'requests') bad.push('parked mail is not due after the reset');
  if (!/if \(role !== 'worker' && reason\) \{[^\n]*\n\s*const until = capParkUntil[\s\S]{0,200}setPendingMail\(role, \{ reason, at: now, until \}\)/.test(S.launch)) bad.push('launch.mjs does not park the capped mail');
  return bad;
}
const base = { R, cfg: R.roleCapCfg, launch };
const bad = run(base); for (const b of bad) console.log('FAIL ' + b);
const BREAKS = [
  ['no park', { ...base, launch: launch.replace('setPendingMail(role, { reason, at: now, until })', 'void 0') }],
  ['reset time ignored', { ...base, R: { ...R, capParkUntil: (u, n) => n } }],
  ['no role cap', { ...base, cfg: (c) => c }],
  ['due ignores until', { ...base, R: { ...R, pendingMailDue: (p, s, c, n) => Object.entries(p).map(([role, v]) => ({ role, reason: v.reason })) } }],
];
let caught = 0; for (const [n, S] of BREAKS) { if (run(S).length) caught++; else console.log('NOT CAUGHT: ' + n); }
console.log(`usagecapparkcheck: ${bad.length ? 'FAIL' : 'ok'}, ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(bad.length || caught < BREAKS.length ? 1 : 0);
