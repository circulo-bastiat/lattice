#!/usr/bin/env node
// bonemealstatescheck.mjs -- #316: BoneMealItem on the state-only Fertilizables (.decomp BoneMealItem, CropBlock,
// CocoaBlock, BambooSaplingBlock, TallFlowerBlock), world event 1505, and the dispenser's BONE_MEAL behaviour.
//   node tools/bonemealstatescheck.mjs
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
  const R = MCL.Reg, S = MCL.States, B = MCL.Behave, U = MCL.Use, It = MCL.Items;
  const N = 48, MID = 24, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const W = {
    getBlock: (x, y, z) => cells[idx(x, y, z)],
    setBlock(x, y, z, id) { cells[idx(x, y, z)] = id; if (B.ready) B.changed(x, y, z); return true; },
    poke(x, y, z, id) { cells[idx(x, y, z)] = id; }, blockLightAt: () => 15,
  };
  MCL.World = W; B.init(W); MCL.BlockEntities.init(); B.clearSchedule(); MCL.Redstone.init();
  MCL.Entities.init(); MCL.EntityList.init(); U.init(W);
  const events = [];
  MCL.Particle = { worldEvent: (id, x, y, z) => { events.push(id); return 0; } };
  MCL.Sound = { play: () => true };
  const st = (n, props) => { let s = S.stateOf(n) | 0; for (const k in props || {}) s = B.setProp(s, k, String(props[k])); return s; };
  const nm = (s) => R.names[S.block[s]];
  const prop = (s, k) => B.propName(s, k);
  const UP = [0, 1, 2, 3, 4, 5].find((f) => MCL.CFG.FACE_DY[f] === 1);
  function use(block, o) {
    cells.fill(0); events.length = 0;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) W.poke(x, 9, z, st('stone'));
    W.poke(0, 10, 0, st(o.floor || 'dirt'));
    W.poke(0, 11, 0, block);
    const P = { instabuild: !!o.creative, inventory: null, slot: 0, syncHotbar() {}, heldItem() { return this._s; } };
    P._s = { i: It.of('bone_meal'), n: 3, d: 0 };
    MCL.EntityList.random = o.rnd || lcg(5);
    const res = U.itemUseOn(P, 0, 11, 0, UP, W.getBlock(0, 11, 0), P._s);
    return { res, n: P._s.n, after: W.getBlock(0, 11, 0), above: W.getBlock(0, 12, 0), ev: events.slice() };
  }
  // crops: advance by 2..5 (beetroot /3), never a mature one, which spends nothing
  for (let seed = 1; seed <= 40; seed++) {
    const r = use(st('wheat', { age: 0 }), { rnd: lcg(seed) });
    const a = +prop(r.after, 'age');
    ok(r.res && a >= 2 && a <= 5 && r.n === 2 && r.ev.join() === '1505', 'wheat age0 -> 2..5, spends one, event 1505 (seed ' + seed + ', age ' + a + ')');
    const b = use(st('beetroots', { age: 0 }), { rnd: lcg(seed) });
    const ba = +prop(b.after, 'age');
    ok(b.res && ba >= 0 && ba <= 1, 'beetroot age0 -> 0..1 (' + ba + ')');
  }
  const mat = use(st('wheat', { age: 7 }), {});
  ok(!mat.res && mat.n === 3 && prop(mat.after, 'age') === '7' && mat.ev.length === 0, 'mature wheat: no growth, item kept, no event');
  ok(use(st('wheat', { age: 0 }), { creative: true }).n === 3, 'creative keeps the stack');
  // cocoa: +1 to 2, then refuses
  for (let a = 0; a < 3; a++) {
    const r = use(st('cocoa', { age: a, facing: 'north' }), {});
    if (a < 2) ok(r.res && +prop(r.after, 'age') === a + 1 && r.n === 2, 'cocoa age ' + a + ' -> ' + (a + 1));
    else ok(!r.res && r.n === 3 && prop(r.after, 'age') === '2', 'mature cocoa refuses');
  }
  // bamboo sapling -> bamboo (small leaves) above
  const bs = use(st('bamboo_sapling'), { floor: 'grass_block' });
  ok(bs.res && nm(bs.above) === 'bamboo' && prop(bs.above, 'leaves') === 'small', 'bamboo_sapling grows a bamboo above');
  // bamboo: 1..2 segments over seeded trials, and both counts seen
  const grew = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const r = use(st('bamboo', { age: 0, leaves: 'none', stage: 0 }), { rnd: lcg(seed), floor: 'grass_block' });
    let h = 0; while (nm(W.getBlock(0, 11 + h, 0)) === 'bamboo') h++;
    grew.add(h);
  }
  ok([...grew].sort().join() === '2,3', 'bamboo gains 1 or 2 segments (' + [...grew] + ')');
  // tall flowers drop a copy and are spent
  for (const f of ['sunflower', 'lilac', 'rose_bush', 'peony']) {
    const r = use(st(f, { half: 'lower' }), {});
    ok(r.res && r.n === 2 && nm(r.after) === f, f + ' fertilises (click spent, block unchanged)');
  }
  // sapling stage 0 -> 1 only at nextFloat < 0.45
  let sA = 0;
  for (let seed = 1; seed <= 40; seed++) if (prop(use(st('oak_sapling', { stage: 0 }), { rnd: lcg(seed) }).after, 'stage') === '1') sA++;
  ok(sA > 5 && sA < 35, 'sapling advances on some seeds and not others (' + sA + '/40)');
  // dispenser behaviour: facing UP at a wheat cell
  cells.fill(0); W.poke(0, 11, 0, st('farmland')); W.poke(0, 12, 0, st('wheat', { age: 0 }));
  const e = { x: 0, y: 11, z: 0, items: [{ i: It.of('bone_meal'), n: 2, d: 0 }] };
  const hit = MCL.BlockEntities.DISPENSE_BEHAVIORS.bone_meal(e, 0, 'bone_meal', 0, lcg(3));
  ok(hit === true && e.items[0].n === 1 && +prop(W.getBlock(0, 12, 0), 'age') >= 2, 'dispenser bone meal grows the wheat in front and spends one');
  W.poke(0, 12, 0, st('wheat', { age: 7 }));
  const miss = MCL.BlockEntities.DISPENSE_BEHAVIORS.bone_meal(e, 0, 'bone_meal', 0, lcg(3));
  ok(miss === false && e.items[0].n === 1, 'dispenser keeps the item on a mature crop');
  return { pass, fails };
}

