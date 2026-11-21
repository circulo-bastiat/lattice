#!/usr/bin/env node
// fireballdrawcheck — #3806: FireballEntityRenderer = FlyingItemEntityRenderer(scale 3 ghast / 0.75 small, lit),
// fire_charge in GROUND mode (display scale 0.5). Proves the type->item, scale and billboard-facing math.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07h_entities.js', '07i_entitylist.js', '07j_entityrender.js'], initReg: false });
const ER = M.EntityRender;
let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const brk = (c, m) => { if (c) caught++; else fails.push('break not caught: ' + m); };
const scaleOf = (m) => Math.hypot(m[0], m[1], m[2]);
const facing = (t, dx, dz) => { const m = ER.fireballMatrix(t, dx, dz); return [m[2] / scaleOf(m), m[8] / scaleOf(m)]; };

ok(ER.SHAPE.fireball === 'fireball' && ER.SHAPE.small_fireball === 'fireball', 'both fireballs have the fireball shape');
ok(ER.THROWN_ITEM_NAME.fireball === 'fire_charge' && ER.THROWN_ITEM_NAME.small_fireball === 'fire_charge', 'item is fire_charge');
for (const [t, s] of [['fireball', 3], ['small_fireball', 0.75]]) ok(Math.abs(scaleOf(ER.fireballMatrix(t, 0, 1)) - 0.5 * s) < 1e-9, t + ' scale');
// the sprite normal (+z column) points back at the camera, which is at -(dx,dz) from the entity
for (const [dx, dz] of [[0, 5], [5, 0], [-3, -4], [3, -4]]) {
  const n = Math.hypot(dx, dz), f = facing('fireball', dx, dz);
  ok(Math.abs(f[0] + dx / n) < 1e-9 && Math.abs(f[1] + dz / n) < 1e-9, `faces camera at (${dx},${dz})`);
}
// look-down camera (#6435): the quad is a full camera-facing basis, so its extent perpendicular to the view ray is the full 1.5
{ const m = ER.fireballMatrix('fireball', 0, 1, -5), L = Math.hypot(1, 5), n = [0, 5 / L, -1 / L];   // camera above: d = entity - cam = (0,-5,1)
  ok(Math.abs(m[2] - 0) < 1e-9 && Math.abs(m[5] / 1.5 - n[1]) < 1e-9 && Math.abs(m[8] / 1.5 - n[2]) < 1e-9, 'look-down normal faces camera');
  ok(Math.abs(Math.hypot(m[1], m[4], m[7]) - 1.5) < 1e-9 && Math.abs(m[1] * m[2] + m[4] * m[5] + m[7] * m[8]) < 1e-9, 'look-down up axis full length, perpendicular to view');
  ok(Math.abs(Math.hypot(...m.lift) - 0.375) < 1e-9, 'ground display lift (2/16 * 3)');
  const yawOnly = ER.fireballMatrix('fireball', 0, 1, 0);
  brk(Math.abs(Math.hypot(m[1], m[4], m[7]) - 1.5) < 1e-9 && Math.abs(yawOnly[1] * yawOnly[2] + yawOnly[4] * yawOnly[5] + yawOnly[7] * yawOnly[8]) < 1e-9 && Math.abs(yawOnly[5] / 1.5 - n[1]) > 0.1, 'yaw-only billboard would be caught (normal ignores pitch)');
}
// wither_skull: scale(-1,-1,1) only (no 1.501 lift); charged skull uses wither_invulnerable.png
ok(ER.basePoseFor('wither_skull') === ER.BASE_MIRROR, 'wither_skull base pose is mirror-only');
ok(ER.witherSkinKey({ type: 'wither_skull', charged: true }) === 'wither_invulnerable' && ER.witherSkinKey({ type: 'wither_skull' }) === null, 'charged skull texture');
ok(ER.basePoseFor('dragon_fireball') === ER.BASE_MIRROR && ER.RENDER_SCALE.dragon_fireball === 2 && ER.fullBrightBlockLight({ type: 'dragon_fireball' }), 'dragon_fireball: mirror pose, scale 2, full bright');
ok(ER.fullBrightBlockLight({ type: 'wither_skull' }), 'wither_skull full bright (#4899)');
// anti-vacuity: break each fact, the same asserts must fail
brk(!ER.fullBrightBlockLight({ type: 'zombie' }), 'wither_skull light: a non-bright type fails the assertion');
{ const s = ER.FIREBALL_SCALE.fireball; ER.FIREBALL_SCALE.fireball = 1; brk(Math.abs(scaleOf(ER.fireballMatrix('fireball', 0, 1)) - 1.5) > 1e-9, 'scale'); ER.FIREBALL_SCALE.fireball = s; }
{ const f = facing('fireball', 0, 5); brk(!(Math.abs(f[1] - 1) < 1e-9), 'flipped facing would be caught'); }
{ const n = ER.THROWN_ITEM_NAME.fireball; ER.THROWN_ITEM_NAME.fireball = 'snowball'; brk(ER.THROWN_ITEM_NAME.fireball !== 'fire_charge', 'item'); ER.THROWN_ITEM_NAME.fireball = n; }
{ const k = ER.MIRROR_ONLY.wither_skull; delete ER.MIRROR_ONLY.wither_skull; brk(ER.basePoseFor('wither_skull') !== ER.BASE_MIRROR, 'mirror pose'); ER.MIRROR_ONLY.wither_skull = k; }
brk(ER.witherSkinKey({ type: 'wither_skull', charged: false }) !== 'wither_invulnerable', 'charged texture');
{ const k = ER.RENDER_SCALE.dragon_fireball; ER.RENDER_SCALE.dragon_fireball = 1; brk(ER.RENDER_SCALE.dragon_fireball !== 2, 'dragon scale'); ER.RENDER_SCALE.dragon_fireball = k; }
if (fails.length) { console.log('fireballdrawcheck: FAIL'); fails.forEach(f => console.log('  x ' + f)); process.exit(1); }
console.log(`${pass} assertions, ${caught} breaks caught`);
