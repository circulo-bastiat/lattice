#!/usr/bin/env node
// entityrender11599check.mjs — #11599 (AUDIT-MAP). 07j_entityrender.js's renderer classes driven through their real
// entry points (ER.shouldRender / ER.stateOf / ER.renderAmount / ER.itemLift / ER.itemSpin / ER.arrowYaw / ER.arrowPitch /
// ER.arrowMatrix / ER.fireballMatrix), then re-run against source mutants that cut each one: every cut must be noticed.
//   EntityRenderer + EntityRenderDispatcher (shouldRender)   FallingBlockEntityRenderer / TntEntityRenderer (stateOf)
//   ItemEntityRenderer (renderAmount, bob, spin)             ArrowEntityRenderer / SpectralArrowEntityRenderer (yaw, pitch, matrix)
//   DragonFireballEntityRenderer (fireballMatrix, FIREBALL_SCALE)
import { loadEngine, initRegistry } from './loadsrc.mjs';

const near = (a, b) => Math.abs(a - b) < 1e-9;
let N = 0;
function run(patch) {
  const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js'], dom: false,
    ...(patch ? { patch: (f, t) => (f === '07j_entityrender.js' ? patch(t) : t) } : {}) });
  initRegistry(M);
  const ER = M.EntityRender, f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    ER.init();
    // EntityRenderer / EntityRenderDispatcher.shouldRender: avg side (w+h+w)/3 * 64 * mult, squared
    const cow = { width: 0.9, height: 1.4 }, d = (0.9 + 1.4 + 0.9) / 3 * 64;
    ok(ER.shouldRender(cow, d * d - 1) && !ER.shouldRender(cow, d * d + 1), 'EntityRenderer.shouldRender boundary');
    ER.renderDistanceMultiplier = 2;
    ok(ER.shouldRender(cow, d * d * 2) && !ER.shouldRender(cow, d * d * 4 + 1), 'EntityRenderer.shouldRender distance scaling');
    ER.renderDistanceMultiplier = 1;
    ok(ER.shouldRender({}, 1e12) === true, 'EntityRenderer.shouldRender sizeless always drawn');
    ok(ER.shouldRender({ width: NaN, height: 1 }, 63 * 63) && !ER.shouldRender({ width: NaN, height: 1 }, 65 * 65), 'EntityRenderer.shouldRender NaN size = 1');
    // Falling block / TNT
    const stone = M.States.stateOf('stone');
    ok(ER.stateOf({ type: 'falling_block', state: stone }) === stone, 'FallingBlockEntityRenderer draws its own state');
    ok(ER.stateOf({ type: 'falling_block' }) === 0, 'FallingBlockEntityRenderer without state draws nothing');
    ok(ER.stateOf({ type: 'falling_block', state: stone, removed: true }) === 0, 'removed entity draws nothing');
    ok(ER.stateOf({ type: 'tnt' }) === M.States.stateOf('tnt') && ER.stateOf({ type: 'tnt' }) > 0, 'TntEntityRenderer draws tnt');
    // ItemEntityRenderer
    const ra = [0, 1, 2, 16, 17, 32, 33, 48, 49, 64].map((n) => ER.renderAmount(n)).join();
    ok(ra === '1,1,2,2,3,3,4,4,5,5', 'ItemEntityRenderer.getRenderedAmount steps: ' + ra);
    ok(near(ER.itemLift(0, 0, 0), 0.1 + 0.25 * ER.GROUND.scale + ER.GROUND.ty), 'ItemEntityRenderer bob at age 0');
    ok(near(ER.itemLift(10, 0, 0.5), Math.sin(1.5) * 0.1 + 0.1 + 0.25 * ER.GROUND.scale + ER.GROUND.ty), 'ItemEntityRenderer bob uses age/10 + bobOffs');
    ok(near(ER.itemSpin(40, 0.5, 1), 40.5 / 20 + 1), 'ItemEntityRenderer spin = (age+pt)/20 + bobOffs');
    // Arrow / SpectralArrow
    ok(near(ER.arrowYaw({ vx: 1, vz: 0 }), Math.PI / 2) && near(ER.arrowYaw({ vx: 0, vz: -1 }), 0), 'ArrowEntityRenderer yaw from velocity');
    ok(ER.arrowYaw({ vx: 0, vz: 0, yaw: 0.7 }) === 0.7, 'ArrowEntityRenderer idle arrow keeps entity yaw');
    ok(ER.arrowYaw({ stuck: true, stuckYaw: 2, vx: 1, vz: 0 }) === 2, 'ArrowEntityRenderer stuck arrow uses frozen yaw');
    ok(near(ER.arrowPitch({ vx: 1, vy: 2, vz: 0 }), Math.atan2(2, 1)) && ER.arrowPitch({}) === 0, 'ArrowEntityRenderer pitch from velocity');
    ok(ER.arrowPitch({ stuck: true, stuckPitch: -0.3, vy: 5 }) === -0.3, 'ArrowEntityRenderer stuck pitch');
    const I = ER.arrowMatrix(0, 0, 2);
    ok(I.join() === '2,0,0,0,2,0,0,0,2', 'ArrowEntityRenderer.arrowMatrix identity scaled: ' + I);
    const Y = ER.arrowMatrix(Math.PI / 2, 0, 1);
    ok(near(Y[2], 1) && near(Y[6], -1) && near(Y[0], 0), 'ArrowEntityRenderer.arrowMatrix yaw 90');
    const P = ER.arrowMatrix(0, Math.PI / 2, 1);
    ok(near(P[5], -1) && near(P[7], 1) && near(P[4], 0), 'SpectralArrowEntityRenderer shares the pitch matrix');
    ok(ER.SHAPE.arrow === 'arrow' && ER.SHAPE.spectral_arrow === 'arrow', 'SpectralArrowEntityRenderer shape = arrow');
    // DragonFireballEntityRenderer / fireball billboard
    ok(ER.FIREBALL_SCALE.fireball === 3 && ER.FIREBALL_SCALE.small_fireball === 0.75, 'fireball scales (3 / 0.75)');
    const F = ER.fireballMatrix('fireball', 0, 4, 0);   // camera 4 blocks away on +z: faces it
    ok(near(Math.abs(F[0]), 1.5) && near(F[8], -1.5) , 'DragonFireballEntityRenderer basis scale 0.5*3: ' + F);
    const Fs = ER.fireballMatrix('small_fireball', 0, 4, 0);
    ok(near(Math.abs(Fs[0]), 0.375), 'small fireball scale 0.5*0.75');
    ok(near(Math.hypot(F.lift[0], F.lift[1], F.lift[2]), 0.375), 'fireball ground lift 2/16*scale');
    const Fv = ER.fireballMatrix('fireball', 0, 0, 3);   // straight above: no horizontal heading, falls back to r=(1,0,0)
    ok(near(Fv[0], 1.5), 'fireball straight-down fallback basis');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['EntityRenderer.shouldRender 64', (t) => t.replace('d *= 64 * ER.renderDistanceMultiplier;', 'd *= 32 * ER.renderDistanceMultiplier;')],
  ['EntityRenderer.shouldRender mult', (t) => t.replace('d *= 64 * ER.renderDistanceMultiplier;', 'd *= 64;')],
  ['EntityRenderer.shouldRender NaN', (t) => t.replace('if (d !== d) d = 1;', '')],
  ['FallingBlockEntityRenderer state', (t) => t.replace('return e.state | 0;', 'return e.state | 1;')],
  ['TntEntityRenderer state', (t) => t.replace("ER.tntState = NS.States.stateOf('tnt') | 0", "ER.tntState = 0").replace("NS.States.stateOf('tnt') | 0;", '0;')],
  ['ItemEntityRenderer amount step', (t) => t.replace('if (n > st[1]) return 4;', 'if (n > st[1]) return 3;')],
  ['ItemEntityRenderer bob amp', (t) => t.replace('ER.BOB_AMP = 0.1', 'ER.BOB_AMP = 0.2')],
  ['ItemEntityRenderer spin period', (t) => t.replace('ER.SPIN_PERIOD = 20', 'ER.SPIN_PERIOD = 10')],
  ['ItemEntityRenderer bob period', (t) => t.replace('ER.BOB_PERIOD = 10', 'ER.BOB_PERIOD = 20')],
  ['ArrowEntityRenderer yaw', (t) => t.replace('Math.atan2(vx, -vz)', 'Math.atan2(vx, vz)')],
  ['ArrowEntityRenderer stuck yaw', (t) => t.replace('if (e.stuck && e.stuckYaw !== undefined) return e.stuckYaw;', '')],
  ['ArrowEntityRenderer pitch', (t) => t.replace('Math.atan2(vy, h)', 'Math.atan2(h, vy)')],
  ['ArrowEntityRenderer matrix', (t) => t.replace('-sp * cy * scale', 'sp * cy * scale')],
  ['SpectralArrowEntityRenderer shape', (t) => t.replace(/spectral_arrow: 'arrow'/, "spectral_arrow: 'item'")],
  ['DragonFireballEntityRenderer scale', (t) => t.replace('small_fireball: 0.75', 'small_fireball: 1')],
  ['DragonFireballEntityRenderer lift', (t) => t.replace('ER.FIREBALL_SCALE[type], uy * 0.125', 'ER.FIREBALL_SCALE[type], uy * 0.25')],
  ['DragonFireballEntityRenderer basis', (t) => t.replace('if (h < 1e-9) { rx = 1; rz = 0; }', 'if (h < 1e-9) { rx = 0; rz = 1; }')],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
