// tools/lockstepprioritycheck.mjs - 11 Oct (Dan: "divert any two of the workers to the lockstep"): go.mjs queue() puts lockstep issues first for the next (cap - busy) claims.
// Pure rules in infra/phaselane.mjs (isLockstep, lockstepFront) + the wiring in go.mjs and roles.json. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { isLockstep, lockstepFront } from './infra/phaselane.mjs';
const GO = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8'), ROLES = readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8');
const I = (n, title, labels = []) => ({ number: n, title, labels: labels.map((name) => ({ name })) });
const L = [I(1, 'bug a'), I(2, 'G17-L3b: lockstep pilot cow'), I(3, 'G17-L3c: lockstep pilot zombie'), I(4, 'bug b'), I(5, 'G17-L4 lockstep unit wolf'), I(6, 'lockstep umbrella', ['tracking']), I(7, 'lockstep blocked', ['blocked'])];
const ids = (l) => l.map((i) => i.number).join(',');
const verdict = (front, isL, go, roles) => {
  const bad = [], none = new Set();
  if (!isL(L[1]) || isL(L[0]) || isL(L[5]) || isL(L[6])) bad.push('isLockstep: titles with lockstep only, never tracking/blocked');
  if (ids(front(L, [], none, 2)) !== '2,3,1,4,5,6,7') bad.push('nothing busy: the first two lockstep issues lead, the rest keep their order: ' + ids(front(L, [], none, 2)));
  if (ids(front(L, ['work/2-g17-l3b'], none, 2)) !== '3,1,2,4,5,6,7') bad.push('one busy: only one more leads (the busy one is not moved): ' + ids(front(L, ['work/2-g17-l3b'], none, 2)));
  if (ids(front(L, ['work/2-x', 'work/3-y'], none, 2)) !== '1,2,3,4,5,6,7') bad.push('two busy: nothing leads, order untouched');
  if (ids(front(L, ['work/2-x', 'work/3-y'], new Set(['work/2-x', 'work/3-y']), 2)) !== '5,1,2,3,4,6,7') bad.push('branches waiting in review are not busy and do not take a pilot slot (#7975): a free lockstep issue still leads');
  if (ids(front(L, [], none, 0)) !== ids(L)) bad.push('cap 0 turns it off');
  if (!/lockstepFront\(list, held \|\| \[\]/.test(go) || !/list\.some\(isLockstep\)/.test(go)) bad.push('go.mjs queue() does not apply lockstepFront');
  const lw = /"lockstepWorkers": (\d+)/.exec(roles), mt = /"maxTotal": (\d+)/.exec(roles);
  if (!lw || !mt || lw[1] !== mt[1]) bad.push('roles.json fill.lockstepWorkers must equal fill.maxTotal (#5973: all work lockstep-first)');
  return bad;
};
const BREAKS = [
  ['no cap', () => (l, r, ir, c) => lockstepFront(l, r, ir, 99), isLockstep, GO, ROLES],
  ['busy ignored', () => (l, r, ir, c) => lockstepFront(l, [], ir, c), isLockstep, GO, ROLES],
  ['review counts as busy', () => (l, r, ir, c) => lockstepFront(l, r, new Set(), c), isLockstep, GO, ROLES],
  ['nothing leads', () => (l) => l, isLockstep, GO, ROLES],
  ['blocked lockstep leads', () => lockstepFront, (i) => /lockstep/i.test(i.title), GO, ROLES],
  ['go.mjs never calls it', () => lockstepFront, isLockstep, GO.replace('lockstepFront(list, held || []', 'noop(list, held || []'), ROLES],
  ['roles.json cap gone', () => lockstepFront, isLockstep, GO, ROLES.replace('"lockstepWorkers": 10', '"lockstepWorkers": 0')],
  ['cap dropped below maxTotal', () => lockstepFront, isLockstep, GO, ROLES.replace('"lockstepWorkers": 10', '"lockstepWorkers": 2')],
];
const real = verdict(lockstepFront, isLockstep, GO, ROLES); let caught = 0;
for (const [n, mk, isL, go, roles] of BREAKS) { if (verdict(mk(), isL, go, roles).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`lockstepprioritycheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
