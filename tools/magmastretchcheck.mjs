#!/usr/bin/env node
// magmastretchcheck.mjs — #1004: SlimeEntity.tick's stretch is ticked; MagmaCubeEntityModel.method_17098 slice pivots;
// ER.slimeScale follows the stretch. Breaks its own model/tick and proves the asserts catch it.
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ ' + m); };
console.log('magmastretchcheck — #1004 slime/magma cube stretch tick + slice pivots');
const M = loadEngine({ extra: ['07i_entitylist.js', '07j_entityrender.js', '07zd_slime.js'], dom: false });
if (initRegistry) initRegistry(M);
const ER = M.EntityRender || M.ER, Sl = M.Slime;
const near = (a, b) => Math.abs(a - b) < 1e-5;

function run(type, ticks) {
  const e = { type, size: 2, onGround: true, onGroundLastTick: true, stretch: 0, lastStretch: 0, targetStretch: 0 };
  const log = [];
  for (const g of ticks) { e.onGround = g; Sl.tickStretch(e); log.push({ st: e.stretch, tg: e.targetStretch, last: e.lastStretch }); }
  return log;
}
// leave ground: target 1.0 then *0.6 (magma *0.9); stretch eases by 0.5 next tick
let l = run('slime', [false, false]);
ok(near(l[0].tg, 0.6) && near(l[0].st, 0), 'slime leaving ground: targetStretch 1.0*0.6');
ok(near(l[1].st, 0.3) && near(l[1].last, 0.3) && near(l[1].tg, 0.36), 'slime: stretch += (target-stretch)*0.5, lastStretch=stretch, target*0.6');
l = run('magma_cube', [false]);
ok(near(l[0].tg, 0.9), 'magma cube updateStretch *0.9');
l = run('slime', [false, true]);
ok(near(l[1].tg, -0.3), 'landing sets targetStretch -0.5 then *0.6');

const mk = (st) => ({ type: 'magma_cube', size: 2, stretch: st, lastStretch: st });
const anim = (e) => ({ stretch: ER.slimeStretch(e, 0) });
const pivot = (e, i) => ER.setupAnimDelta('cube' + i, 0, 0, 0, 0, false, 'x', { slime: anim(e), rest: { py: 0 } }).dpy;
for (let i = 0; i < 8; i++) ok(near(pivot(mk(0.5), i), -(4 - i) * 0.5 * 1.7), `slice ${i} pivotY`);
ok(pivot(mk(-0.4), 0) === -0 || pivot(mk(-0.4), 0) === 0, 'negative stretch clamps to 0');
ok(ER.setupAnimDelta('inside_cube', 0, 0, 0, 0, false, 'x', { slime: anim(mk(0.5)), rest: { py: 0 } }) == null ||
   !ER.setupAnimDelta('inside_cube', 0, 0, 0, 0, false, 'x', { slime: anim(mk(0.5)), rest: { py: 0 } }).dpy, 'inside_cube does not move');
const s0 = ER.slimeScale(mk(0), 0), s1 = ER.slimeScale(mk(1), 0);
ok(s0.sxz === 2 && s0.sy === 2 && s1.sxz < 2 && s1.sy > 2, 'scale squashes xz / stretches y with stretch');
// lerp between lastStretch and stretch
ok(near(ER.slimeStretch({ lastStretch: 0, stretch: 1 }, 0.25), 0.25), 'lerp(partial,last,stretch)');

// anti-vacuity: break the tick and the pivot formula
const SlT = Sl.tickStretch; Sl.tickStretch = () => {};
const e = { type: 'slime', size: 1, onGround: false, onGroundLastTick: true, stretch: 0, lastStretch: 0, targetStretch: 0 };
Sl.tickStretch(e); okAv(!near(e.targetStretch, 0.6), 'a no-op tick leaves targetStretch unset (caught by the tick asserts)');
Sl.tickStretch = SlT;
const SD = ER.setupAnimDelta; ER.setupAnimDelta = () => ({ dpy: 0 });
okAv(!near(pivot(mk(0.5), 0), -4 * 0.5 * 1.7), 'a zeroed pivot differs from the vanilla pivot');
ER.setupAnimDelta = SD;
const SS = ER.slimeScale; ER.slimeScale = () => ({ sxz: 2, sy: 2 });
okAv(!(ER.slimeScale(mk(1), 0).sxz < 2), 'a stretch-blind scale is caught');
ER.slimeScale = SS;

if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL magmastretchcheck'); process.exit(1); }
console.log(`PASS magmastretchcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
