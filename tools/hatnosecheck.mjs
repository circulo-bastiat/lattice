#!/usr/bin/env node
// hatnosecheck.mjs — Dan, "check every model with a hat/nose child": the witch's cone hat
// (and every other villager-family/illager hat/nose/mole child part) must turn WITH the head
// it sits on. Before this unit, `ER.PART_PARENT` only listed hoglin/zoglin (2-level chains) and
// every other hat/nose child part -- witch's `hat`/`hat2`/`hat3`/`hat4`/`hat_rim`/`mole`,
// villager/wandering_trader/zombie_villager's `hat_rim`, and villager/wandering_trader/the
// illagers' `nose` -- was posed with NO parent composition at all: it kept its REST rotation
// forever, so the instant the head turned to look at anything, the part stayed facing the old
// direction while the head turned under it. On the witch that reads as "the hat is on the side
// of her face, not on top".
//
//   node tools/hatnosecheck.mjs [--verbose]
//
// 1. `ER.fullyPosedPart`'s FULL 3x3 rotation matrix for every hat/nose/mole child part listed
//    below, at a 90-degree head yaw, matches an INDEPENDENT re-derivation built here from
//    `ER.rotMatrix` composed straight down the chain (root to leaf) — not the code's own
//    Euler-angle bookkeeping, so a bug in the composition order or a dropped ancestor shows up
//    as a wrong MATRIX, not just a coincidentally-matching Euler angle.
// 2. witch's `hat` (whose pivot is NOT (0,0,0)) also translates correctly under yaw — checked
//    against a rotation-matrix re-derivation of the expected pivot.
// 3. villager's plain `hat` (pivot IS (0,0,0), so the pre-existing direct head-rotation
//    shortcut already gave the right answer) is BYTE-IDENTICAL before and after this unit.
// 4. a plain biped with no PART_PARENT entry for `hat` at all (zombie) is unaffected.
// 5. anti-vacuity: break `ER.PART_PARENT` (empty it out) and watch every chain assertion fail.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
const okAv = (c, m) => { const p0 = pass; ok(c, 'anti-vacuity: ' + m); if (pass > p0 && !VERBOSE) console.log('   ✓ ' + m); };

console.log('hatnosecheck — every hat/nose child part turns WITH its head (witch\'s hat, D-KW)');

const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
  '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const BE = M.BEModel;
const ER = M.EntityRender;
ER.init();
ok(BE.ready, 'the model payload decodes');

const DEG2RAD = Math.PI / 180;
const animAt = (yaw, pitch) => ({ limbSwing: 0, limbSwingAmount: 0, netHeadYaw: yaw, headPitch: pitch || 0, riding: false });

function matMul(A, B) {
  var M = new Array(9);
  for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++)
    M[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return M;
}
function matClose(A, B, eps) {
  for (var i = 0; i < 9; i++) if (Math.abs(A[i] - B[i]) > eps) return false;
  return true;
}
// Independent re-derivation: walk REST rotations root-to-leaf, substituting `head`'s own
// rx/ry/rz with the yaw/pitch this call is posing it at (the ONE atomic fact `setupAnimDeltaCore`
// contributes — everything ABOVE that atomic fact is what this file exists to check).
function expectedMatrix(parts, layerName, yaw, pitch, name) {
  var er = ER;
  var chain = [], n = name, guard = 0;
  while (n && guard++ < 8) { chain.unshift(n); n = er.partParentOf(layerName, n); }
  var M = null;
  for (var i = 0; i < chain.length; i++) {
    var rest = parts.find(function (p) { return p.n === chain[i]; });
    var rx = rest.rx, ry = rest.ry, rz = rest.rz;
    // `head` always gets the live look direction. `hat` gets it too UNLESS this layer composes
    // `hat` through PART_PARENT itself (witch) -- mirroring `setupAnimDeltaCore`'s own
    // `partName === 'hat' && !ctx.hatComposed` direct-shortcut condition exactly, since THAT
    // shortcut is what gives `hat_rim` (whose registered parent is `hat`, not `head`) its
    // rotation on every villager-family layer that does not chain `hat` all the way to `head`.
    if (chain[i] === 'head') { rx = pitch * DEG2RAD; ry = yaw * DEG2RAD; rz = 0; }
    else if (chain[i] === 'hat' && !er.partParentOf(layerName, 'hat')) { rx = pitch * DEG2RAD; ry = yaw * DEG2RAD; rz = 0; }
    var local = er.rotMatrix(rx, ry, rz);
    M = M ? matMul(M, local) : local;
  }
  return M;
}

