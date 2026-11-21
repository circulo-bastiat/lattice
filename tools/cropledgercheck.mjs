#!/usr/bin/env node
// cropledgercheck.mjs -- #10808: ONE table-driven acceptance check across all 14 growers (wheat, carrots, potatoes,
// beetroots, melon/pumpkin stem, sugar cane, cactus, bamboo, cocoa, nether wart, sweet berries, sapling).
// Per grower, from .decomp CropBlock/StemBlock/SugarCaneBlock/CactusBlock/BambooBlock/CocoaBlock/NetherWartBlock/SweetBerryBushBlock/SaplingBlock:
//   moist  hydrated farmland matures in FEWER ticks than dry (comparison, D-291) - crops and stems only
//   light  the base-light gate: vanilla is `>= 9` (CropBlock/StemBlock/Bamboo/SweetBerry/Sapling), so 9 grows and 8 does NOT
//          (the issue text says "8 grows, 7 does not"; the decomp, and farmgrow, say 9/8) - and the ungated ones grow at light 0
//   bone   bone meal advances an immature grower and spends one; a mature one is not fertilizable (item kept);
//          cane/cactus/nether wart are not Fertilizable at all
//   tree   a bone-mealed sapling makes exactly the Features.growSapling feature (same rng -> same blocks)
// Anti-vacuity: each break edits the REAL source text and must turn its row red; prints "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
  '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14f_inventory.js', '07zv_villagerbrain.js', '14l_use.js'];
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// the table: ground / props / support under which each grower is planted, what "progress" means, and which rules apply
const num = (E, s, p) => { const v = E.S.propValue(s, E.R.PROP[p]); return v < 0 ? 0 : +E.R.valueNames[v]; };
const age = (E, s) => num(E, s, 'age');
const GROWERS = [
  { n: 'wheat', ground: ['farmland', { moisture: 7 }], moist: true, gate: true, target: 3, prog: (E, s) => age(E, s), bone: 'age' },
  { n: 'carrots', ground: ['farmland', { moisture: 7 }], moist: true, gate: true, target: 3, prog: (E, s) => age(E, s), bone: 'age' },
  { n: 'potatoes', ground: ['farmland', { moisture: 7 }], moist: true, gate: true, target: 3, prog: (E, s) => age(E, s), bone: 'age' },
  { n: 'beetroots', ground: ['farmland', { moisture: 7 }], moist: true, gate: true, target: 3, prog: (E, s) => age(E, s), bone: 'age' },
  { n: 'melon_stem', ground: ['farmland', { moisture: 7 }], moist: true, gate: true, target: 3, prog: (E, s) => age(E, s), bone: 'age' },
  { n: 'pumpkin_stem', ground: ['farmland', { moisture: 7 }], moist: true, gate: true, target: 3, prog: (E, s) => age(E, s), bone: 'age' },
  { n: 'sugar_cane', ground: ['sand'], gate: false, target: 1, col: true, prog: (E, s) => age(E, s), bone: 'none' },
  { n: 'cactus', ground: ['sand'], gate: false, target: 1, col: true, prog: (E, s) => age(E, s), bone: 'none' },
  { n: 'nether_wart', ground: ['soul_sand'], gate: false, target: 1, prog: (E, s) => age(E, s), bone: 'none' },
  { n: 'cocoa', ground: ['stone'], props: { facing: 'south' }, support: [0, 1, 'jungle_log'], gate: false, target: 1, prog: (E, s) => age(E, s), bone: 'age', matureAge: 2 },
  { n: 'sweet_berry_bush', ground: ['grass_block'], gate: true, above: true, target: 1, prog: (E, s) => age(E, s), bone: 'age', matureAge: 3 },
  { n: 'bamboo_sapling', ground: ['grass_block'], gate: true, above: true, target: 1, bam: true, bone: 'bam' },
  { n: 'oak_sapling', ground: ['grass_block'], gate: true, above: true, target: 1, sap: true, bone: 'sap' },
];
// bamboo (the stalk) is the 14th: its own rule is the sapling column; covered through bamboo_sapling -> bamboo above and 'bamboo' row
GROWERS.push({ n: 'bamboo', ground: ['grass_block'], props: { stage: 0 }, gate: true, above: true, target: 1, bamStalk: true, bone: 'bamboo' });

