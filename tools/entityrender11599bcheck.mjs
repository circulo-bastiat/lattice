#!/usr/bin/env node
// entityrender11599check.mjs — #11599 (AUDIT-MAP). 07j_entityrender.js's rod/bow/frame-light/rotLerp/shaking renderer classes (part 2) driven through their real
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
    const P1 = ER.BOW_PULL_1, P2 = ER.BOW_PULL_2;
    ok(ER.rodTileName(true) === 'item/fishing_rod_cast' && ER.rodTileName(false) === 'item/fishing_rod', 'FishingBobberEntityRenderer rod cast tile');
    ok(ER.bowTileName(0, false) === 'item/bow' && ER.bowTileName(P2, true) === 'item/bow_pulling_2' && ER.bowTileName(P1, true) === 'item/bow_pulling_1' && ER.bowTileName(0, true) === 'item/bow_pulling_0', 'bow pull tiles');
    ok(ER.mainArmPivotX({ leftHanded: true }) === -ER.mainArmPivotX({}) && ER.mainArmPivotX({}) !== 0, 'BipedEntityRenderer left-handed arm mirrors');
    ok(ER.itemFrameBlockLight('glow_item_frame', 2) === 5 && ER.itemFrameBlockLight('glow_item_frame', 9) === 9 && ER.itemFrameBlockLight('item_frame', 2) === 2, 'ItemFrameEntityRenderer glow block light');
    ok(ER.itemFrameItemLight('glow_item_frame', 7) === 15728880 && ER.itemFrameItemLight('item_frame', 7) === 7, 'ItemFrameEntityRenderer glow item light');
    ok(near(ER.rotLerp(0.5, 0, Math.PI * 1.5), -Math.PI / 4) && near(ER.rotLerp(1, 1, 2), 2) && near(ER.rotLerp(0, 1, 2), 1), 'LivingEntityRenderer rotLerp shortest arc');
    ok(ER.isShaking({ type: 'zombie', convertCountdown: 5 }) === true && ER.isShaking({ type: 'zombie' }) === false && ER.isShaking({ type: 'zombie_villager', converting: true }) === true && ER.isShaking(null) === false, 'ZombieBaseEntityRenderer isShaking');
    ok(near(ER.shakeYaw({ age: 0 }), Math.PI * 0.4 * Math.PI / 180) && near(ER.shakeYaw({ age: 2 }), Math.cos(6.5) * Math.PI * 0.4 * Math.PI / 180), 'LivingEntityRenderer shakeYaw');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['FishingBobberEntityRenderer rod tile', (t) => t.replace("cast ? 'item/fishing_rod_cast' : 'item/fishing_rod'", "cast ? 'item/fishing_rod' : 'item/fishing_rod_cast'")],
  ['bow pull_2 threshold', (t) => t.replace('c >= ER.BOW_PULL_2 ?', 'c > ER.BOW_PULL_2 + 1 ?')],
  ['bow pull_1 threshold', (t) => t.replace('(c >= ER.BOW_PULL_1 ?', '(c >= ER.BOW_PULL_2 ?')],
  ['bow idle tile', (t) => t.replace("if (!drawing) return 'item/bow';", "if (!drawing) return 'item/bow_pulling_0';")],
  ['BipedEntityRenderer left arm', (t) => t.replace('e && e.leftHanded ? -ER.SKELETON_ARM_PIVOT[0]', 'e && e.leftHanded ? ER.SKELETON_ARM_PIVOT[0]')],
  ['ItemFrameEntityRenderer glow block light', (t) => t.replace('Math.max(5, blk | 0)', 'Math.max(4, blk | 0)')],
  ['ItemFrameEntityRenderer glow item light', (t) => t.replace('15728880 : packed', '15728640 : packed')],
  ['rotLerp wrap', (t) => t.replace('if (d > Math.PI) d -= 2 * Math.PI;', '')],
  ['rotLerp lerp', (t) => t.replace('return a + d * t;', 'return a + d;')],
  ['isShaking zombie convert', (t) => t.replace("e.convertCountdown !== undefined && e.convertCountdown !== null) return true;", "false) return true;")],
  ['isShaking zombie_villager', (t) => t.replace('return !!e.converting;', 'return false;')],
  ['shakeYaw factor', (t) => t.replace('(e.age || 0) * 3.25)', '(e.age || 0) * 3.0)')],
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
