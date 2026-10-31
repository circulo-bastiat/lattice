#!/usr/bin/env node
// amphibiouscheck.mjs -- #9438: src/07zzzd_amphibious.js vs .decomp AmphibiousPathNodeMaker.java (+ LandPathNodeMaker.getPathNode/getFeetY).
// The oracle below is written from the decompiled methods over a seeded random world of air/water/stone cells and never calls the
// port. Anti-vacuity: each rule is broken in the port's source and the comparison must fail ('<n> breaks caught').
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

console.log('amphibiouscheck -- #9438, AmphibiousPathNodeMaker');
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js',
  '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07zzzd_amphibious.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const W = MCL.World, S = MCL.States, CH = MCL.CH, Ai = MCL.Ai, T = Ai.NodeType;
MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs; W.init(1); MCL.Behave.init(W); MCL.EntityList.init(); Ai.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const water = S.stateOf('water') | 0, stone = S.stateOf('stone') | 0;

// seeded world: 0 air, 1 water, 2 stone over x,z in 0..9, y 56..70
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const cell = {}; const key = (x, y, z) => x + ',' + y + ',' + z;
for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) for (let y = 56; y <= 70; y++) {
  const r = rnd(), k = y < 60 ? (r < 0.7 ? 2 : 1) : y < 64 ? (r < 0.15 ? 2 : r < 0.75 ? 1 : 0) : (r < 0.1 ? 2 : 0);
  cell[key(x, y, z)] = k; W.setBlock(x, y, z, k === 2 ? stone : k === 1 ? water : 0);
}
const kind = (x, y, z) => cell[key(x, y, z)];
// ---- oracle (decomp): getCommonNodeType for these three blocks, then getDefaultNodeType / getLandNodeType
const common = (x, y, z) => { const k = kind(x, y, z); return k === 0 ? 'OPEN' : k === 1 ? 'WATER' : 'BLOCKED'; };
const FACES = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
const oracleType = (x, y, z) => {
  const c = common(x, y, z);
  if (c === 'WATER') return FACES.some(([a, b, d]) => common(x + a, y + b, z + d) === 'BLOCKED') ? 'WATER_BORDER' : 'WATER';
  if (c === 'OPEN') return common(x, y - 1, z) === 'BLOCKED' ? 'WALKABLE' : 'OPEN';   // getLandNodeType: below not OPEN/WALKABLE/WATER/LAVA
  return 'BLOCKED';
};
const NAME = Object.fromEntries(Object.entries(T).map(([n, v]) => [v, n]));
// Land WALKABLE reads neighbours (water beside -> WATER_BORDER); the oracle applies fromNeighbors for the 8 horizontal + vertical cells
const oracleLand = (x, y, z) => {
  const t = oracleType(x, y, z);
  if (t !== 'WALKABLE') return t;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dz) continue; if (common(x + dx, y + dy, z + dz) === 'WATER') return 'WATER_BORDER';
  }
  return t;
};

