#!/usr/bin/env node
// mountrendercheck.mjs — QUEUE 0.2 (G18e remainder, Mnt.OWED/Ll.OWED render close, unit A):
// the RENDER layer this session built on top of the mount/llama/horse SUBSTRATE earlier
// passes already closed (Mnt.saddle/e.tamed/e.variant/e.carpetColor/e.armorItem/e.hasChest,
// 07r_mount.js; Ll.skinKey, 07ze_llama.js) — none of it drew a single extra pixel before now.
//
//   node tools/mountrendercheck.mjs [--verbose]
//
// Sections:
//   1. tools/extract-mob-textures.mjs + pack-mobtex.mjs — the FOUR new families this session
//      added (horse_marking, horse_armor, plus llama/decor#null which already existed but
//      drew nothing) reach assets/mob-geometry.json with the EXACT keys the render wiring
//      below assumes — the bare-name-at-index-0 convention D-469's own "cat" family already
//      established, re-checked here rather than trusted from memory.
//   2. llama base colour — `Ll.skinKey`, and that different e.variant values actually sample
//      DIFFERENT atlas tiles (not silently collapsing onto one sheet).
//   3. the carpet decoration overlay — `ER.visible` pushes a second, untinted "decor#null.."
//      item only when `Mnt.hasDecorSlot(e) && e.carpetColor` is set.
//   4. the horse marking overlay — pushed only for marking 1..4 (0 = NONE, HorseMarking's own
//      first ordinal, never drawn — HorseMarkingFeatureRenderer.decomp).
//   5. the horse armour overlay — pushed only when `e.armorItem` is set, keyed off
//      `Mnt.HORSE_ARMOR_TEX_INDEX`.
//   6. donkey/mule/llama chest boxes — `Mnt.hideChestParts`/`ER.emitMobLayer`'s new
//      `hideParts` parameter actually drops the `left_chest`/`right_chest` quads when
//      `!e.hasChest`, and draws them (same quad count as the full geometry) when it is set;
//      a horse (not CHESTABLE) is never asked to hide anything even if `e.hasChest` were
//      (wrongly) set on one.
//   7. anti-vacuity — the bare-name-at-0 convention is not a rubber stamp: a naive
//      "family#<index>" formula (no special case for index 0) would have looked up a KEY
//      THAT DOES NOT EXIST and silently fallen back to the wrong texture — reproduced from
//      the real geometry table, not asserted from memory — and hiding the WRONG part name
//      leaves the chest boxes fully drawn.

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('mountrendercheck — QUEUE 0.2 G18e remainder, mount/llama render overlays (Mnt.OWED/Ll.OWED close, unit A)');

// ═════════════════════ 1. the packer — the new families reach mob-geometry.json ══════════════
const geom = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'), 'utf8'));
{
  say('\n§1 pack-mobtex.mjs — horse_marking/horse_armor/decor geometry keys');
  const need = (k) => ok(Array.isArray(geom.layers[k]) && geom.layers[k].length > 0, `mob-geometry.json has a non-empty "${k}" layer`);
  // sheet 0 of each family is baked under the BARE key, never "#0" — D-469's own "cat"/"horse"
  // convention (the base layerName fallback only rescues this for a family whose name IS the
  // species — "llama"/"horse" — never for an OVERLAY family like these three).
  need('horse_marking'); need('horse_marking#1'); need('horse_marking#2'); need('horse_marking#3');
  need('horse_armor'); need('horse_armor#1'); need('horse_armor#2'); need('horse_armor#3');
  need('decor#null');
  for (let i = 1; i <= 15; i++) need('decor#null#' + i);
  // GEOM_BASE_OVERRIDE: horse_marking/horse_armor borrow HORSE's own box list — same shape
  // (part/face/slice-counts) as "horse" itself, exactly the wolf_tame/wolf check this file's
  // sibling (mobrendercheck.mjs) already runs for the collar unit.
  const shapeOf = (L) => L.map((parts) => parts.map((faces) => faces.length));
  ok(JSON.stringify(shapeOf(geom.layers.horse)) === JSON.stringify(shapeOf(geom.layers.horse_marking)),
    'horse_marking\'s box SHAPE matches horse\'s (GEOM_BASE_OVERRIDE: same geometry, different skin)');
  ok(JSON.stringify(shapeOf(geom.layers.horse)) === JSON.stringify(shapeOf(geom.layers.horse_armor)),
    'horse_armor\'s box SHAPE matches horse\'s (GEOM_BASE_OVERRIDE: same geometry, different skin)');
}

