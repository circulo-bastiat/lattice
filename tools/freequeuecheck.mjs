// tools/freequeuecheck.mjs - #5116 (11 Oct): `go.mjs status` counted 9 claimable while two workers found nothing (issues with a running work/ branch or a PR
// in review were counted), so the commander's thin-queue test never fired. isHeld is the ONE rule claim() and the queue count share. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { isHeld } from './infra/heldnow.mjs';
const GO = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
const verdict = (held, go) => {
  const bad = [];
  if (!held({ age: 0.5, message: 'work: step' }, 3)) bad.push('a branch committed 0.5 h ago is held');
  if (held({ age: 4, message: 'work: step' }, 3)) bad.push('a branch stale for 4 h is free for takeover');
  if (held({ age: 0.5, message: 'handoff: released' }, 3)) bad.push('a released hand-off is free at once');
  if (held({ age: 0.5, message: 'work', bouncedFree: true }, 3)) bad.push('a bounced PR branch is free');
  if (!/if \(isHeld\(\{ age, message: head\.commit\.message, bouncedFree \}, STALE_H\)\) return null;/.test(go)) bad.push('claim() does not use isHeld');
  if (!/async function claimable\(\) \{ console\.log\(\(await freeQueue\(/.test(go)) bad.push('go.mjs claimable (what the brain reads) does not use freeQueue');
  if (!/const fq = await freeQueue\(/.test(go) || !/held by a running branch or in review/.test(go)) bad.push('status does not print the free count with the held count');
  if (!/if \(q\.inReview\.has\(ref\)\) taken = true;/.test(go)) bad.push('freeQueue counts an issue whose PR is in review as free');
  return bad;
};
const BREAKS = [
  ['held ignores age', () => (h) => true, GO],
  ['stale still held', () => (h, s) => h.age < 99 && !/^handoff: released/.test(h.message) && !h.bouncedFree, GO],
  ['released counted as held', () => (h, s) => h.age < s && !h.bouncedFree, GO],
  ['bounced counted as held', () => (h, s) => h.age < s && !/^handoff: released/.test(h.message), GO],
  ['claim not using isHeld', () => isHeld, GO.replace('if (isHeld({ age, message: head.commit.message, bouncedFree }, STALE_H)) return null;', 'if (age < STALE_H) return null;')],
  ['claimable uses realQueue', () => isHeld, GO.replace('(await freeQueue(await queue())).free.length', 'realQueue((await queue()).list).length')],
  ['in review counted free', () => isHeld, GO.replace('if (q.inReview.has(ref)) taken = true;', '')],
];
const real = verdict(isHeld, GO); let caught = 0;
for (const [n, mk, go] of BREAKS) { if (verdict(mk(), go).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`freequeuecheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