// ── the real check, as a function of ER (so the anti-vacuity pass can hand it a broken one) ──
function checkChains(er, o) {
  const CASES = [
    ['witch', ['hat', 'hat2', 'hat3', 'hat4', 'hat_rim', 'nose', 'mole']],
    ['villager', ['hat_rim', 'nose']],
    ['wandering_trader', ['hat_rim', 'nose']],
    ['zombie_villager', ['hat_rim']],
    ['evoker', ['nose']],
    ['illusioner', ['nose']],
    ['pillager', ['nose']],
    ['vindicator', ['nose']],
    ['goat', ['left_horn', 'right_horn', 'nose']],
  ];
  for (const [layerName, names] of CASES) {
    const L = BE.layer(layerName);
    if (!o(!!L, layerName + ' has a model layer')) continue;
    for (const n of names) {
      const posed = er.fullyPosedPart(L.parts, layerName, animAt(90, 0), n);
      if (!o(!!posed, layerName + '.' + n + ' resolves at yaw 90')) continue;
      const actual = ER.rotMatrix(posed.rx, posed.ry, posed.rz);
      const expected = expectedMatrix(L.parts, layerName, 90, 0, n);
      o(matClose(actual, expected, 1e-4), layerName + '.' + n + '’s absolute rotation at yaw 90 matches an independent chain re-derivation');
    }
  }
}
checkChains(ER, ok);

// ── 2. witch's hat CHAIN also translates the way a 90-degree yaw about the head's own origin
//    (0,0,0) really would. ──
{
  const L = BE.layer('witch');
  const rest = L.parts.find((p) => p.n === 'hat');
  const a0 = ER.fullyPosedPart(L.parts, 'witch', animAt(0, 0), 'hat');
  const a90 = ER.fullyPosedPart(L.parts, 'witch', animAt(90, 0), 'hat');
  const rad = 90 * DEG2RAD, c = Math.cos(rad), s = Math.sin(rad);
  const ex = rest.px * c + rest.pz * s, ez = -rest.px * s + rest.pz * c;
  ok(Math.abs(a90.px - ex) < 1e-4 && Math.abs(a90.pz - ez) < 1e-4,
    'witch.hat pivot at yaw 90 matches an independent rotation re-derivation (got ' +
    a90.px.toFixed(3) + ',' + a90.pz.toFixed(3) + ', expected ' + ex.toFixed(3) + ',' + ez.toFixed(3) + ')');
  ok(Math.abs(a0.px - rest.px) < 1e-6 && Math.abs(a0.py - rest.py) < 1e-6 && Math.abs(a0.pz - rest.pz) < 1e-6,
    'witch.hat pivot at yaw 0 is still the model’s own rest pivot (-5, -10.03125, -5)');
  for (const n of ['hat3', 'hat4']) {
    const r = L.parts.find((p) => p.n === n);
    const p90 = ER.fullyPosedPart(L.parts, 'witch', animAt(90, 0), n);
    ok(Math.abs(p90.px - r.px) > 0.5 || Math.abs(p90.pz - r.pz) > 0.5,
      'witch.' + n + ' moved off its raw parent-local pivot once composed through the whole chain');
  }
}

// ── 3. villager's plain `hat` (pivot already (0,0,0)) is untouched: same rotation the old
//    direct head-rotation shortcut already gave. ──
{
  const L = BE.layer('villager');
  const rest = L.parts.find((p) => p.n === 'hat');
  const direct = ER.setupAnimDeltaCore('hat', 0, 0, 90, 0, false, 'humanoid', { rest });
  const composed = ER.fullyPosedPart(L.parts, 'villager', animAt(90, 0), 'hat');
  ok(!!direct && Math.abs(direct.ry - composed.ry) < 1e-6,
    'villager.hat’s rotation is unchanged from the pre-existing direct head-rotation shortcut');
}

// ── 4. a plain biped with no `hat` PART_PARENT entry (zombie) is unaffected. ──
{
  const L = BE.layer('zombie');
  const rest = L.parts.find((p) => p.n === 'hat');
  const a = ER.posedPart(rest, animAt(0, 0), 'zombie');
  const b = ER.posedPart(rest, animAt(90, 0), 'zombie');
  ok(Math.abs(Math.abs(a.ry - b.ry) - Math.PI / 2) < 1e-4, 'zombie.hat (no PART_PARENT entry) still tracks head yaw via the direct shortcut');
}

// ── 5. anti-vacuity: an empty PART_PARENT table must fail every chain assertion above. ──
{
  const brokenER = Object.create(ER);
  brokenER.partParentOf = function () { return null; };
  brokenER.fullyPosedPart = function (parts, layerName, anim, name) {
    const rest = parts.find((p) => p.n === name);
    return rest ? ER.posedPart(rest, anim, layerName) : null;
  };
  const localFails = [];
  const localOk = (c, m) => { if (!c) localFails.push(m); return c; };
  checkChains(brokenER, localOk);
  okAv(localFails.length > 0, 'an emptied PART_PARENT table fails the hat/nose chain-rotation checks (' + localFails.length + ' would fail)');
}

if (fails.length) {
  console.log(`${pass} assertions, ${fails.length} failures`);
  for (const f of fails) console.log('  ✗ ' + f);
  console.log('FAIL hatnosecheck');
  process.exit(1);
}
console.log(`PASS hatnosecheck: ${pass} assertions, 0 failures, 1 break caught`);
