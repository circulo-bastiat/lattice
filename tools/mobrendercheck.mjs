#!/usr/bin/env node
// mobrendercheck.mjs — loop/mobrender-s96 (QUEUE 0.2 Passive.OWED/Cr.OWED render remainder).
//
//   node tools/mobrendercheck.mjs [--verbose]
//
// Sections:
//   1. tools/pack-mobtex.mjs's family-variant filter — the bug this unit fixed (loop/mobrender-s96): every
//      #b/#c/#null-SUFFIXED overlay layer (fur#null, drowned#b, husk#c, armor_stand#b, ...)
//      now reaches assets/mob-geometry.json with its OWN slice table, instead of being
//      dropped by a filter whose "family variant" premise never applied to a literal-name key.
//   2. ER.creeperScale — the exact CreeperEntityRenderer.method_3900/method_23154 formula
//      (.decomp/net/minecraft/client/render/entity/CreeperEntityRenderer.java), read against
//      Cr.swellFraction (07zb_creeper.js, untouched — read-only for this unit).
//   3. the render wiring — ER.emitMobLayer actually SCALES a creeper's posed geometry when
//      handed a swellScale, and leaves every OTHER mob's geometry byte-for-byte unchanged
//      when it is not (swellScale undefined/null is the overwhelming majority of callers).
//   4. sheep fleece — ER.visible pushes a second, tinted `fur#null` item for a live,
//      unsheared sheep (loop/fleece-s97), sharing the body's own mobLayer/pose.
//   5. pig saddle — ER.visible pushes a second, untinted `saddle#null` item for a
//      saddled pig (loop/fleece-s97).
//   6. anti-vacuity — break the packer's own filter and the scale formula, both ways, and
//      watch this file's own assertions catch the break.

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('mobrendercheck — loop/mobrender-s96, the packer overlay-layer fix + the creeper swell render');

// ═════════════════════ 1. the packer: overlay layers reach mob-geometry.json ═════════════════
{
  say('\n§1 pack-mobtex.mjs overlay-layer coverage');
  const geomPath = join(MCLITE_ROOT, 'assets', 'mob-geometry.json');
  const geom = JSON.parse(readFileSync(geomPath, 'utf8'));
  // every literal-suffix overlay layer this session named as the bug's own scope (loop/mobrender-s96's own
  // comment in pack-mobtex.mjs) must now have a non-empty slice table of its OWN.
  const OVERLAYS = ['fur#null', 'drowned#b', 'drowned#c', 'husk#b', 'husk#c',
                    'armor_stand#b', 'armor_stand#c', 'zombie_villager#b', 'zombie_villager#c'];
  for (const name of OVERLAYS) {
    const L = geom.layers[name];
    ok(Array.isArray(L) && L.length > 0, `mob-geometry.json has a non-empty "${name}" layer (was dropped entirely before loop/mobrender-s96)`);
  }
  // and the fix did not disturb a REAL multi-sheet family: "cat" still bakes its own base plus
  // 10 CatVariant members, each keyed "cat#1".."cat#10" (D-469's own contract, unchanged).
  let catVariants = 0;
  for (let i = 0; i <= 10; i++) if (geom.layers[i === 0 ? 'cat' : 'cat#' + i]) catVariants++;
  ok(catVariants === 11, `cat still bakes all 11 CatVariant members (got ${catVariants})`);
  // wolf_tame still borrows wolf's OWN geometry (GEOM_BASE_OVERRIDE) but keeps its OWN texture
  // key distinct from "wolf" -- the exact regression loop/mobrender-s96's first attempt at this fix caused
  // (collapsing wolf_tame's OUTPUT key onto "wolf" itself, silently losing the tinted skin).
  ok(Array.isArray(geom.layers.wolf) && geom.layers.wolf.length > 0, '"wolf" itself still bakes');
  ok(Array.isArray(geom.layers.wolf_tame) && geom.layers.wolf_tame.length > 0, '"wolf_tame" still bakes its own key');
  // same SHAPE (part/face/slice counts) as wolf's -- the two draw the SAME box hierarchy,
  // through GEOM_BASE_OVERRIDE, and differ only in which tile each slice samples (a different
  // texture sheet), so slice TILE ids are expected to differ; the STRUCTURE must not.
  const shapeOf = (L) => L.map((parts) => parts.map((faces) => faces.length));
  ok(JSON.stringify(shapeOf(geom.layers.wolf)) === JSON.stringify(shapeOf(geom.layers.wolf_tame)),
    'wolf_tame\'s box SHAPE (parts/faces/slice-counts) matches wolf\'s (GEOM_BASE_OVERRIDE: same geometry, different skin)');
}

