// loadsrc.mjs — load the engine's shared modules headlessly, with the registry decoded.
//
// Session 2 made the world store REGISTRY REAL STATES, which means almost every check now needs
// `NS.Reg` and `NS.States` before it can ask what a block is. Six checks were each about to grow
// their own copy of that twenty-line bootstrap, so it lives here once.
//
// This deliberately loads the REAL source files as a browser would — a bare IIFE against a
// global `MCL` — rather than importing anything. A check that tests a rewritten copy of the
// engine tests nothing.

import { readFileSync } from 'node:fs';
import { supportRuleTable } from './supportrule.mjs';
import { shapeTable } from './shapetable.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SRC = MCLITE_ROOT + 'src';
export const ASSETS = MCLITE_ROOT + 'assets';

/** The worker bundle's module list, in build.mjs's order. Keep the two in step. */
export const WORKER_FILES = [
  '00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
  '02c_states.js', '02k_survive.js', '02l_dimension.js', '02m_jrandom.js', '02d_wgdata.js', '02e_templates.js', '03_section.js', '03b_noise.js', '04_worldgen.js',
  '04b_caves.js', '04d_column.js', '04e_climate.js', '04f_earth.js', '04g_biomes.js',
  '04h_surface.js', '04i_carvers.js', '04j_features.js', '04k_feat_trees.js', '04p_feat_cold.js', '04m_feat_water.js', '04n_feat_terrain.js', '04q_feat_coral.js',
  '04r_structures.js', '04s_struct_mineshaft.js', '04t_jigsaw.js', '04u_struct_surface.js', '04v_struct_village.js', '04w_struct_rest.js', '04x_struct_stronghold.js', '04y_struct_nether_fortress.js', '04z_struct_end_city.js', '05_mesher.js',
];

const text = (f) => readFileSync(join(SRC, f), 'utf8');

/**
 * loadEngine({ extra, dom, initReg }) -> MCL
 *   extra   additional src files to append (main-thread modules a check needs)
 *   dom     true to hand the modules the minimal window/document/navigator stubs
 *   initReg false to skip decoding the registry (only useful for testing the decoder itself)
 *   patch   (file, src) -> src: an anti-vacuity break that edits the REAL source text before it loads
 *           (the caller asserts its edit matched; a closure-private rule has no other handle)
 */
export function loadEngine(opts) {
  const o = opts || {};
  const extra = (o.extra || []).slice();
  // D-670: 07y_equip.js's enchant roll IS 07ox_enchhelper.js's full-registry generateEnchantments —
  // a check that loads Equip gets its dependency, the way the shipped build (all of src/) always does.
  const iq = extra.indexOf('07y_equip.js');
  if (iq >= 0 && extra.indexOf('07ox_enchhelper.js') < 0) extra.splice(iq, 0, '07ox_enchhelper.js');
  // cloud relaxed-curie item 1: a flying arrow (14j_combat.js `Cb.arrowRaycast`) IS 14c_raycast.js's
  // COLLIDER raycast -- same rule, so an arrow in a check never falls through the floor.
  const ic = extra.indexOf('14j_combat.js');
  if (ic >= 0 && extra.indexOf('14c_raycast.js') < 0) extra.splice(ic, 0, '14c_raycast.js');
  // G17-SB1: /scoreboard (15g_commands.js) registers over NS.Scoreboard, the way the shipped build has it.
  const isb = extra.indexOf('15g_commands.js');
  if (isb >= 0 && extra.indexOf('07zzo2_scoreboard.js') < 0) extra.splice(isb, 0, '07zzo2_scoreboard.js');
  const files = WORKER_FILES.concat(extra);
  const body = "'use strict';\n" + files.map((f) => (o.patch ? o.patch(f, text(f)) : text(f))).join('\n') + '\nreturn MCL;\n';
  let MCL;
  if (o.dom) {
    MCL = new Function('window', 'document', 'navigator', body)(
      { addEventListener() {} },
      { createElement: () => ({ getContext: () => null, addEventListener() {} }), addEventListener() {} },
      { hardwareConcurrency: 4 });
  } else {
    MCL = new Function(body)();
  }
  if (o.initReg !== false) initRegistry(MCL);
  if (MCL.MobVoice) MCL.MobVoice.GATED = false;   // #4003: the voice mechanics are tested for every mob; the gate has mobvoicegatecheck
  return MCL;
}

