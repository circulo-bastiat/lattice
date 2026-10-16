// tools/lockstepcapcheck.mjs - #7579 (Dan, 15 Oct: "triage it permanently"): workers were CUT OFF at the 100-minute limit because nothing bounded the
// real-server pilots to what the brain VM serves. Rules: (1) lockstepFront(.., pilotCap) holds at most pilotCap lockstep issues at once and hides the rest;
// (2) only HELD branches are busy (heldRefs: a released/stale/old branch is not); (3) roles.json fill.lockstepPilotCap is set (1..4); (4) go.mjs feeds it the
// held branches; (5) the server JVM is capped to its slot's cores. Anti-vacuity below: every break must be caught.
import { readFileSync } from 'node:fs';
import { lockstepFront } from './infra/phaselane.mjs';
import { heldRefs } from './infra/heldnow.mjs';
import { capacityState } from './brain/route.mjs';
const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const GO = rd('./go.mjs'), ROLES = rd('./brain/roles.json'), SERVER = rd('./referee/server.mjs');
const I = (n, title, labels = []) => ({ number: n, title, labels: labels.map((name) => ({ name })) });
const L = [I(1, 'bug a'), I(2, 'G17-L4 lockstep a'), I(3, 'G17-L4 lockstep b'), I(4, 'bug b'), I(5, 'G17-L4 lockstep c'), I(6, 'lockstep umbrella', ['tracking']), I(7, 'lockstep blocked', ['blocked'])];
const ids = (l) => l.map((i) => i.number).join(',');
const none = new Set(), NOW = Date.parse('2026-10-15T12:00:00Z'), ago = (h) => new Date(NOW - h * 36e5).toISOString();
const node = (name, h, message) => ({ name, target: { committedDate: ago(h), message } });
const verdict = ({ front, held, go, roles, server }) => {
  const bad = [], eq = (got, want, what) => { if (got !== want) bad.push(`${what}: got ${got}, want ${want}`); };
  eq(ids(front(L, [], none, 10, 2)), '2,3,1,4,6,7', 'nothing held, cap 2: two lockstep issues lead, the third is hidden');
  eq(ids(front(L, ['work/2-x'], none, 10, 2)), '3,1,2,4,6,7', 'one held: one more may start, the third is hidden');
  eq(ids(front(L, ['work/2-x', 'work/3-y'], none, 10, 2)), '1,2,3,4,6,7', 'two held: no new lockstep claim (the held ones stay listed)');
  eq(ids(front(L, ['work/2-x', 'work/3-y'], new Set(['work/2-x', 'work/3-y']), 10, 2)), '2,3,1,4,6,7', 'branches waiting in review are not held');
  eq(ids(front(L, [], none, 0, 2)), '1,2,3,4,6,7', 'priority off (cap 0) still honours the pilot cap');
  eq(ids(front(L, [], none, 2, 0)), '2,3,1,4,5,6,7', 'pilotCap 0 = no cap (the old behaviour)');
  const nodes = [node('10-a', 0.1, 'takeover: stale for 0.1 h'), node('11-b', 1, 'handoff: released (not finished)'), node('12-c', 5, 'takeover: stale for 0.0 h'), node('13-d', 2, 'wip: pilot salts 3 done')];
  eq(held(nodes, none, 3, NOW).join(','), 'work/10-a,work/13-d', 'held = fresh and not released: released and 5-h-old branches are not busy');
  const rb = new Set(['work/13-d']); rb.rebase = new Set(['work/13-d']);
  eq(held(nodes, rb, 3, NOW).join(','), 'work/10-a', 'a bounced (needs-rebase) branch is free');
  let cap = 0; try { const R = JSON.parse(roles), v = R.fill.lockstepPilotCap; cap = v === 'auto' || v === 'mirror' ? capacityState(R, NOW).slots : Number(v) || 0; } catch { /* unreadable: cap stays 0 */ }
  if (cap < 1 || cap > 5) bad.push('roles.json fill.lockstepPilotCap must be a number 1..5 or "auto" (= the capacity profile\'s slots; the brain VM serves 3-5 server slots)');
  if (!/lockstepFront\(list, held \|\| \[\], inReview, cap, forClaim && held && !opt\('--issue'\) \? pilotCap : 0\)/.test(go) || !/heldWorkRefs\(inReview\)/.test(go) || !/heldRefs\(nodes, inReview, STALE_H\)/.test(go)) bad.push('go.mjs queue() does not feed lockstepFront the held branches and the pilot cap');
  if (!/ActiveProcessorCount/.test(server) || !/const args = \[\.\.\.cpuCap,/.test(server)) bad.push('referee/server.mjs starts the JVM without -XX:ActiveProcessorCount (a slot is 2 cores)');
  return bad;
};
const REAL = { front: lockstepFront, held: heldRefs, go: GO, roles: ROLES, server: SERVER };
const BREAKS = [
  ['pilot cap ignored', { front: (l, r, ir, c) => lockstepFront(l, r, ir, c, 0) }],
  ['leads only pilotCap but hides nothing', { front: (l, r, ir, c, p) => lockstepFront(l, r, ir, Math.min(c, p), 0) }],
  ['every ref counts as busy (released branches)', { held: (n, ir) => n.map((x) => 'work/' + x.name) }],
  ['age ignored', { held: (n, ir, s, now) => heldRefs(n, ir, 1e9, now) }],
  ['released counts as held', { held: (n, ir, s, now) => heldRefs(n.map((x) => ({ ...x, target: { ...x.target, message: 'wip' } })), ir, s, now) }],
  ['bounced branch stays busy', { held: (n, ir, s, now) => heldRefs(n, none, s, now) }],
  ['review counts as busy', { front: (l, r, ir, c, p) => lockstepFront(l, r, none, c, p) }],
  ['roles.json cap gone', { roles: ROLES.replace('"lockstepPilotCap": "mirror"', '"lockstepPilotCap": 0') }],
  ['roles.json cap above the slots', { roles: ROLES.replace('"lockstepPilotCap": "mirror"', '"lockstepPilotCap": 10') }],
  ['go.mjs drops the cap', { go: GO.replace('forClaim && held && !opt(\'--issue\') ? pilotCap : 0', '0') }],
  ['the cap also hides issues from status / claimable', { go: GO.replace('forClaim && held', 'held') }],
  ['go.mjs reads every ref, not the held ones', { go: GO.replace('heldRefs(nodes, inReview, STALE_H)', 'nodes') }],
  ['server JVM uncapped', { server: SERVER.replace('const args = [...cpuCap,', 'const args = [') }],
];
const bad0 = verdict(REAL); let caught = 0;
for (const [n, over] of BREAKS) { if (verdict({ ...REAL, ...over }).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of bad0) console.log(' FAIL:', x);
console.log(`lockstepcapcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(bad0.length || caught < BREAKS.length ? 1 : 0);
