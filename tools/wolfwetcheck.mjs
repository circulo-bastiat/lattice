#!/usr/bin/env node
// wolfwetcheck.mjs — #955: WolfEntityModel's shake roll (real_head/neck/torso/real_tail via getShakeAnimationProgress offsets
// 0/-0.08/-0.16/-0.2) and WolfEntityRenderer's wet-fur colour multiplier are wired into the wolf pose.
//   node tools/wolfwetcheck.mjs
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07h_entities.js', '07zq2_wolfshake.js', '07j_entityrender.js'], dom: false });
if (initRegistry) initRegistry(M);
const ER = M.EntityRender, WS = M.WolfShake;
function run(ws) {
  const f = [];
  const e = { type: 'wolf', furWet: true, shakeProgress: 0.8, lastShakeProgress: 0.75, age: 1 };
  const a = ER.wolfAnim(e, 0.5);
  const want = { headRoll: 0, neckRoll: -0.08, bodyRoll: -0.16, tailRoll: -0.2 };
  for (const k in want) {
    const exp = ws.shakeAnimation(e, 0.5, want[k]);
    if (!near(a[k], exp)) f.push(`${k} ${a[k]} != ${exp}`);
  }
  if (!(Math.abs(a.neckRoll) > 1e-3)) f.push('shake roll is zero mid-shake');
  const dry = ER.wolfAnim({ type: 'wolf', furWet: false, shakeProgress: 0.8, lastShakeProgress: 0.75, age: 1 }, 0.5);
  if (dry.neckRoll !== 0 || dry.tailRoll !== 0) f.push('dry wolf must not roll');
  const t = ER.wolfWetTint(e, 0.5), b = ws.wetBrightness(e, 0.5);
  if (!t || !near(t[0], b) || !(b < 1)) f.push('wet tint = wetBrightness (<1): ' + t);
  if (ER.wolfWetTint({ type: 'wolf', furWet: false }, 0.5) !== null) f.push('dry wolf has no tint');
  if (ER.wolfWetTint({ type: 'cow', furWet: true }, 0.5) !== null) f.push('non-wolf has no tint');
  return f;
}
const f0 = run(WS); ok(f0.length === 0, 'wet wolf: ' + f0.join('; '));
// anti-vacuity: break the shake function / brightness and the check must fail
const broke = [
  { shakeAnimation: () => 0, wetBrightness: WS.wetBrightness },
  { shakeAnimation: WS.shakeAnimation, wetBrightness: () => 1 },
];
const real = { s: WS.shakeAnimation, w: WS.wetBrightness };
for (const b of broke) {
  M.WolfShake = Object.assign({}, b);
  const f = run(b);   // wolfAnim reads NS.WolfShake, so the swap is live
  breaks++; ok(f.length > 0, 'anti-vacuity: broken WolfShake not caught');
}
M.WolfShake = WS;
for (const f of fails) console.log('   ✗ ' + f);
console.log(`wolfwetcheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
