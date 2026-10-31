#!/usr/bin/env node
// bonemealfeatcheck.mjs -- #318: bone meal on the feature-backed Fertilizables goes through the W track's own
// configured features (.decomp GrassBlock.grow, MushroomPlantBlock.grow, BoneMealItem.useOnGround), no second generator.
//   node tools/bonemealfeatcheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
  '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14f_inventory.js', '07zv_villagerbrain.js', '14l_use.js'];
function lcg(seed) { let s = Math.imul(seed + 1, 2654435761) >>> 0; s = (Math.imul(s ^ (s >>> 15), 2246822519) >>> 0); return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function run(patch) {
  let pass = 0; const fails = [];
  const ok = (c, m) => { if (c) pass++; else fails.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Gen.init(1337, Object.assign(MCL.Gen.defaults(), { climate: 'vanilla' }));
  const R = MCL.Reg, S = MCL.States, B = MCL.Behave, U = MCL.Use, It = MCL.Items, F = MCL.Features;
  const biomeIdx = (n) => MCL.Biomes.index(n.indexOf(':') < 0 ? n : n);
  let NOFLOWER = null;
  for (let i = 0; i < MCL.Biomes.count && !NOFLOWER; i++) if (!F.flowerFeatures(i).length && /^minecraft:(snowy_plains|stony_peaks|badlands|ocean|beach|swamp|jagged_peaks|taiga|ice_spikes|savanna|jungle|mushroom_fields|desert)$/.test(MCL.Biomes.name(i))) NOFLOWER = MCL.Biomes.name(i).replace('minecraft:', '');
  let curBiome = 'plains';
  const cells = new Map(); let floorFn = () => 0;
  const k = (x, y, z) => x + ',' + y + ',' + z;
  const W = {
    getBlock: (x, y, z) => (cells.has(k(x, y, z)) ? cells.get(k(x, y, z)) : floorFn(x, y, z)),
    setBlock(x, y, z, id) { cells.set(k(x, y, z), id); return true; },
    blockLightAt: () => 15, biomeAt: () => biomeIdx(curBiome),
  };
  MCL.World = W; B.world = W; B.init(W); MCL.BlockEntities.init(); B.clearSchedule(); MCL.Redstone.init();
  MCL.Entities.init(); MCL.EntityList.init(); U.init(W);
  W.canSurvive = () => true;     // support rules are Behave's, not under test here
  MCL.Particle = { worldEvent: () => 0 }; MCL.Sound = { play: () => true };
  const st = (n) => S.stateOf(n) | 0;
  const nm = (s) => R.names[S.block[s]];
  const UP = [0, 1, 2, 3, 4, 5].find((f) => MCL.CFG.FACE_DY[f] === 1);
  const census = () => { const c = {}; for (const s of cells.values()) { const n = nm(s); c[n] = (c[n] | 0) + 1; } return c; };
  const click = (x, y, z, rnd, face) => {
    const P = { instabuild: false, inventory: null, slot: 0, syncHotbar() {}, heldItem() { return this._s; } };
    P._s = { i: It.of('bone_meal'), n: 3, d: 0 };
    MCL.EntityList.random = rnd;
    return { res: U.itemUseOn(P, x, y, z, face === undefined ? UP : face, W.getBlock(x, y, z), P._s), n: P._s.n };
  };

  // 1. the flower list is the BIOME's, first feature first
  const FL = { plains: ['dandelion', 'poppy', 'orange_tulip', 'red_tulip', 'pink_tulip', 'white_tulip', 'azure_bluet', 'oxeye_daisy', 'cornflower'],
    flower_forest: ['dandelion', 'poppy', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley'] };
  ok(F.flowerFeatures(biomeIdx(NOFLOWER)).length === 0, 'taiga has no flower feature');
  ok(F.flowerFeatures(biomeIdx('plains')).length > 0 && F.flowerFeatures(biomeIdx('flower_forest')).length > 0, 'plains and flower_forest have flower features');
  for (const b of ['plains', 'flower_forest']) {
    const seen = new Set(), rg = new MCL.Carvers.Rng(11, 22, 33);
    for (let i = 0; i < 400; i++) seen.add(nm(F.bonemealFlower(biomeIdx(b), i * 7, 64, i * 13, rg)));
    ok([...seen].length > 1 && [...seen].every((n) => FL[b].includes(n)), b + ' bone-meal flowers come from its own list: ' + [...seen]);
  }
  ok(!F.flowerFeatures(biomeIdx('flower_forest')).some((f) => !f.to) , 'flower providers resolve');

  // 2. grass block in flower_forest: grass tufts AND flowers appear; in a flowerless biome: only grass
  for (const [b, wantFlower] of [['flower_forest', true], [NOFLOWER, false]]) {
    curBiome = b; cells.clear(); floorFn = (x, y) => (y < 64 ? st('grass_block') : 0);
    let flowers = 0, grass = 0;
    for (let sd = 1; sd <= 6; sd++) {
      cells.clear();
      const r = click(0, 63, 0, lcg(sd));
      ok(r.res === true && r.n === 2, b + ' grass block bone meal counts and spends one');
      const c = census();
      grass += c.grass | 0;
      for (const n of FL.flower_forest) flowers += c[n] | 0;
    }
    ok(grass > 0, b + ' bone meal spreads grass: ' + grass);
    ok(wantFlower ? flowers > 0 : flowers === 0, b + ' flowers ' + flowers + (wantFlower ? ' expected' : ' unexpected'));
  }

  // 3. red/brown mushroom on mycelium: the same blocks as the W feature at the same Rng
  curBiome = 'plains';
  for (const kind of ['red', 'brown']) {
    let grown = 0;
    for (let sd = 1; sd <= 30; sd++) {
      cells.clear(); floorFn = (x, y) => (y < 64 ? st('mycelium') : 0);
      W.setBlock(0, 64, 0, st(kind + '_mushroom'));
      const rA = lcg(sd), rB = lcg(sd);
      click(0, 64, 0, rA);
      const got = JSON.stringify([...cells].sort());
      // reference: same draws by hand -> canGrow, then the configured feature on a fresh copy
      cells.clear(); W.setBlock(0, 64, 0, 0);
      let want = '[]';
      if (rB() < 0.4) {
        const rg = new MCL.Carvers.Rng((rB() * 4294967296) | 0, (rB() * 4294967296) | 0, (rB() * 4294967296) | 0);
        W.setBlock(0, 64, 0, 0);
        const okF = F.growFeature(W, 'huge_' + kind + '_mushroom', 0, 64, 0, rg, false);
        if (!okF) { cells.clear(); W.setBlock(0, 64, 0, st(kind + '_mushroom')); }
      } else { cells.clear(); W.setBlock(0, 64, 0, st(kind + '_mushroom')); }
      want = JSON.stringify([...cells].sort());
      ok(got === want, kind + ' mushroom seed ' + sd + ' = the W feature');
      if ((census()[kind + '_mushroom_block'] | 0) > 0) grown++;
    }
    ok(grown > 3, kind + ' mushroom grew into a huge one in ' + grown + '/30 seeds');
  }
  // no soil -> the mushroom stays
  cells.clear(); floorFn = (x, y) => (y < 64 ? st('stone') : 0); W.setBlock(0, 64, 0, st('red_mushroom'));
  for (let sd = 1; sd <= 10; sd++) click(0, 64, 0, lcg(sd));
  ok(nm(W.getBlock(0, 64, 0)) === 'red_mushroom' && !(census().red_mushroom_block), 'a mushroom on stone never grows (canGenerate)');

  // 4. underwater: seagrass; warm_ocean: coral too
  const sea = (b) => { curBiome = b; cells.clear(); floorFn = (x, y) => (y <= 60 ? st('sand') : (y <= 63 ? st('water') : 0)); };
  sea('ocean');
  let r = click(0, 60, 0, lcg(4), UP);
  ok(r.res === true && r.n === 2 && (census().seagrass | 0) > 3, 'bone meal on a sea floor places seagrass: ' + (census().seagrass | 0));
  sea('warm_ocean'); r = click(0, 60, 0, lcg(4), UP);
  const wc = census(); let corals = 0;
  for (const n in wc) if (/coral/.test(n)) corals += wc[n];
  ok(r.res === true && corals > 0, 'warm_ocean bone meal also places coral: ' + corals);
  return { pass, fails };
}

console.log('bonemealfeatcheck -- #318 bone meal on the feature-backed Fertilizables');
const base = run();
base.fails.forEach((f) => console.log('  FAIL ' + f));
const mutants = [
  ['biome-blind flower list', (f, t) => f === '04j_features.js' ? t.replace('return l.length ? l[0].to(r, x, y, z) : 0;', "return NS.States.stateOf('poppy');") : t],
  ['hand-written huge mushroom', (f, t) => f === '14l_use.js' ? t.replace("B.growFeature(isBlock(state, 'red_mushroom') ? 'huge_red_mushroom' : 'huge_brown_mushroom', x, y, z, mr, false)", "(W.setBlock(x, y + 1, z, S.stateOf('red_mushroom_block')), true)") : t],
  ['mushroom canGenerate dropped', (f, t) => f === '04p_feat_cold.js' ? t.replace('if (!canGenerate(SB, cx, cz, x, y, z, h, kindName === \'huge_brown_mushroom\' ? radius : 0)) return 0;', '') : t],
  ['seagrass spread dropped', (f, t) => f === '14l_use.js' ? t.replace("if (isBlock(here, 'water') && Use.isFluidSource(here)) { W.setBlock(px, py, pz, st);", "if (false) { W.setBlock(px, py, pz, st);") : t],
  ['coral branch dropped', (f, t) => f === '14l_use.js' ? t.replace("=== 'warm_ocean') {", "=== 'no_such_biome') {") : t],
];
let caught = 0;
for (const [label, p] of mutants) {
  const r = run(p);
  if (r.fails.length) { caught++; console.log('   ✓ caught: ' + label); } else console.log('  NOT CAUGHT: ' + label);
}
console.log(' assertions passed .. ' + base.pass);
console.log(' failures ........... ' + base.fails.length);
console.log(' ' + caught + ' breaks caught');
if (base.fails.length || caught !== mutants.length) process.exit(1);