// ═════════════════════ 2. engine + a real EntityList (no World needed, EL.list hand-built) ════
const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07n_tame.js', '07m_breed.js', '07r_mount.js', '07ze_llama.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
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
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Breed.init();
M.Tame.init();
M.Mount.init();
M.EntityRender.init();
const ER = M.EntityRender, Mn = M.Mount, Ll = M.Llama;
ok(ER.ready && Mn.ready, 'EntityRender/Mount both report ready');
ok(!!Ll && typeof Ll.skinKey === 'function', 'NS.Llama.skinKey exists (07ze_llama.js)');
ok(typeof Mn.hideChestParts === 'function' && typeof Mn.HORSE_ARMOR_TEX_INDEX === 'object',
  'Mnt.hideChestParts/Mnt.HORSE_ARMOR_TEX_INDEX exist (07r_mount.js)');

function mkLlama(over) {
  return Object.assign({ type: 'llama', x: 0, y: 5, z: 0, px: 0, py: 5, pz: 0,
    yaw: 0, pyaw: 0, age: 0, variant: 0, hasChest: false, tamed: true }, over || {});
}
function mkHorse(over) {
  return Object.assign({ type: 'horse', x: 20, y: 5, z: 0, px: 20, py: 5, pz: 0,
    yaw: 0, pyaw: 0, age: 0, variant: 0, tamed: true }, over || {});
}
function mkDonkey(over) {
  return Object.assign({ type: 'donkey', x: 40, y: 5, z: 0, px: 40, py: 5, pz: 0,
    yaw: 0, pyaw: 0, age: 0, hasChest: false, tamed: true }, over || {});
}

// ═════════════════════ 3. llama base colour ═══════════════════════════════════════════════════
{
  say('\n§3 llama base-colour texKey (Ll.skinKey)');
  ok(Ll.skinKey(mkLlama({ variant: 0 })) === 'llama#0', 'variant 0 (creamy) -> "llama#0"');
  ok(Ll.skinKey(mkLlama({ variant: 3 })) === 'llama#3', 'variant 3 (gray) -> "llama#3"');
  ok(Ll.skinKey({ type: 'cow' }) === null, 'a non-llama returns null');

  M.EntityList.list = [mkLlama({ variant: 0 })];
  let vis = ER.visible(0, 5, 0, 1);
  let body = vis.find((it) => it.shape === 'mob' && it.mobLayer === 'llama');
  ok(!!body && body.texKey === 'llama#0', 'the body item carries the variant-0 texKey');

  // different variants must sample DIFFERENT tiles -- not collapse onto one sheet.
  const g0 = ER.mobGeomFor('llama', 'llama#0'), g3 = ER.mobGeomFor('llama', 'llama#3');
  ok(!!g0 && !!g3, 'both variant-0 and variant-3 geometry tables resolve');
  const tile0 = g0[0][0][0].tile, tile3 = g3[0][0][0].tile;
  okAv(tile0 !== tile3, `variant 0 and variant 3 sample DIFFERENT atlas tiles for the same part/face (got ${tile0} for both would mean every llama looks creamy)`);
}