const e0 = { x: 4.5, y: 62, z: 4.5, width: 0.75, height: 0.42, stepHeight: 0.6, type: 'axolotl', inWater: true };
function cases(A) {
  const bad = [];
  for (let x = 1; x < 9; x++) for (let z = 1; z < 9; z++) for (let y = 58; y < 69; y++) {
    const got = NAME[A.defaultNodeType(x, y, z)], want = oracleLand(x, y, z);
    if (got !== want) { bad.push('type ' + key(x, y, z) + ' ' + got + '!=' + want); if (bad.length > 3) return bad; }
  }
  // maluses: init overrides, clear restores the pre-init values
  const e = Object.assign({}, e0), before = [T.WALKABLE, T.WATER_BORDER, T.WATER].map((t) => Ai.pathPenalty(e, t));
  A.init(e, true);
  const during = [T.WATER, T.WALKABLE, T.WATER_BORDER].map((t) => Ai.pathPenalty(e, t));
  if (during.join() !== '0,6,4') bad.push('malus ' + during);
  A.clear(e);
  const after = [T.WALKABLE, T.WATER_BORDER, T.WATER].map((t) => Ai.pathPenalty(e, t));
  if (after[0] !== before[0] || after[1] !== before[1]) bad.push('clear ' + after + ' vs ' + before);
  // start / target nodes: floor(minY + 0.5), floor(y + 0.5)
  const e2 = Object.assign({}, e0, { x: 3.5, y: 61.5, z: 6.5 }), st = A.getStart(e2), tg = A.getTarget(2.2, 61.5, 7.9);
  if (st.y !== 62 || st.x !== 3 || st.z !== 6) bad.push('start ' + JSON.stringify(st));
  if (tg.x !== 2 || tg.y !== 62 || tg.z !== 7) bad.push('target ' + JSON.stringify(tg));
  const tg2 = A.getTarget(2.2, 61.4, 7.9); if (tg2.y !== 61) bad.push('target round-down ' + tg2.y);
  // feet Y: in water y + 0.5
  if (A.feetY(Object.assign({}, e0, { inWater: true }), 4, 61, 4) !== 61.5) bad.push('feetY water');
  // vertical successors in a prepared water column (stone ring) with the mob wet
  for (let y = 40; y <= 60; y++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    cell[key(30 + dx, y, 30 + dz)] = 2; W.setBlock(30 + dx, y, 30 + dz, stone); }
  for (let y = 44; y <= 58; y++) { cell[key(30, y, 30)] = 1; W.setBlock(30, y, 30, water); }
  const e3 = Object.assign({}, e0, { x: 30.5, y: 50, z: 30.5 }); A.init(e3, true);
  const mid = A.verticalSuccessors(e3, { x: 30, y: 50, z: 30, penalty: 0 }, 63);
  if (mid.length !== 2 || mid[0].y !== 51 || mid[1].y !== 49) bad.push('vertical mid ' + JSON.stringify(mid.map((n) => n.y)));
  // WATER_BORDER (stone ring) malus 4; deep (y < 63-10 = 53) +1 only for WATER type, none here -> 4 each
  if (mid.length === 2 && (mid[0].penalty !== 4 || mid[1].penalty !== 4)) bad.push('vertical malus ' + mid.map((n) => n.penalty));
  // open the ring so WATER (malus 0) sits deep: deep water penalty +1, shallow not
  const deep = A.pathNode(e3, 30, 49, 30, 1, 50.5, T.WATER); if (deep) { deep.penalty += 0; }
  e3.amphPenalizeDeep = true;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = 47; y <= 52; y++) { cell[key(30 + dx, y, 30 + dz)] = 1; W.setBlock(30 + dx, y, 30 + dz, water); }
  const dw = A.verticalSuccessors(e3, { x: 30, y: 50, z: 30, penalty: 0 }, 63);
  if (dw.length !== 2 || dw[0].penalty !== 1 || dw[1].penalty !== 1) bad.push('deep penalty ' + dw.map((n) => n.type + ':' + n.penalty));   // y=51,49 < 53 -> WATER 0 + 1
  const e4 = Object.assign({}, e3); e4.amphPenalizeDeep = false;
  const sh = A.verticalSuccessors(e4, { x: 30, y: 50, z: 30, penalty: 0 }, 63);
  if (sh.some((n) => n.penalty !== 0)) bad.push('no-deep penalty ' + sh.map((n) => n.penalty));
  // trapdoor/down rule: a mob standing in a TRAPDOOR-typed cell gets no downward node (stubbed type)
  const real = A.nodeType; A.nodeType = (e, x, y, z) => (y === 50 ? T.TRAPDOOR : real(e, x, y, z));
  const td = A.verticalSuccessors(e3, { x: 30, y: 50, z: 30, penalty: 0 }, 63); A.nodeType = real;
  if (td.some((n) => n.y === 49)) bad.push('trapdoor down');
  return bad;
}
const SRC = join(MCLITE_ROOT, 'src', '07zzzd_amphibious.js');
const orig = readFileSync(SRC, 'utf8');
const load = (src) => { new Function('MCL', src)(MCL); return MCL.Amphibious; };
const base = cases(load(orig));
ok(base.length === 0, 'port matches oracle: ' + base.join('; '));
const edits = [
  ['border neighbour test', "=== T.BLOCKED) return T.WATER_BORDER;", "=== T.OPEN) return T.WATER_BORDER;"],
  ['walkable malus', "[T.WALKABLE, 6]", "[T.WALKABLE, 0]"],
  ['start y rounding', "y: floor(e.y + 0.5), z: floor(e.z - w)", "y: floor(e.y), z: floor(e.z - w)"],
  ['target y rounding', "y: floor(y + 0.5), z: floor(z) }; };", "y: floor(y), z: floor(z) }; };"],
  ['deep penalty', "p.y < sea - 10", "p.y < sea - 100"],
  ['feet y in water', "return y + 0.5;", "return y;"],
  ['trapdoor down', "here !== T.TRAPDOOR", "true"],
  ['clear restore', "e.pathMalus[T.WALKABLE] = s.old[T.WALKABLE];", ""],
];
for (const [name, from, to] of edits) {
  if (!orig.includes(from)) { fails.push('break target missing: ' + name); continue; }
  breaks++;
  const r = cases(load(orig.replace(from, to)));
  if (r.length) console.log('   ✓ caught: ' + name + ' (' + r[0] + ')'); else { breaks--; fails.push('break NOT caught: ' + name); }
}
load(orig);
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const x of fails) console.log('   ✗ ' + x);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
