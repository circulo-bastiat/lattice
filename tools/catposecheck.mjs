#!/usr/bin/env node
// catposecheck.mjs — #1317: CatEntityModel sitting / sleeping / head-down poses, tail curl, and
// CatEntityRenderer.setupTransforms' lie-down, against .decomp CatEntityModel/CatEntity/CatEntityRenderer.
import { loadEngine } from './loadsrc.mjs';

const MCL = loadEngine({ extra: ['07j_entityrender.js', '07i_entitylist.js', '07zp_turtle.js', '14j_combat.js'], dom: false });
const ER = MCL.EntityRender;
let EL, Cb;
const P = Math.PI;
let pass = 0; const fails = []; let breaks = 0;
const near = (a, b) => Math.abs(a - b) < 1e-5;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const parts = ['head', 'body', 'tail1', 'tail2', 'left_hind_leg', 'right_hind_leg', 'left_front_leg', 'right_front_leg'];
const pose = (f, n, l = 0, a = 0) => ER.felineDelta(n, l, a, Object.assign({ crouch: false, sprint: false }, f));

// 1. standing is unchanged (rest + walk)
ok(near(pose({}, 'body').rx, 0) && near(pose({}, 'tail1').rx, 0), 'standing body/tail1 at rest');

// 2. sitting (CatEntityModel.animateModel): body PI/4 (delta from PI/2), pivots, legs, tails
const sit = (n) => pose({ sitting: true }, n, 3, 1);   // walk swing must not apply while sitting
ok(near(sit('body').rx, P / 4 - P / 2) && sit('body').dpy === -4 && sit('body').dpz === 5, 'sitting body');
ok(near(sit('tail1').rx, 1.7278761 - 0.9) && sit('tail1').dpy === 8 && sit('tail1').dpz === -2, 'sitting tail1');
ok(near(sit('tail2').rx, 2.670354) && sit('tail2').dpy === 2 && near(sit('tail2').dpz, -0.8), 'sitting tail2');
ok(near(sit('left_front_leg').rx, -P / 20) && near(sit('left_front_leg').dpy, 2) && near(sit('left_front_leg').dpz, -2), 'sitting front leg');
ok(near(sit('right_hind_leg').rx, -P / 2) && near(sit('right_hind_leg').dpy, 3) && near(sit('right_hind_leg').dpz, -4), 'sitting hind leg');
const hd = ER.felineHead({ rx: 0.2, ry: 0.3, rz: 0 }, { sitting: true });
ok(near(hd.dpy, -3.3) && near(hd.dpz, 1) && near(hd.rx, 0.2), 'sitting head pivot');

// 3. sleeping legs / tail curl / head roll
const sl = (n, s, t) => pose({ sleep: s, tail: t }, n);
ok(near(sl('left_front_leg', 1, 0).rx, -1.2707963) && near(sl('right_front_leg', 1, 0).rz, -0.2) && near(sl('right_front_leg', 1, 0).dpx, 1.0), 'sleep front legs');
ok(near(sl('right_hind_leg', 1, 0).rx, 0.5) && near(sl('right_hind_leg', 1, 0).dpy, 2) && near(sl('right_hind_leg', 1, 0).dpx, 0.8), 'sleep right hind leg');
ok(near(sl('tail1', 1, 1).rx, 0.8 - 0.9) && near(sl('tail2', 1, 1).rx, -0.4), 'full tail curl');
ok(near(sl('tail1', 1, 0.5).rx, 0.9 + (0.8 - 0.9) * 0.5 - 0.9), 'half tail curl lerps');
ok(near(ER.felineHead({ rx: 0, ry: 0, rz: 0 }, { sleep: 1 }).rz, -1.2707963) && near(ER.felineHead({ rx: 0, ry: 0, rz: 0 }, { sleep: 1 }).ry, 1.2707963), 'sleep head roll/yaw');
ok(near(ER.felineHead({ rx: 0.1, ry: 0, rz: 0 }, { headDown: 1 }).rx, -0.58177644), 'head down pitch');