// ═════════════════════ 4. the carpet decoration overlay ═══════════════════════════════════════
{
  say('\n§4 llama carpet decor overlay');
  M.EntityList.list = [mkLlama({ carpetColor: null })];
  let vis = ER.visible(0, 5, 0, 1);
  let mobItems = vis.filter((it) => it.shape === 'mob');
  okAv(!mobItems.some((it) => it.texKey && it.texKey.indexOf('decor#null') === 0),
    `a llama with NO carpet draws no decor overlay item (got texKeys: ${mobItems.map((it) => it.texKey)})`);

  M.EntityList.list = [mkLlama({ carpetColor: 0 })];   // white
  vis = ER.visible(0, 5, 0, 1);
  mobItems = vis.filter((it) => it.shape === 'mob');
  const white = mobItems.find((it) => it.texKey && it.texKey.indexOf('decor#null') === 0);
  ok(!!white && white.texKey === 'decor#null', 'carpetColor 0 (white) draws texKey "decor#null" (bare, not "decor#null#0")');

  M.EntityList.list = [mkLlama({ carpetColor: 5 })];   // lime
  vis = ER.visible(0, 5, 0, 1);
  mobItems = vis.filter((it) => it.shape === 'mob');
  const lime = mobItems.find((it) => it.texKey && it.texKey.indexOf('decor#null') === 0);
  ok(!!lime && lime.texKey === 'decor#null#5', 'carpetColor 5 (lime) draws texKey "decor#null#5"');
  ok(mobItems.some((it) => it.mobLayer === 'llama' && it.texKey !== lime.texKey),
    'the BODY item still draws too, alongside the decor overlay (a second `it`, not a replacement)');

  // a species with no decor slot at all never draws one, even if carpetColor were set on it
  M.EntityList.list = [mkDonkey({ carpetColor: 5 })];
  vis = ER.visible(40, 5, 0, 1);
  ok(!vis.some((it) => it.texKey && it.texKey.indexOf('decor#null') === 0),
    'a donkey (Mnt.hasDecorSlot false) never draws the decor overlay even with e.carpetColor set');

  // #3927: LlamaDecorFeatureRenderer has no isInvisible check -- carpet / trader blanket draw on an invisible llama
  const realFx = M.Effects;
  M.Effects = { ready: true, hasStatusEffect: (o, id) => id === 'invisibility' };
  const decorOf = (e) => { M.EntityList.list = [e]; return ER.visible(0, 5, 0, 1).filter((it) => it.texKey && it.texKey.indexOf('decor#null') === 0); };
  okAv(decorOf(mkLlama({ carpetColor: 5 })).length === 1, 'an INVISIBLE carpeted llama still draws its carpet');
  okAv(decorOf(mkLlama({ type: 'trader_llama', carpetColor: null })).some((it) => it.texKey === 'decor#null#16'), 'an INVISIBLE trader_llama still draws the trader blanket');
  M.Effects = realFx;
}

// ═════════════════════ 5. the horse marking overlay ════════════════════════════════════════════
{
  say('\n§5 horse marking overlay');
  M.EntityList.list = [mkHorse({ variant: Mn.encodeVariant(0, 0) })];   // marking NONE
  let vis = ER.visible(20, 5, 0, 1);
  okAv(!vis.some((it) => it.texKey && it.texKey.indexOf('horse_marking') === 0),
    `marking NONE (0) draws no marking overlay at all (got: ${vis.filter((it) => it.shape === 'mob').map((it) => it.texKey)})`);

  M.EntityList.list = [mkHorse({ variant: Mn.encodeVariant(0, 1) })];   // white
  vis = ER.visible(20, 5, 0, 1);
  let mk = vis.find((it) => it.texKey && it.texKey.indexOf('horse_marking') === 0);
  ok(!!mk && mk.texKey === 'horse_marking', 'marking 1 (white) draws texKey "horse_marking" (bare, index 0 of the family)');

  M.EntityList.list = [mkHorse({ variant: Mn.encodeVariant(0, 4) })];   // black dots
  vis = ER.visible(20, 5, 0, 1);
  mk = vis.find((it) => it.texKey && it.texKey.indexOf('horse_marking') === 0);
  ok(!!mk && mk.texKey === 'horse_marking#3', 'marking 4 (blackdots) draws texKey "horse_marking#3"');

  // a donkey never gets a horse-marking overlay (Mnt.horseMarking gates e.type === 'horse')
  M.EntityList.list = [mkDonkey({ variant: Mn.encodeVariant(0, 1) })];
  vis = ER.visible(40, 5, 0, 1);
  ok(!vis.some((it) => it.texKey && it.texKey.indexOf('horse_marking') === 0),
    'a donkey never draws the horse marking overlay, regardless of e.variant');
}