function build(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const R = M.Reg, S = M.States, B = M.Behave, U = M.Use;
  let cells = new Map(), light = 15;
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const W = {
    getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0,
    setBlock(x, y, z, s) { cells.set(key(x, y, z), s); if (B.ready) B.changed(x, y, z); return true; },
    blockLightAt: () => light,
  };
  M.World = W; B.init(W); M.BlockEntities.init(); B.clearSchedule(); M.Redstone.init();
  M.Entities.init(); M.EntityList.init(); U.init(W);
  M.Particle = { worldEvent: () => 0 }; M.Sound = { play: () => true };
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const st = (name, props) => { let s = S.stateOf(name); for (const k in props || {}) s = B.setProp(s, k, String(props[k])); return s; };
  const is = (s, name) => s !== 0 && S.block[s] === R.id[name];
  return { M, R, S, B, U, W, st, is, reset(l) { cells = new Map(); light = l === undefined ? 15 : l; } };
}

const GY = 4, SPEED = 256;
const GRID = []; for (let gx = 0; gx < 6; gx++) for (let gz = 0; gz < 6; gz++) GRID.push([gx * 2, gz * 2]);
const WATER = [[3, 3], [3, 7], [7, 3], [7, 7]];

function plant(E, g, water) {
  for (const [x, z] of GRID) {
    E.W.setBlock(x, GY, z, E.st(g.ground[0], g.ground[1]));
    if (g.support) E.W.setBlock(x + g.support[0], GY + 1, z + g.support[1], E.st(g.support[2]));
    E.W.setBlock(x, GY + 1, z, E.st(g.n === 'bamboo' ? 'bamboo' : g.n, g.props));
  }
  if (water) for (const [x, z] of WATER) E.W.setBlock(x, GY, z, E.st('water'));
}
// progress of one plant cell: sapling -> stage 1 or gone, bamboo sapling -> a bamboo above, column -> age or a block above
function progressed(E, g, x, z) {
  const s = E.W.getBlock(x, GY + 1, z);
  if (g.sap) return !E.is(s, g.n) || num(E, s, 'stage') === 1 ? 1 : 0;
  if (g.bam) return E.is(E.W.getBlock(x, GY + 2, z), 'bamboo') || E.is(s, 'bamboo') ? 1 : 0;
  if (g.bamStalk) return E.W.getBlock(x, GY + 2, z) !== 0 ? 1 : 0;
  if (g.col && E.W.getBlock(x, GY + 2, z) !== 0) return g.target;
  return E.is(s, g.n) ? g.prog(E, s) : 0;
}
function ticks(E, g, { light, water, T = 4000, seed = 3, target }) {
  E.reset(light); plant(E, g, water);
  const rnd = seeded(seed), done = new Array(GRID.length).fill(-1);
  const tgt = target === undefined ? g.target : target;
  for (let t = 1; t <= T && done.includes(-1); t++) {
    E.B.randomTickSection(0, 0, 0, rnd, SPEED);
    GRID.forEach(([x, z], k) => { if (done[k] < 0 && progressed(E, g, x, z) >= tgt) done[k] = t; });
  }
  const d = done.filter((v) => v >= 0);
  return { n: d.length, mean: d.length ? d.reduce((a, b) => a + b, 0) / d.length : Infinity };
}

function lcg(seed) { let s = Math.imul(seed + 1, 2654435761) >>> 0; s = (Math.imul(s ^ (s >>> 15), 2246822519) >>> 0); return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const UP = (E) => [0, 1, 2, 3, 4, 5].find((f) => E.M.CFG.FACE_DY[f] === 1);
function useBone(E, g, props, seed) {
  E.reset(15);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) E.W.setBlock(x, 9, z, E.st('stone'));
  E.W.setBlock(0, 10, 0, E.st(g.ground[0], g.ground[1]));
  if (g.support) E.W.setBlock(g.support[0], 11 + g.support[1] - 1 + 0, g.support[1] ? 0 + g.support[0] : 0, E.st(g.support[2]));
  const s0 = E.st(g.n === 'bamboo' ? 'bamboo' : g.n, props);
  E.W.setBlock(0, 11, 0, s0);
  const P = { instabuild: false, inventory: null, slot: 0, syncHotbar() {}, heldItem() { return this._s; } };
  P._s = { i: E.M.Items.of('bone_meal'), n: 3, d: 0 };
  E.M.EntityList.random = lcg(seed);
  const res = E.U.itemUseOn(P, 0, 11, 0, UP(E), E.W.getBlock(0, 11, 0), P._s);
  return { res, n: P._s.n, s0, after: E.W.getBlock(0, 11, 0), above: E.W.getBlock(0, 12, 0) };
}

