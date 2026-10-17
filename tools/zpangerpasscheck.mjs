#!/usr/bin/env node
// zpangerpasscheck.mjs (#1219) -- ZombifiedPiglinEntity.tickAngerPassing / angerNearbyZombifiedPiglins
// (.decomp ZombifiedPiglinEntity.java:125-147) against Ai.ZombifiedPiglinAngerPassingGoal.
import { loadEngine, initRegistry } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07k_goals.js'], dom: false });
initRegistry(MCL);
const Ai = MCL.Ai;
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const ent = (x, z) => ({ type: 'zombified_piglin', x, y: 64, z, followRange: 35, target: null });
const run = (a, others, ticks, opts = {}) => {
  const g = new Ai.ZombifiedPiglinAngerPassingGoal(a, opts.rand || (() => 0), () => others);
  g.start();
  for (let i = 0; i < ticks; i++) g.tick();
  return g;
};
const victim = { type: 'player', x: 0, y: 64, z: 0 };
const ranges = () => [Ai.ZP_ANGER_PASSING_MIN, Ai.ZP_ANGER_PASSING_MAX];
ok(ranges()[0] === 80 && ranges()[1] === 120, 'cooldown is betweenSeconds(4,6) = 80..120 ticks');

// B inside follow range (20 < 35) but outside the hit-time alert: recruited within 6 s (120 ticks)
{ const a = ent(0, 0), b = ent(20, 0); a.target = victim;
  run(a, [b], 79); ok(b.target === null, 'not alerted before the 80-tick cooldown');
  run(a, [b], 122, { rand: () => 0.999 }); ok(b.target === victim, 'piglin 20 blocks away is recruited within 6 s'); }
// out of followRange stays calm; one with its own target keeps it; y gap > 10 stays calm
{ const a = ent(0, 0), far = ent(40, 0), busy = ent(5, 0), hi = ent(5, 0); busy.target = { type: 'x' }; hi.y = 80; a.target = victim;
  run(a, [far, busy, hi], 300);
  ok(far.target === null, 'out of followRange: not alerted');
  ok(busy.target !== victim, 'a piglin that already has a target is not retargeted');
  ok(hi.target === null, '|dy|>10: not alerted'); }
// bounding-box overlap with Box.from(pos).expand(fr,10,fr): +-0.3 beyond fr in x/z, up to height below, <10 above
{ const a = ent(0, 0), inX = ent(35.2, 0), outX = ent(35.4, 0), below = ent(5, 0), belowOut = ent(5, 0), above = ent(5, 0), aboveOut = ent(5, 0);
  inX.height = 1.95; below.y = 64 - 11.5; belowOut.y = 64 - 12; above.y = 64 + 9.9; aboveOut.y = 64 + 10; a.target = victim;
  run(a, [inX, outX, below, belowOut, above, aboveOut], 300);
  ok(inX.target === victim, 'dx=fr+0.2 overlaps by half-width: alerted');
  ok(outX.target === null, 'dx=fr+0.4: not alerted');
  ok(below.target === victim, '11.5 below: box top reaches into range, alerted');
  ok(belowOut.target === null, '12 below: not alerted');
  ok(above.target === victim, '9.9 above: alerted');
  ok(aboveOut.target === null, '10 above: not alerted (strict)'); }
// no target -> nothing; unseen target -> nothing
{ const a = ent(0, 0), b = ent(5, 0); run(a, [b], 300); ok(b.target === null, 'no target: no passing'); }
{ const a = ent(0, 0), b = ent(5, 0); a.target = victim; const old = Ai.canSee; Ai.canSee = () => false;
  run(a, [b], 300); Ai.canSee = old; ok(b.target === null, 'target not visible: no passing'); }
// anti-vacuity: break the data and see it fail
okAv((() => { const a = ent(0, 0), b = ent(20, 0); a.target = victim; const old = Ai.canSee; Ai.canSee = () => false;
  run(a, [b], 300); Ai.canSee = old; return b.target === null; })(), 'with canSee broken the recruit does not happen (check can fail)');
okAv((() => { const a = ent(0, 0), b = ent(20, 0); a.target = victim; run(a, [b], 10); return b.target === null; })(), 'before the cooldown the recruit does not happen');
okAv((() => { const a = ent(0, 0), b = ent(20, 0); a.target = victim; run(a, [b], 300); return b.target === victim; })(), 'the positive case really recruits');
console.log('================ zpangerpasscheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(`PASS zpangerpasscheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
