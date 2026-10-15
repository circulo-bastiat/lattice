#!/usr/bin/env node
// lockstep-noai -- #7062 (G17-L210): a NoAI mob (cow, zombie, skeleton) in the chase lane never moves toward / targets / attacks the player,
// takes a hit mid-run (knockback + gravity still run: Mob.serverAiStep gated on isNoAi, LivingEntity.travel is not), 20 salts.
// Server rep0 comparison is the pilot's job; here: engine trace invariants, determinism, tampered rows caught, and the fault (goal tick ignoring aiDisabled) caught.
import { engineZombieTrace, harnessM } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const HIT = 80;
const F = ['pos', 'yaw', 'target', 'attackTicks', 'health', 'vel', 'onGround'];
const run = (salt, mob) => engineZombieTrace(salt, { mob, noAI: true, onTick: (t, EL) => {
  if (t !== HIT) return;
  const e = EL.list.find((x) => x.type === mob), M = harnessM();
  M.Combat.hurt(e, 1, 0, null, null);
  e.vx += 0.4; e.vy += 0.36;   // the knockback the hit imparts (LivingEntity.takeKnockback) on a mob that is still travelling
} });
const SALTS = Array.from({ length: 20 }, (_, i) => i);
let first = null;
for (const mob of ['cow', 'zombie', 'skeleton']) {
  for (const s of SALTS) {
    const R = run(s, mob);
    if (!first) first = R;
    ok(R.length === T, `${mob} salt ${s}: ${R.length} rows`);
    ok(R.every((r) => r.target === null && r.attackTicks === 0), `${mob} salt ${s}: targeted or attacked`);
    ok(R.slice(0, HIT).every((r) => r.pos[0] === 11.5 && r.pos[2] === 0.5), `${mob} salt ${s}: moved before the hit`);
    ok(R[HIT + 2].pos[0] > 11.5, `${mob} salt ${s}: no knockback`);
    ok(R[HIT + 2].pos[1] > R[0].pos[1] + 0.1 && R[T - 1].onGround && R[T - 1].pos[1] < 0.01, `${mob} salt ${s}: gravity did not land it`);
  }
}
const z0 = run(0, 'zombie');
ok(compareTraces(z0, run(0, 'zombie'), { fields: F }) === null, 'same salt, same trace');
caught(compareTraces(z0, engineZombieTrace(0, { mob: 'zombie' }), { fields: F }) !== null, 'AI-on zombie differs (fault: goal tick ignoring aiDisabled is reported)');
const mut = (f, fn) => z0.map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(z0, mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(z0, mut('health', (h) => h - 1), { fields: F })?.field === 'health', 'health');
console.log(`${SALTS.length * 15 + 2} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