console.log('bonemealstatescheck -- #316 bone meal on the state-only Fertilizables, event 1505, dispenser');
const base = run();
let bad = base.fails.length;
base.fails.forEach((f) => console.log('  FAIL ' + f));
const mutants = [
  ['mature-crop gate removed', (f, t) => f === '14l_use.js' ? t.replace('if (ageNow >= ageMax) return false;', '') : t],
  ['cocoa grow dropped', (f, t) => f === '14l_use.js' ? t.replace("set(x, y, z, setProp(state, 'age', String(cage + 1)));", '') : t],
  ['bamboo sapling grow dropped', (f, t) => f === '14l_use.js' ? t.replace("set(x, y + 1, z, setProp(S.stateOf('bamboo'), 'leaves', 'small'));", '') : t],
  ['event 1505 dropped', (f, t) => f === '14l_use.js' ? t.replace('NS.Particle.worldEvent(1505, x, y, z, 0)', '0') : t],
];
let caught = 0;
for (const [label, p] of mutants) {
  const r = run(p);
  if (r.fails.length) { caught++; console.log('   ✓ caught: ' + label); } else console.log('  NOT CAUGHT: ' + label);
}
console.log(' assertions passed .. ' + base.pass);
console.log(' failures ........... ' + bad);
console.log(' breaks caught ...... ' + caught);
if (bad || caught !== mutants.length) process.exit(1);