// 4. per-tick counters (+0.15/-0.22, tail +0.08/-0.13, head +0.1/-0.13) and the renderer's lie-down
const e = { type: 'cat', sleeping: true };
ER.tickCatAnim(e); ER.tickCatAnim(e);
ok(near(e.sleepAnim, 0.3) && near(e.tailCurlAnim, 0.16), 'sleep/tail ramp up');
for (let i = 0; i < 20; i++) ER.tickCatAnim(e);
ok(e.sleepAnim === 1 && e.tailCurlAnim === 1, 'ramp clamps at 1');
e.sleeping = false; ER.tickCatAnim(e);
ok(near(e.sleepAnim, 0.78) && near(e.tailCurlAnim, 0.87), 'ramp down -0.22/-0.13');
ok(near(ER.catAnim(e, 'sleepAnim', 0.5), 0.89), 'lerp(partial, prev, cur)');
e.headDown = true; ER.tickCatAnim(e);
ok(near(e.headDownAnim, 0.1), 'head-down ramp +0.1');
const cp = ER.catPoseOf({ type: 'cat', sleepAnim: 1, sleepAnimO: 1 }, 0.5);
ok(near(cp.pose.t[0], 0.4) && near(cp.pose.t[1], 0.15) && near(cp.pose.t[2], 0.1) && near(cp.pose.R[3], 1), 'lie-down translate + Rz(90)');
ok(ER.catPoseOf({ type: 'cat' }, 0) === null && ER.catPoseOf({ type: 'ocelot', sleepAnim: 1 }, 0) === null, 'no pose awake / for ocelots');

// 5. anti-vacuity: break the data, see the asserts fail
{
  const sv = ER.felineDelta;
  ER.felineDelta = (n, l, a, f) => sv(n, l, a, Object.assign({}, f, { sitting: false }));
  okAv(!near(pose({ sitting: true }, 'body').rx, P / 4 - P / 2), 'dropping the sitting branch loses the body pose');
  ER.felineDelta = sv;
  okAv(!near(pose({ sleep: 0 }, 'left_front_leg').rx, -1.2707963), 'sleep 0 does not pose the legs');
  okAv(!near(sl('tail2', 1, 0).rx, -0.4), 'tail curl 0 leaves the tail uncurled');
  const sv2 = ER.catPoseOf; ER.catPoseOf = () => null;
  okAv(ER.catPoseOf({ type: 'cat', sleepAnim: 1 }, 0) === null, 'stubbing catPoseOf removes the lie-down');
  ER.catPoseOf = sv2;
  const sv3 = ER.tickCatAnim; ER.tickCatAnim = () => {};
  const e2 = { type: 'cat', sleeping: true }; ER.tickCatAnim(e2);
  okAv(!(e2.sleepAnim > 0), 'stubbing tickCatAnim stops the ramp');
  ER.tickCatAnim = sv3;
}

// 6. #4150: a crouching cat/ocelot bypasses onSteppedOn (magma hot floor, turtle eggs)
EL = MCL.EntityList; Cb = MCL.Combat;
{
  const magma = MCL.States.stateOf('magma_block') | 0;
  MCL.World = Object.assign(MCL.World || {}, { getBlock: () => magma });
  const mk = (type, crouching) => ({ type, crouching, onGround: true, x: 0.5, y: 5, z: 0.5, width: 0.6, height: 0.7, health: 10, maxHealth: 10 });
  const hurt = (e) => { const h = []; const sv = Cb.hurt; Cb.hurt = (_e, a) => h.push(a); EL.tickHazards(e); Cb.hurt = sv; return h.length; };
  ok(hurt(mk('cat', true)) === 0 && hurt(mk('ocelot', true)) === 0, 'crouching cat/ocelot takes no magma hot-floor hit');
  okAv(hurt(mk('cat', false)) === 1, 'a standing cat still takes the magma hit');
  const sv = Cb.bypassesSteppingEffects; Cb.bypassesSteppingEffects = () => false;
  okAv(hurt(mk('cat', true)) === 1, 'dropping the gate hurts the crouching cat');
  Cb.bypassesSteppingEffects = sv;
  ok(MCL.Turtle.eggSteppedOn(mk('cat', true), 0, 0, 0) === false, 'crouching cat does not trample eggs');
}

console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity probes included, ${breaks} breaks caught)`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
console.log('catposecheck: ALL GREEN');
