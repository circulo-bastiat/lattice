// tools/capacitycheck.mjs - #7584 (Dan, 15 Oct: "on weekdays from 2 am to 1 pm it runs at 10 cores and the limit is adjusted appropriately").
// Rules: route.mjs capacityState follows roles.json fill.capacity by the New York wall clock (weekday window 02:00-13:00 = 10 cores / 5 slots, else 6 / 3; `to` exclusive;
// weekends and midnight-1:59 are base); quietState() (the 08:00-14:00 halving of the total) is untouched by the profile, weekdays included (Dan, 15 Oct 06:55); the lockstep pilot cap, the
// server slots (only on the capacity host) and `go.mjs status` read the profile. Anti-vacuity below: every break must be caught.
import { readFileSync } from 'node:fs';
import { capacityState, quietState } from './brain/route.mjs';
const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ROLES = rd('./brain/roles.json'), GO = rd('./go.mjs'), SERVER = rd('./referee/server.mjs');
const T = (s) => Date.parse(s);   // UTC; in October New York is UTC-4
const CASES = [   // [label, time, cores, slots, quiet factor]
  ['Thu 03:00 ET', '2026-10-15T07:00:00Z', 10, 5, 1], ['Thu 09:00 ET (halved, 10 cores)', '2026-10-15T13:00:00Z', 10, 5, 0.5], ['Thu 12:59 ET', '2026-10-15T16:59:00Z', 10, 5, 0.5],
  ['Thu 13:00 ET (to is exclusive)', '2026-10-15T17:00:00Z', 6, 3, 0.5], ['Thu 13:30 ET', '2026-10-15T17:30:00Z', 6, 3, 0.5], ['Thu 15:00 ET', '2026-10-15T19:00:00Z', 6, 3, 1],
  ['Sat 09:00 ET (weekend: no window)', '2026-10-17T13:00:00Z', 6, 3, 0.5], ['Sat 03:00 ET', '2026-10-17T07:00:00Z', 6, 3, 1], ['Mon 01:59 ET', '2026-10-19T05:59:00Z', 6, 3, 1], ['Mon 02:00 ET', '2026-10-19T06:00:00Z', 10, 5, 1],
  ['Fri 02:00 ET', '2026-10-16T06:00:00Z', 10, 5, 1],
];
const verdict = ({ cap, quiet, roles, go, server }) => {
  const bad = [], R = JSON.parse(roles);
  for (const [label, t, cores, slots, qf] of CASES) {
    const c = cap(R, T(t)), q = quiet(R, T(t));
    if (c.cores !== cores || c.slots !== slots) bad.push(`${label}: cores/slots ${c.cores}/${c.slots}, want ${cores}/${slots}`);
    if (q.factor !== qf) bad.push(`${label}: quiet factor ${q.factor}, want ${qf}`);
  }
  if (R.fill.capacity.host !== 'claude-sandbox') bad.push('fill.capacity.host must name the brain VM (claude-sandbox): the profile must not cap the lander or the PCs');
  if (R.fill.lockstepPilotCap !== 'auto') bad.push('fill.lockstepPilotCap must be "auto" (= the profile\'s slots) so the pilot cap follows the hour');
  if (!/lockstepPilotCap === 'auto' \? capacityState\(\{ fill: f \}, Date\.now\(\)\)\.slots/.test(go) || !/capacity now:/.test(go)) bad.push('go.mjs does not derive the pilot cap from capacityState / print the capacity line');
  if (!/c\.host === hostname\(\) \? capacityState\(R, Date\.now\(\)\)\.slots : Infinity/.test(server) || !/profileSlots\(\)\)\);/.test(server)) bad.push('referee/server.mjs serverSlots does not apply the profile on the capacity host only');
  return bad;
};
const REAL = { cap: capacityState, quiet: quietState, roles: ROLES, go: GO, server: SERVER };
const BREAKS = [
  ['window ignored', { cap: (R, t) => capacityState({ fill: { ...R.fill, capacity: { ...R.fill.capacity, windows: [] } } }, t) }],
  ['weekdays ignored (every day)', { cap: (R, t) => capacityState({ fill: { ...R.fill, capacity: { ...R.fill.capacity, windows: [{ ...R.fill.capacity.windows[0], days: undefined }] } } }, t) }],
  ['to inclusive', { cap: (R, t) => capacityState(R, t + 60e3) }],
  ['slots = cores', { cap: (R, t) => { const c = capacityState(R, t); return { ...c, slots: c.cores }; } }],
  ['window starts at 03:00', { cap: (R, t) => capacityState({ fill: { ...R.fill, capacity: { ...R.fill.capacity, windows: [{ ...R.fill.capacity.windows[0], from: '03:00' }] } } }, t) }],
  ['the window switches the halving off', { quiet: (R, t) => ({ factor: capacityState(R, t).window ? 1 : quietState(R, t).factor }) }],
  ['host gate gone', { roles: ROLES.replace('"host": "claude-sandbox"', '"host": ""') }],
  ['pilot cap fixed number', { roles: ROLES.replace('"lockstepPilotCap": "auto"', '"lockstepPilotCap": 3') }],
  ['go.mjs ignores the profile', { go: GO.replace("lockstepPilotCap === 'auto' ? capacityState({ fill: f }, Date.now()).slots", "lockstepPilotCap === 'auto' ? 3") }],
  ['server slots ignore the profile', { server: SERVER.replace('profileSlots()));', '99));') }],
  ['server profile applies on every host', { server: SERVER.replace('c.host === hostname() ?', 'c ?') }],
];
const bad0 = verdict(REAL); let caught = 0;
for (const [n, over] of BREAKS) { if (verdict({ ...REAL, ...over }).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of bad0) console.log(' FAIL:', x);
console.log(`capacitycheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(bad0.length || caught < BREAKS.length ? 1 : 0);