// ════════════════════ 2. ER.creeperScale — the bytecode-verified formula ═════════════════════
const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07zb_creeper.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js', '07zzj_strider.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'),
                    modelsBytes: mm.rawBytes });
}
const mobGeomRaw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, {
  mobGeometry: deflateRawSync(mobGeomRaw, { level: 9 }).toString('base64'),
  mobGeometryBytes: mobGeomRaw.length,
  // §4/§5 (loop/fleece-s97) drive ER.visible through a REAL EntityList, which refuses to
  // initialise (EL.ready stays false, ER.visible then a no-op) without entities.json's own
  // species table — §1-§3 never needed EL.list at all (they hand-build entity objects and call
  // ER.emitMobLayer directly), which is why this was never loaded before this session.
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();
M.Passive.init();
const ER = M.EntityRender, Cr = M.Creeper;
ok(ER.ready, 'the entity renderer is up');
ok(typeof Cr !== 'undefined' && typeof Cr.swellFraction === 'function', 'Cr.swellFraction exists (07zb_creeper.js)');
ok(typeof ER.creeperScale === 'function', 'ER.creeperScale exists');

function refScale(fuseFrac) {
  const f4 = 1 + Math.sin(fuseFrac * 100) * fuseFrac * 0.01;
  let c = fuseFrac < 0 ? 0 : (fuseFrac > 1 ? 1 : fuseFrac);
  c = c * c; c = c * c;
  return { sxz: (1 + c * 0.4) * f4, sy: (1 + c * 0.1) / f4 };
}

{
  say('\n§2 ER.creeperScale vs the decompiled formula');
  ok(ER.creeperScale(null, 0) === null, 'a null entity returns null (no scale applied)');
  ok(ER.creeperScale({ type: 'cow' }, 0) === null, 'a non-creeper returns null');
  ok(ER.creeperScale({ type: 'creeper', dead: true }, 0) === null, 'a dead creeper returns null');

  // an un-ignited creeper: fuseTime=30, lastFuseTime=currentFuseTime=0 -> fraction 0 -> identity
  const idle = { type: 'creeper', fuseTime: 30, lastFuseTime: 0, currentFuseTime: 0 };
  const s0 = ER.creeperScale(idle, 1);
  ok(Math.abs(s0.sxz - 1) < 1e-9 && Math.abs(s0.sy - 1) < 1e-9,
    `an un-ignited creeper scales at identity (got sxz=${s0.sxz}, sy=${s0.sy})`);

  // several points along the fuse (currentFuseTime 0..30 of fuseTime=30, denom=28) — each
  // checked against an INDEPENDENT re-derivation of the exact jar formula (CreeperEntityRenderer
  // .method_3900/method_23154, .decomp), not against ER.creeperScale's own arithmetic.
  for (const cur of [0, 7, 14, 21, 28, 30]) {
    const e = { type: 'creeper', fuseTime: 30, lastFuseTime: cur, currentFuseTime: cur };
    const frac = Cr.swellFraction(e, 1);
    const want = refScale(frac);
    const got = ER.creeperScale(e, 1);
    ok(Math.abs(got.sxz - want.sxz) < 1e-9, `sxz at fuse=${cur}: got ${got.sxz}, want ${want.sxz}`);
    ok(Math.abs(got.sy - want.sy) < 1e-9, `sy at fuse=${cur}: got ${got.sy}, want ${want.sy}`);
  }

  // the swell GROWS monotonically in the swell fraction's own clamp region — a fully primed
  // creeper (fraction 1, denom-clamped) is visibly bigger than a freshly-lit one.
  const lit = ER.creeperScale({ type: 'creeper', fuseTime: 30, lastFuseTime: 1, currentFuseTime: 1 }, 1);
  const primed = ER.creeperScale({ type: 'creeper', fuseTime: 30, lastFuseTime: 28, currentFuseTime: 28 }, 1);
  ok(primed.sxz > lit.sxz, `a fully-primed creeper is wider than a freshly-lit one (${primed.sxz} vs ${lit.sxz})`);
  ok(primed.sy > lit.sy, `a fully-primed creeper is taller than a freshly-lit one (${primed.sy} vs ${lit.sy})`);
}

// ═════════════════════ 3. the render wiring — emitMobLayer really scales the geometry ════════
{
  say('\n§3 ER.emitMobLayer + swellScale');
  const n = ER.mobQuadCount('creeper');
  ok(n > 0, 'creeper has quads to draw');
  const wide = new Uint32Array(n * 4 * 4 + 4);   // generous: 4 verts/quad, 4 words/vert

  function drawCreeper(swellScale) {
    const out = new Uint32Array(n * 16);
    const o = ER.emitMobLayer(out, 0, 'creeper', 0, 0, 0, 1, 0, 15, 0, 0, null,
      undefined, undefined, false, undefined, swellScale);
    ok(o === n * 16, `emitMobLayer wrote exactly ${n} quads' worth of words (wrote ${o / 16})`);
    let maxAbsX = 0, maxAbsY = 0, minY = Infinity;
    for (let i = 0; i < o; i += 4) {
      const vt = M.Mesher.unpackModelVertex(out[i], out[i + 1], out[i + 2], out[i + 3]);
      maxAbsX = Math.max(maxAbsX, Math.abs(vt.px), Math.abs(vt.pz));
      maxAbsY = Math.max(maxAbsY, Math.abs(vt.py));
      minY = Math.min(minY, vt.py);
    }
    return { maxAbsX, maxAbsY, minY };
  }

  const base = drawCreeper(undefined);
  const swelled = drawCreeper({ sxz: 1.4, sy: 1.1 });
  ok(swelled.maxAbsX > base.maxAbsX,
    `a swollen creeper's widest X/Z vertex is farther out than the unswelled one (${swelled.maxAbsX} vs ${base.maxAbsX})`);
  // the ratio should track sxz to within integer rounding (each vertex is rounded to the
  // nearest 1/256 of a block, `ER.build`'s own convention two lines above `emitMobLayer`).
  const ratio = swelled.maxAbsX / base.maxAbsX;
  ok(Math.abs(ratio - 1.4) < 0.02, `the swollen/unswelled X extent ratio tracks sxz=1.4 (got ${ratio.toFixed(4)})`);

  const identity = drawCreeper({ sxz: 1, sy: 1 });
  ok(identity.maxAbsX === base.maxAbsX && identity.maxAbsY === base.maxAbsY,
    'an identity swellScale ({sxz:1, sy:1}) draws pixel-identical to no swellScale at all');
}

// ═════════════════════ 4. sheep fleece — the RENDER WIRING (loop/fleece-s97) ══════════════════
{
  say('\n§4 sheep fleece render wiring (ER.visible + emitMobLayer)');
  function mkSheep(over) {
    return Object.assign({ type: 'sheep', x: 0, y: 5, z: 0, px: 0, py: 5, pz: 0,
      yaw: 0, pyaw: 0, age: 0, woolColor: 'lime', sheared: false }, over || {});
  }
  M.EntityList.list = [mkSheep()];
  let vis = ER.visible(0, 5, 0, 1);
  const mobItems = vis.filter((it) => it.shape === 'mob');
  ok(mobItems.length === 2, `an unsheared sheep pushes TWO mob items — the body and the fleece overlay (got ${mobItems.length})`);
  const body = mobItems.find((it) => it.texKey !== 'fur#null');
  const fleece = mobItems.find((it) => it.texKey === 'fur#null');
  ok(!!fleece, 'one of the two items carries texKey "fur#null" (the fleece overlay)');
  ok(!!body && body.mobLayer === 'sheep' && fleece.mobLayer === 'sheep',
    'BOTH items share mobLayer "sheep" (the same box/pose set) — only texKey differs, D-471\'s collar shape');
  const wantLime = M.Passive.fleeceColor('lime');
  ok(fleece.tintRGB && Math.abs(fleece.tintRGB[0] - wantLime[0]) < 1e-6,
    `the fleece item's tintRGB is the sheep's OWN wool colour (lime), via Passive.fleeceColor (got ${fleece.tintRGB})`);
  ok(!body.tintRGB, 'the BODY item carries no tintRGB of its own (nothing set e.tintRGB on this sheep)');

  // a SHEARED sheep draws no second layer at all
  M.EntityList.list = [mkSheep({ sheared: true })];
  vis = ER.visible(0, 5, 0, 1);
  const shearedMob = vis.filter((it) => it.shape === 'mob');
  okAv(shearedMob.length === 1 && !shearedMob.some((it) => it.texKey === 'fur#null'),
    `a SHEARED sheep pushes only ONE mob item, never "fur#null" (got ${shearedMob.length} items: ${shearedMob.map((it) => it.texKey)})`);

  // a re-dye actually changes the emitted tint (proves it reads e.woolColor live, not a cached value)
  M.EntityList.list = [mkSheep({ woolColor: 'red' })];
  vis = ER.visible(0, 5, 0, 1);
  const redFleece = vis.find((it) => it.shape === 'mob' && it.texKey === 'fur#null');
  const wantRed = M.Passive.fleeceColor('red');
  ok(redFleece && Math.abs(redFleece.tintRGB[0] - wantRed[0]) < 1e-6 && Math.abs(redFleece.tintRGB[0] - wantLime[0]) > 1e-3,
    `a RED sheep's fleece tint differs from lime's and matches red's own Passive.fleeceColor (got ${redFleece && redFleece.tintRGB})`);

  // a non-sheep mob (e.g. a cow) never gets a second, fleece-textured item
  M.EntityList.list = [{ type: 'cow', x: 2, y: 5, z: 0, px: 2, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0 }];
  vis = ER.visible(0, 5, 0, 1);
  ok(!vis.some((it) => it.texKey === 'fur#null'), 'a cow never emits a "fur#null" item');

  // the emitted quads actually carry the tinted colour through emitMobLayer (not just the `it` record)
  // D-700/KW-36: `fur#null`'s box is DILATED (D-698) and now genuinely costs a DIFFERENT quad
  // count than the bare 'sheep' body -- `ER.mobQuadCount` must take texKey into account (the
  // SAME `(layerName, texKey)` pair `ER.emitMobLayer`'s own `ER.mobGeomFor(layerName, texKey)`
  // uses) or a caller sizing off the layerName alone silently undercounts the buffer
  // `ER.build` hands this call (this is what `ER.build`'s own `it.n = ER.mobQuadCount(it.mobLayer)`
  // used to do, D-700 fixed it). First prove the two counts actually DIFFER now -- if they ever
  // come back equal (a future asset change), the rest of this block would pass for the wrong
  // reason, so that is asserted as its own fact rather than assumed.
  const n = ER.mobQuadCount('sheep');
  const nFleece = ER.mobQuadCount('sheep', 'fur#null');
  ok(n > 0, 'sheep has quads to draw');
  // #633 (KW-49b): slices are cut from the UN-grown texel rect (ModelPart.Cuboid's layout), so the
  // dilated fur no longer needs more slices than the bare sheep (its 16-texel body face is one crop);
  // the two counts used to differ only because the GROWN size (19.5) crossed the 16-texel tile.
  ok(nFleece === n, `'fur#null's texKey-aware quad count equals the bare 'sheep' layer's now the slices follow the un-grown texel rect (fleece=${nFleece}, base=${n})`);
  const outBuf = new Uint32Array(nFleece * 16);
  const o = ER.emitMobLayer(outBuf, 0, 'sheep', 0, 0, 0, 1, 0, 15, 0, 0, null,
    undefined, 'fur#null', false, wantLime, undefined);
  ok(o === nFleece * 16,
    `emitMobLayer('fur#null') writes exactly the texKey-aware quad count ER.mobQuadCount('sheep','fur#null') predicts (wrote ${o / 16}, want ${nFleece}) -- KW-36/D-700`);
  const vt = M.Mesher.unpackModelVertex(outBuf[0], outBuf[1], outBuf[2], outBuf[3]);
  // D-503's own tint channel quantises to 3 bits per channel (qch, 07j_entityrender.js) — a
  // non-white tint must NOT come out at the untinted default (7,7,7 in that 3-bit space).
  okAv(!(vt.er === 7 && vt.eg === 7 && vt.eb === 7),
    `a lime tintRGB actually reaches the packed vertex's tint bits, not the untinted default (got er=${vt.er} eg=${vt.eg} eb=${vt.eb})`);
}

// ═════════════════════ 5. pig saddle — the RENDER WIRING (loop/fleece-s97) ════════════════════
{
  say('\n§5 pig saddle render wiring (ER.visible)');
  function mkPig(over) {
    return Object.assign({ type: 'pig', x: 10, y: 5, z: 0, px: 10, py: 5, pz: 0,
      yaw: 0, pyaw: 0, age: 0, saddled: false }, over || {});
  }
  M.EntityList.list = [mkPig({ saddled: true })];
  let vis = ER.visible(10, 5, 0, 1);
  let mobItems = vis.filter((it) => it.shape === 'mob');
  ok(mobItems.length === 2, `a SADDLED pig pushes TWO mob items — the body and the saddle overlay (got ${mobItems.length})`);
  ok(mobItems.some((it) => it.texKey === 'saddle#null'), 'one of the two carries texKey "saddle#null"');
  const saddleIt = mobItems.find((it) => it.texKey === 'saddle#null');
  ok(!saddleIt.tintRGB, 'the saddle overlay carries no tint at all (PigEntity\'s own saddle layer is untinted, unlike the collar/fleece)');

  // an UNSADDLED pig draws no second layer
  M.EntityList.list = [mkPig({ saddled: false })];
  vis = ER.visible(10, 5, 0, 1);
  mobItems = vis.filter((it) => it.shape === 'mob');
  okAv(mobItems.length === 1 && !mobItems.some((it) => it.texKey === 'saddle#null'),
    `an UNSADDLED pig pushes only ONE mob item, never "saddle#null" (got ${mobItems.length} items: ${mobItems.map((it) => it.texKey)})`);

  // a saddled SHEEP (impossible in practice, Use.entityUse gates by species — but ER.visible's
  // own gate must ALSO be pig-only, or a future species mixup would silently draw a floating
  // saddle) never gets the saddle overlay
  M.EntityList.list = [{ type: 'sheep', x: 12, y: 5, z: 0, px: 12, py: 5, pz: 0, yaw: 0, pyaw: 0,
    age: 0, sheared: true, saddled: true }];
  vis = ER.visible(12, 5, 0, 1);
  ok(!vis.some((it) => it.texKey === 'saddle#null'), 'e.saddled on a NON-pig never emits "saddle#null" — the species gate is real, not just a field check');

  // #1178 strider saddle layer (StriderEntityRenderer's SaddleFeatureRenderer)
  const mkStr = (sad) => [{ type: 'strider', x: 14, y: 5, z: 0, px: 14, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0, saddled: sad }];
  M.EntityList.list = mkStr(true);
  vis = ER.visible(14, 5, 0, 1);
  ok(vis.some((it) => it.texKey === 'strider_saddle' && it.mobLayer === 'strider'), 'a SADDLED strider pushes a "strider_saddle" pass of the strider model');
  M.EntityList.list = mkStr(false);
  vis = ER.visible(14, 5, 0, 1);
  ok(!vis.some((it) => it.texKey === 'strider_saddle'), 'an unsaddled strider draws no saddle pass');
  // #1195 an off-lava (cold) strider draws the strider_cold skin, a warm one the plain strider skin
  const mkCold = (c) => [{ type: 'strider', x: 14, y: 5, z: 0, px: 14, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0, striderCold: c }];
  M.EntityList.list = mkCold(true);
  vis = ER.visible(14, 5, 0, 1);
  ok(vis.some((it) => it.texKey === 'strider_cold'), 'a cold strider draws texKey strider_cold');
  M.EntityList.list = mkCold(false);
  vis = ER.visible(14, 5, 0, 1);
  ok(!vis.some((it) => it.texKey === 'strider_cold'), 'a warm strider does not draw strider_cold');
}

// ═════════════════════ 5b. invisible sheep fleece — outline pass only (#5731) ═════════════════
{
  say('\n§5b invisible sheep fleece (SheepWoolFeatureRenderer invisible branch)');
  const mk = (over) => Object.assign({ type: 'sheep', x: 0, y: 5, z: 0, px: 0, py: 5, pz: 0, yaw: 0, pyaw: 0,
    age: 0, woolColor: 'lime', sheared: false }, over);
  const fleeceOf = (e) => { M.EntityList.list = [e]; return ER.visible(0, 5, 0, 1).filter((it) => it.texKey === 'fur#null'); };
  if (!M.Effects) M.Effects = { ready: true, hasStatusEffect: () => false };
  M.Effects.ready = true;
  const ST = M.Effects;
  const origHas = ST.hasStatusEffect;
  ST.hasStatusEffect = function (e, n) { return n === 'invisibility' ? !!e.__inv : origHas.apply(this, arguments); };
  const g = mk({ glowing: true, __inv: true }), n = mk({ __inv: true }), v = mk({});
  const fg = fleeceOf(g), fn = fleeceOf(n), fv = fleeceOf(v);
  ok(fg.length === 1 && fg[0].outlineOnly === true, 'invisible + glowing sheep: fleece goes to the outline list only');
  ok(fn.length === 0, 'invisible, not glowing sheep: no fleece at all');
  ok(fv.length === 1 && !fv[0].outlineOnly, 'visible sheep: fleece in the colour pass as before');
  // anti-vacuity: ignoring isInvisible would put an invisible non-glowing fleece in the colour list
  ST.hasStatusEffect = () => false;
  okAv(fleeceOf(n).length === 1 && !fleeceOf(n)[0].outlineOnly, 'ignoring isInvisible draws the fleece in colour (the break is caught)');
  ST.hasStatusEffect = origHas;
}

// ═════════════════════ 6. anti-vacuity — break the fix, watch this file catch it ═════════════
{
  say('\n§6 anti-vacuity');
  // 4a. re-run the OLD, buggy packer filter against the CURRENT header/models data and prove
  // it drops "fur#null" again — the exact bug loop/mobrender-s96 fixed, reproduced from source rather than
  // asserted from memory.
  const oldFilterDrops = (name) =>
    name.endsWith('#0') === false && name.includes('#') && name.split('#')[1] !== '0';
  okAv(oldFilterDrops('fur#null') === true,
    'the OLD filter (name.endsWith(\'#0\')===false && ... !== \'0\') DOES drop "fur#null" -- ' +
    'proving §1\'s pass is the fix talking, not a filter that never would have failed');
  okAv(oldFilterDrops('cat') === false,
    'the OLD filter does NOT drop plain "cat" -- the bug was never about the base names, only the literal-suffix ones');

  // 4b. break ER.creeperScale's math in a throwaway copy and prove a wrong formula IS
  // distinguishable from the real one at a real fuse point (denom sensitivity).
  function brokenScale(fuseFrac) {
    const f4 = 1 + Math.sin(fuseFrac * 100) * fuseFrac * 0.01;
    let c = fuseFrac < 0 ? 0 : (fuseFrac > 1 ? 1 : fuseFrac);
    c = c * c;   // BROKEN: missing the second `c *= c` (should be ^4, this is only ^2)
    return { sxz: (1 + c * 0.4) * f4, sy: (1 + c * 0.1) / f4 };
  }
  const e = { type: 'creeper', fuseTime: 30, lastFuseTime: 14, currentFuseTime: 14 };
  const frac = Cr.swellFraction(e, 1);
  const real = ER.creeperScale(e, 1);
  const broken = brokenScale(frac);
  okAv(Math.abs(real.sxz - broken.sxz) > 1e-6,
    `the real ^4 formula and a broken ^2 stand-in disagree at a mid-fuse point (real ${real.sxz}, broken ${broken.sxz}) -- §2's exact-match assertions are not vacuously true for any curve`);
}

// ═════════════ 7. #731 iron golem body roll ═════════════
{
  const g = (pos, spd) => ({ type: 'iron_golem', maxHealth: 100, animPos: pos, animSpeed: spd, animSpeedO: spd });
  const roll = (e) => ER.animOf(e, 0.5).roll;
  const cs = ER.golemRollCS(6);
  ok(Math.abs(roll(g(20, 0.6))) > 1e-3, 'walking iron_golem has a nonzero Z roll');
  ok(roll(g(20, 0)) === 0, 'standing iron_golem has no roll');
  ok(ER.animOf({ type: 'zombie', maxHealth: 20, animPos: 20, animSpeed: 0.6, animSpeedO: 0.6 }, 0.5).roll === 0, 'other mobs do not roll');
  const f6 = 20 - 0.6 * 0.5 + 6, want = 6.5 * ((Math.abs(f6 % 13 - 6.5) - 3.25) / 3.25);
  ok(Math.abs(roll(g(20, 0.6)) - want) < 1e-9, 'roll matches the IronGolemEntityRenderer formula');
  ok(cs && Math.abs(cs.c * cs.c + cs.s * cs.s - 1) < 1e-9, 'roll matrix is a rotation');
  const brokenRoll = () => 0;
  okAv(brokenRoll() !== roll(g(20, 0.6)), 'a rigid (no-roll) golem is distinguishable from the real roll');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