function rows(patch) {
  const E = build(patch);
  const r = {}, msg = {};
  const put = (k, c, m) => { r[k] = c; msg[k] = m; };
  for (const g of GROWERS) {
    if (g.moist) {
      const wet = ticks(E, g, { water: true }), dry = ticks(E, { ...g, ground: ['farmland', { moisture: 0 }] }, {});
      put(g.n + ':moist', wet.n === GRID.length && dry.n === GRID.length && wet.mean < dry.mean, `${g.n}: hydrated matures faster than dry (${wet.mean.toFixed(0)} < ${dry.mean.toFixed(0)})`);
    }
    if (g.gate) {
      const l9 = ticks(E, g, { light: 9, water: !!g.moist, T: 6000 }), l8 = ticks(E, g, { light: 8, water: !!g.moist, T: 1500 });
      put(g.n + ':light', l9.n > 0 && l8.n === 0, `${g.n}: base light 9 grows (${l9.n}/${GRID.length}), 8 does not (${l8.n})`);
    } else {
      const l0 = ticks(E, g, { light: 0, T: 6000 });
      put(g.n + ':dark', l0.n > 0, `${g.n}: ungated, grows at light 0 (${l0.n}/${GRID.length})`);
    }
    if (g.bone === 'age') {
      let adv = 0, spent = true, capped = true;
      for (let seed = 1; seed <= 30; seed++) {
        const b = useBone(E, g, { ...g.props, age: 0 }, seed), a = b.res ? age(E, b.after) : 0;
        if (b.res && a > 0) adv++;
        if (b.res && b.n !== 2) spent = false;
        if (!b.res || a > (g.matureAge === 3 ? 3 : g.matureAge === 2 ? 2 : g.n === 'beetroots' ? 3 : 5)) capped = false;
      }
      const m = useBone(E, g, { ...g.props, age: g.matureAge || (g.n === 'beetroots' ? 3 : 7) }, 1);
      put(g.n + ':bone', adv > 0 && spent && capped && !m.res && m.n === 3 && m.after === m.s0,
        `${g.n}: bone meal advances an immature crop (${adv}/30), spends one, a mature one is refused and kept`);
    } else if (g.bone === 'none') {
      const m = useBone(E, g, { ...g.props, age: 0 }, 1);
      put(g.n + ':bone', !m.res && m.n === 3 && m.after === m.s0, `${g.n}: not Fertilizable - bone meal changes nothing`);
    } else if (g.bone === 'bam') {
      const b = useBone(E, g, {}, 1);
      put(g.n + ':bone', b.res && b.n === 2 && E.is(b.above, 'bamboo'), `bamboo sapling: bone meal makes a bamboo above`);
    } else if (g.bone === 'bamboo') {
      const b = useBone(E, g, { stage: 0 }, 1);
      put(g.n + ':bone', b.res && E.is(b.above, 'bamboo'), `bamboo: bone meal adds stalks above`);
    } else if (g.bone === 'sap') {
      let adv = 0;
      for (let seed = 1; seed <= 40; seed++) { const b = useBone(E, g, { stage: 0 }, seed); if (b.res && num(E, b.after, 'stage') === 1) adv++; }
      put(g.n + ':bone', adv > 0 && adv < 40, `${g.n}: bone meal stage 0 -> 1 about 45% of clicks (${adv}/40)`);
    }
  }
  // the sapling's tree is the Features.growSapling feature, not a second generator
  const F = E.M.Features;
  const mkRng = (a) => new E.M.Carvers.Rng(a, a * 31 + 7, 99);
  const dirt = E.st('dirt');
  let same = 0, trials = 0, mism = [];
  for (let seed = 1; seed <= 8; seed++) {
    const kind = ['oak', 'birch', 'spruce', 'jungle', 'acacia'][seed % 5];
    const mk = () => { const m = new Map(); return { m, getBlock: (x, y, z) => (m.has(x + ',' + y + ',' + z) ? m.get(x + ',' + y + ',' + z) : (y < 64 ? dirt : 0)), setBlock: (x, y, z, s) => { m.set(x + ',' + y + ',' + z, s); return true; } }; };
    const sap = E.st(kind + '_sapling', { stage: 1 });
    // path A: the player's bone meal at (0,64,0): one draw for the 45% roll, then Behave.growTree's three seeds
    const wa = mk(); wa.setBlock(0, 64, 0, sap); E.M.World = wa; E.B.init(wa); E.U.init(wa);
    const rA = lcg(seed);
    const rollRng = lcg(seed);
    const P = { instabuild: false, inventory: null, slot: 0, syncHotbar() {}, heldItem() { return this._s; } };
    // find a draw sequence whose first value passes the 45% roll
    let rr = null; for (let k = 0; k < 400 && !rr; k++) { const t = lcg(seed * 1000 + k); if (t() < 0.45) rr = k; }
    const mkR = () => lcg(seed * 1000 + rr);
    P._s = { i: E.M.Items.of('bone_meal'), n: 2, d: 0 };
    wa.setBlock(0, 63, 0, E.st('grass_block'));
    E.M.EntityList.random = mkR();
    E.U.itemUseOn(P, 0, 64, 0, UP(E), wa.getBlock(0, 64, 0), P._s);
    // path B: the feature straight, same seeds
    const wb = mk(); wb.setBlock(0, 64, 0, sap); wb.setBlock(0, 63, 0, E.st('grass_block'));
    const q = mkR(); q();
    const rg = new E.M.Carvers.Rng((q() * 4294967296) | 0, (q() * 4294967296) | 0, (q() * 4294967296) | 0);
    F.growSapling(wb, 0, 64, 0, sap, rg);
    trials++;
    const ka = [...wa.m].sort().join(';'), kb = [...wb.m].sort().join(';');
    if (ka === kb && wa.m.size > 5) same++; else mism.push(kind + '#' + seed + ' ' + wa.m.size + '/' + wb.m.size);
  }
  put('sapling:tree', same === trials, `bone-mealed sapling == Features.growSapling blocks (${same}/${trials}${mism.length ? ' ' + mism.join(',') : ''})`);
  E.M.World = E.W; E.B.init(E.W); E.U.init(E.W);
  return { r, msg };
}

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const base = rows(null);
if (process.env.DBG) console.log(JSON.stringify(base.r));
for (const k of Object.keys(base.r)) { ok(base.r[k], base.msg[k]); }
console.log(`   ${Object.keys(base.r).length} rows over ${GROWERS.length} growers + the sapling tree`);

