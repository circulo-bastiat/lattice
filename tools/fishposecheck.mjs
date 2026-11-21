#!/usr/bin/env node
// fishposecheck.mjs — #1761: Cod/Salmon/TropicalFishEntityRenderer.setupTransforms against .decomp.
import { loadEngine } from './loadsrc.mjs';
const ER = loadEngine({ extra: ['07j_entityrender.js'], dom: false }).EntityRender;
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const P = (type, inWater, age) => ER.fishPoseOf({ type, inWater, age: age || 0 }, 0).pose;
// age 0: no wobble. In water: identity. Dry: Rz(90) (R*(1,0,0) = (0,1,0)) + the renderer's translate.
const w0 = P('tropical_fish', true, 0);
ok([1,0,0,0,1,0,0,0,1].every((v, i) => near(w0.R[i], v)) && w0.t.every(near.bind(null, 0)), 'in water, age 0: identity');
const d0 = P('tropical_fish', false, 0);
ok(near(d0.R[3], 1) && near(d0.R[1], -1) && near(d0.t[0], 0.2) && near(d0.t[1], 0.1) && near(d0.t[2], 0), 'tropical dry: Rz(90), translate(.2,.1,0)');
const c0 = P('cod', false, 0);
ok(near(c0.t[0], 0.1) && near(c0.t[1], 0.1) && near(c0.t[2], -0.1), 'cod dry: translate(.1,.1,-.1)');
ok(near(P('salmon', true, 0).t[2], -0.4), 'salmon wet: translate(0,0,-.4)');
const s0 = P('salmon', false, 0);
ok(near(s0.t[0], 0.2) && near(s0.t[1], 0.1) && near(s0.t[2], -0.4), 'salmon dry: -0.4 z plus (.2,.1,0)');
// wobble 4.3*sin(0.6*age) degrees about Y
const a = 3, th = 4.3 * Math.sin(0.6 * a) * Math.PI / 180, w = P('tropical_fish', true, a);
ok(near(w.R[0], Math.cos(th)) && near(Math.abs(w.R[2]), Math.sin(th)), 'wobble 4.3*sin(0.6*age) about Y');
const sw = P('salmon', false, a), sth = 1.3 * 4.3 * Math.sin(1.7 * 0.6 * a) * Math.PI / 180;
ok(near(-sw.R[1], Math.cos(sth)), 'salmon dry wobble 1.3*4.3*sin(1.7*.6*age)');
ok(ER.fishPoseOf({ type: 'pufferfish', inWater: true, age: 0 }, 0) === null, 'pufferfish: no pose');
okAv(!near(d0.R[1], w0.R[1]), 'dry differs from wet');
okAv(!near(w.R[2], 0), 'wobble is nonzero at age 3');
okAv(!near(c0.t[0], d0.t[0]), 'cod translate differs from tropical');
{ const sv = ER.fishPoseOf; ER.fishPoseOf = () => ({ pose: w0 }); okAv(near(P('cod', false, 0).R[1], 0), 'stub removes lying pose'); ER.fishPoseOf = sv; }
console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity probes included, ${breaks} breaks caught)`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
console.log('fishposecheck: ALL GREEN');