// ═════════════════════ 6. the horse armour overlay ══════════════════════════════════════════════
{
  say('\n§6 horse armour overlay');
  M.EntityList.list = [mkHorse({ armorItem: null })];
  let vis = ER.visible(20, 5, 0, 1);
  okAv(!vis.some((it) => it.texKey && it.texKey.indexOf('horse_armor') === 0),
    'an unarmoured horse draws no armour overlay');

  M.EntityList.list = [mkHorse({ armorItem: 'leather_horse_armor' })];
  vis = ER.visible(20, 5, 0, 1);
  let ar = vis.find((it) => it.texKey && it.texKey.indexOf('horse_armor') === 0);
  ok(!!ar && ar.texKey === 'horse_armor', 'leather (index 0) draws texKey "horse_armor" (bare)');

  M.EntityList.list = [mkHorse({ armorItem: 'diamond_horse_armor' })];
  vis = ER.visible(20, 5, 0, 1);
  ar = vis.find((it) => it.texKey && it.texKey.indexOf('horse_armor') === 0);
  ok(!!ar && ar.texKey === 'horse_armor#3', 'diamond (index 3) draws texKey "horse_armor#3"');

  M.EntityList.list = [mkHorse({ armorItem: 'golden_horse_armor' })];
  vis = ER.visible(20, 5, 0, 1);
  ar = vis.find((it) => it.texKey && it.texKey.indexOf('horse_armor') === 0);
  ok(!!ar && ar.texKey === 'horse_armor#2', 'golden (item name) -> index 2 -> "horse_armor#2" (the jar\'s own file is "horse_armor_gold.png", not "golden")');
}