const BREAKS = [
  ['moisture term removed from getAvailableMoisture', 'wheat:moist', [/if \(prop\(st, P\.moisture\) >= 0 && \+R\.valueNames\[prop\(st, P\.moisture\)\] > 0\) f1 = 3;/, '']],
  ['crop light gate lowered to 8', 'carrots:light', [/if \(w\.baseLight\(x, y, z\) < 9\) return false;    \/\/ CropBlock/, 'if (w.baseLight(x, y, z) < 8) return false;    // CropBlock']],
  ['cocoa given a light gate', 'cocoa:dark', [/function tickCocoa\(x, y, z, st, rnd\) \{/, 'function tickCocoa(x, y, z, st, rnd) { if (w.baseLight(x, y, z) < 9) return false;']],
  ['sugar cane never wraps its age', 'sugar_cane:dark', [/if \(age < 15\) \{ w\.set\(x, y, z, B\.setProp\(st, 'age', age \+ 1\)\); return true; \}/, 'if (age < 15) { return false; }']],
  ['bone meal ignores sweet berries (block-name lookup by state id)', 'sweet_berry_bush:bone', [/pn = R\.names\[S\.block\[state\]\], plant =/, 'pn = R.names[state], plant =']],
  ['bone meal grows a mature crop', 'wheat:bone', [/if \(ageNow >= ageMax\) return false;/, '']],
  ['bone meal sapling uses a separate tree generator', 'sapling:tree', [/return B\.world \? F\.growSapling\(B\.world, x, y, z, st, r\) : false;/, 'return B.world ? (B.world.setBlock(x, y, z, 0), B.world.setBlock(x, y + 1, z, 1), true) : false;']],
];
for (const [name, row, patch] of BREAKS) {
  breaks++;
  const rec = [patch[0], patch[1]];
  let caught;
  try {
    let hit = false;
    const res = rows((f, src) => { const out = src.replace(rec[0], rec[1]); if (out !== src) hit = true; return out; });
    if (!hit) throw new Error('break did not match any source: ' + rec[0]);
    caught = res.r[row] === false;
  } catch (e) { fails.push(`break "${name}": ${e.message}`); continue; }
  if (ok(caught, `anti-vacuity: ${name} does not turn "${row}" red`)) console.log('   ✓ break caught: ' + name);
}
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ✗ ' + f)); }
else for (const k of Object.keys(base.msg)) console.log('   ' + base.msg[k]);
console.log(`cropledgercheck: ${pass} assertions, ${fails.length} failures, ${breaks - fails.filter((f) => /anti-vacuity|break "/.test(f)).length} breaks caught`);
process.exit(fails.length ? 1 : 0);