/** Decode the packed registry into an MCL namespace, exactly as the boot path does. */
export function initRegistry(MCL) {
  const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
  const gm = rd('block-geometry.meta.json');
  const rm = rd('block-runtime.meta.json');
  const bt = rd('block-tiles.meta.json');
  const wg = rd('worldgen.meta.json');
  const st = rd('structures.meta.json');
  const bp = rd('biome-params.meta.json');
  const cm = rd('colormaps.meta.json');
  const tg = rd('tags.meta.json');
  const mn = rd('mining.meta.json');
  const lt = rd('loot.meta.json');
  MCL.Reg.init({
    runtime: readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'),
    runtimeBytes: rm.rawBytes,
    geometry: readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64'),
    geometryBytes: gm.rawBytes,
    tileAlpha: bt.alpha,
    worldgen: readFileSync(join(ASSETS, 'worldgen.bin')).toString('base64'),
    worldgenBytes: wg.jsonBytes,
    templates: readFileSync(join(ASSETS, 'structures.bin')).toString('base64'),
    templatesBytes: st.blobBytes,
    biomeParams: readFileSync(join(ASSETS, 'biome-params.bin')).toString('base64'),
    biomeParamsBytes: bp.rawBytes,
    colormaps: readFileSync(join(ASSETS, 'colormaps.bin')).toString('base64'),
    colormapsBytes: cm.rawBytes,
    // PLAN G1/G3's three payloads. They are MAIN-ONLY modules, so `Reg.init` only reaches them
    // when a check asked for them in `extra`; handing them over unconditionally costs a check
    // that did not nothing at all, and a check that DID ask would otherwise get an empty Tags.
    tags: readFileSync(join(ASSETS, 'tags.bin')).toString('base64'),
    tagsBytes: tg.blobBytes,
    mining: readFileSync(join(ASSETS, 'mining.bin')).toString('base64'),
    miningBytes: mn.rawBytes,
    loot: readFileSync(join(ASSETS, 'loot.bin')).toString('base64'),
    lootBytes: lt.jsonBytes,
    // ⚠ D-346's survival-rule table, from the SAME join `gen-data.mjs` ships to the browser.
    // A second copy here would be a second table, and the first time they disagreed it would
    // read as "the rule works in the game and not in the check" (D-164, D-314).
    supportRule: (() => { try { return supportRuleTable(ASSETS).rule; } catch { return null; } })(),
    solidMaterial: (() => { try { return supportRuleTable(ASSETS).solid; } catch { return null; } })(),
    // ⚠ D-348's SECOND level, from the same join, for the same reason.
    groundRule: (() => { try { return supportRuleTable(ASSETS).ground; } catch { return null; } })(),
    iceMaterial: (() => { try { return supportRuleTable(ASSETS).iceMat; } catch { return null; } })(),
    canOcclude: (() => { try { return supportRuleTable(ASSETS).occlude; } catch { return null; } })(),
    outlineFull: (() => { try { return supportRuleTable(ASSETS).outlineFull; } catch { return null; } })(),
    igniteOdds: (() => { try { return supportRuleTable(ASSETS).ignite; } catch { return null; } })(),
    burnOdds: (() => { try { return supportRuleTable(ASSETS).burn; } catch { return null; } })(),
    shapes: shapeTable(ASSETS),   // #4944: the same join gen-data.mjs ships
  });
  // ⚠ THE SPRITE-MODEL FIELDS, FROM THE SAME META THE GAME GETS (D-342). The extruded item
  // sprites are parts APPENDED to the block parts, so a headless check that decodes
  // `block-geometry.bin` already has their geometry — but not the one number that says where
  // they start. Without it `EntityRender` reports "this engine has no picture for that item"
  // for every sprite item, which is the pre-D-342 answer, and a check would quietly re-assert
  // the bug. `gen-data.mjs` ships exactly these three fields to the browser; this hands the
  // same three to a check, out of the same files.
  MCL.DATA = Object.assign({}, MCL.DATA, {
    spritePart0: gm.spritePart0 | 0,
    spriteParts: gm.spriteParts | 0,
    spriteAlpha: (() => { try { return rd('sprite-geometry.json').alpha || []; } catch { return []; } })(),
  });
  // PASS 15 JOB 3 (G17e) — same reasoning, same three-field shape, for the block-entity item
  // parts (D-341/D-342's trick a third time): a headless check that decodes `block-geometry.bin`
  // already has a chest's/bed's/banner's geometry, but not `bePart0` or the name->index map.
  MCL.DATA = Object.assign({}, MCL.DATA, {
    bePart0: gm.bePart0 | 0,
    beParts: gm.beParts | 0,
    beNames: gm.beNames || {},
  });

  // s119 — `canPathfindThrough(LAND)`'s table, from the SAME golden `gen-data.mjs` inlines
  // (tools/golden/pathfind-land-1.18.2.tsv), so `Ai.commonNodeType` answers alike in both.
  MCL.DATA = Object.assign({}, MCL.DATA, {
    pathLand: (() => {
      const out = {};
      try {
        const f = join(ASSETS, '..', 'tools', 'golden', 'pathfind-land-1.18.2.tsv');
        for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
          if (!line || line.startsWith('#')) continue;
          const c = line.split('\t'); out[c[0]] = c[1];
        }
      } catch { /* no golden: Ai falls back to base !isFullCube for every block */ }
      return out;
    })(),
    // #212 — the mob-ai golden, the same one gen-data inlines
    mobAi: (() => {
      const out = {};
      try {
        for (const line of readFileSync(join(ASSETS, '..', 'tools', 'golden', 'mobai-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
          if (!line || line.startsWith('#')) continue;
          const c = line.split('\t'); out[c[0]] = c[1];
        }
      } catch { /* no golden: Ai keeps its literal fallbacks */ }
      return out;
    })(),
    // cloud nifty-gauss — `hasSidedTransparency` (tools/golden/sided-light-1.18.2.tsv), the same golden gen-data inlines
    sidedLight: (() => {
      const out = {};
      try {
        for (const line of readFileSync(join(ASSETS, '..', 'tools', 'golden', 'sided-light-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
          if (!line || line.startsWith('#')) continue;
          const c = line.split('\t'); out[c[0]] = c[1];
        }
      } catch { /* no golden: no block is sided */ }
      return out;
    })(),
    // #406 — `.luminance()` rules (tools/golden/luminance-1.18.2.tsv), the same golden gen-data inlines
    luminance: (() => {
      const out = {};
      try {
        for (const line of readFileSync(join(ASSETS, '..', 'tools', 'golden', 'luminance-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
          if (!line || line.startsWith('#')) continue;
          const c = line.split('\t'); out[c[0]] = [c[1], +c[2]];
        }
      } catch { /* no golden: per-block emission */ }
      return out;
    })(),
    // cloud zealous-dirac — `getPlacementState`'s facing rule (tools/golden/place-facing-1.18.2.tsv), the same golden gen-data inlines
    placeFacing: (() => {
      const out = {};
      try {
        for (const line of readFileSync(join(ASSETS, '..', 'tools', 'golden', 'place-facing-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
          if (!line || line.startsWith('#')) continue;
          const c = line.split('\t'); out[c[0]] = c[1];
        }
      } catch { /* no golden: every block keeps P.placementState's default */ }
      return out;
    })(),
  });

  // #357 — the light engine's face-shape masks need `sidedLight`, which only arrives in the DATA block above
  // (the game passes it in Reg.init's own data)
  MCL.States.fillLightOpacity(MCL.DATA.sidedLight);
  MCL.States.fillLuminance(MCL.DATA.luminance);
  if (!MCL.States.ready) throw new Error('States.build did not run inside Reg.init');
  return MCL;
}