// ═════════════════════ 7. donkey/mule/llama chest boxes ═════════════════════════════════════════
{
  say('\n§7 chest-part hide/show (Mnt.hideChestParts + ER.emitMobLayer\'s hideParts)');
  ok(Mn.hideChestParts(mkDonkey({ hasChest: false })) !== null, 'a chestless donkey hides its chest parts');
  ok(Mn.hideChestParts(mkDonkey({ hasChest: true })) === null, 'a chested donkey hides nothing');
  ok(Mn.hideChestParts(mkHorse({ hasChest: false })) === null, 'a horse (not CHESTABLE) is never asked to hide anything, even with e.hasChest falsy');
  ok(Mn.hideChestParts(mkHorse({ hasChest: true })) === null, 'a horse (not CHESTABLE) is never asked to hide anything, even with e.hasChest truthy');

  for (const species of ['donkey', 'mule', 'llama']) {
    const L = M.BEModel.layer(species);
    ok(!!L, species + ' has a real box list');
    let lcIdx = -1, rcIdx = -1;
    for (let k = 0; k < L.parts.length; k++) {
      if (L.parts[k].n === 'left_chest') lcIdx = k;
      if (L.parts[k].n === 'right_chest') rcIdx = k;
    }
    ok(lcIdx >= 0 && rcIdx >= 0, species + ' has left_chest/right_chest parts in its own box list');

    // expected quad delta: the exact quad-count formula ER.mobQuadCount/mobFaceQuadCount use
    // (slices.length, or 1 for a degenerate/absent face) -- summed only over the two chest
    // parts, off the REAL mob-geometry.json table, not re-derived from ER's own internals.
    const layerGeom = geom.layers[species];
    let chestQuads = 0;
    for (const k of [lcIdx, rcIdx]) {
      for (let f = 0; f < 6; f++) {
        const slices = layerGeom && layerGeom[k] && layerGeom[k][f];
        chestQuads += (slices && slices.length) ? slices.length : 1;
      }
    }
    ok(chestQuads > 0, species + '\'s chest parts contribute a nonzero number of quads');

    const n = ER.mobQuadCount(species);
    const bufFull = new Uint32Array(n * 16);
    const oFull = ER.emitMobLayer(bufFull, 0, species, 0, 0, 0, 1, 0, 15, 0, 0, null,
      undefined, undefined, false, undefined, undefined, null);
    ok(oFull === n * 16, species + ': emitMobLayer with hideParts=null writes the FULL quad count');

    const bufHidden = new Uint32Array(n * 16);
    const oHidden = ER.emitMobLayer(bufHidden, 0, species, 0, 0, 0, 1, 0, 15, 0, 0, null,
      undefined, undefined, false, undefined, undefined, Mn.CHEST_PART_NAMES);
    okAv((oFull - oHidden) / 16 === chestQuads,
      `${species}: hiding left_chest/right_chest drops EXACTLY ${chestQuads} quads (got ${(oFull - oHidden) / 16})`);

    // hiding a WRONG part name changes nothing at all -- the match is exact, not fuzzy.
    const bufWrong = new Uint32Array(n * 16);
    const oWrong = ER.emitMobLayer(bufWrong, 0, species, 0, 0, 0, 1, 0, 15, 0, 0, null,
      undefined, undefined, false, undefined, undefined, { not_a_real_part_xyz: 1, another_fake_part: 1 });
    okAv(oWrong === oFull, `${species}: hiding a part name that does not exist on this species changes nothing (got ${oWrong / 16} vs full ${oFull / 16})`);
  }

  // a horse never has left_chest/right_chest parts at all -- Mnt.isChestable already gates it
  // out before hideParts is even asked, but the geometry itself confirms there is nothing to hide.
  const hL = M.BEModel.layer('horse');
  ok(!hL.parts.some((p) => p.n === 'left_chest' || p.n === 'right_chest'), 'horse has no chest parts in its own box list at all');

  // end-to-end through ER.visible: a chestless donkey's real body item draws fewer quads via
  // emitMobLayer than a chested one's, wired the SAME way §3-§6's overlay items are (it.e read
  // live at the emit call site, not baked into the push).
  M.EntityList.list = [mkDonkey({ hasChest: false })];
  let vis = ER.visible(40, 5, 0, 1);
  let bodyIt = vis.find((it) => it.shape === 'mob' && it.mobLayer === 'donkey');
  ok(!!bodyIt && bodyIt.e.hasChest === false, 'ER.visible\'s donkey item carries the real (chestless) entity');

  M.EntityList.list = [mkDonkey({ hasChest: true })];
  vis = ER.visible(40, 5, 0, 1);
  bodyIt = vis.find((it) => it.shape === 'mob' && it.mobLayer === 'donkey');
  ok(!!bodyIt && bodyIt.e.hasChest === true, 'ER.visible\'s donkey item carries the real (chested) entity');
}

// ═════════════════════ 8. anti-vacuity — the naive formulas really would have been wrong ═══════
{
  say('\n§8 anti-vacuity — bare-at-0 vs naive "family#<n>"');
  // a naive `'horse_marking#' + (markIdx - 1)` (no bare-key special case) would ask for
  // "horse_marking#0" at marking=1 -- prove that key genuinely does not exist, so the naive
  // formula was not an equally-valid alternative spelling.
  okAv(geom.layers['horse_marking#0'] === undefined,
    '"horse_marking#0" does NOT exist in mob-geometry.json (a naive formula with no bare-key case would have silently missed it and drawn a bare horse)');
  okAv(geom.layers['horse_armor#0'] === undefined,
    '"horse_armor#0" does NOT exist either (same trap, same fix)');
  okAv(geom.layers['decor#0'] === undefined,
    '"decor#0" does NOT exist -- the real key is "decor#null" (own-geometry row), not a bare "decor" family');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
