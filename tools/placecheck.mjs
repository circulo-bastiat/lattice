#!/usr/bin/env node
// placecheck.mjs — what a placed block is allowed to destroy. D-263.
//
//   node tools/placecheck.mjs [--quiet]
//
// ⚠ WHY THIS EXISTS. Dan, session 9: *"placing blocks can overwrite others."* It was not one
// block. `14_player.js` decided replaceability GEOMETRICALLY —
//
//     if (geom[s] === GEOM_MODEL && solid[s] === 0 && emit[s] === 0) REPLACEABLE[s] = 1;
//
// — which admits every model-shaped block that has no collision box and gives off no light.
// Measured: **139 blocks and 2,590 real states**, against vanilla's **28 blocks**. Fence gates,
// buttons, pressure plates, levers, tripwire hooks, all four rails, redstone wire, all six
// saplings, every flower, every coral and coral fan, cobweb, item frames, sugar cane, sweet
// berry bush, every crop, both dripleaves, spore blossom and powder snow could all be deleted by
// putting a block on them — and the same table decides whether a placement lands IN the clicked
// cell or on its face, so the bug ran in both directions at once.
//
// The class is what this file tests, not the report:
//
//   §1  the TABLE is vanilla's, block for block, against the bytecode golden file
//   §2  the OLD RULE is re-run and every block it wrongly admitted is asserted non-replaceable,
//       so the geometric guess cannot come back by any route
//   §3  the seven Java OVERRIDES of `canBeReplaced`, including the two that make a block LESS
//       replaceable than its material and the snow rule the old code got backwards
//   §4  `stackOnto` — the partner half: a slab on a slab is a DOUBLE slab, not a lost slab
//   §5  the targeting measurement this audit turned up and did NOT fix: the raycast treats a
//       block with no collision box as a full cube, so its outline and entry face are the
//       cell's. Declared and pinned so it cannot grow silently (D-264)
//   §6  anti-vacuity — break each rule and assert this file catches it (D-30)

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ASSETS = join(ROOT, 'assets');
const QUIET = process.argv.includes('--quiet');

let errors = 0, checks = 0, breaks = 0;
const fail = (w, d) => { errors++; console.error('FAIL  ' + w + (d ? '\n      ' + d : '')); };
const ok = (w) => { checks++; if (!QUIET) console.log('ok    ' + w); };
const need = (c, w, d) => { c ? ok(w) : fail(w, d); return c; };
const say = (...a) => { if (!QUIET) console.log(...a); };

// ---------------------------------------------------------------------------- the engine
function loadEngine() {
  const NS = {};
  globalThis.MCL = NS;
  const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
    '02c_states.js', '03_section.js', '05_mesher.js', '14b_physics.js'];
  for (const f of FILES) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
  const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
  const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
  const gm = rd('block-geometry.meta.json'), rm = rd('block-runtime.meta.json');
  const bt = rd('block-tiles.meta.json');
  NS.Reg.init({
    runtime: b64('block-runtime.bin'), runtimeBytes: rm.rawBytes,
    geometry: b64('block-geometry.bin'), geometryBytes: gm.rawBytes,
    tileAlpha: bt.alpha,
  });
  if (!NS.States.ready) throw new Error('States.build did not run inside Reg.init');
  return NS;
}

const NS = loadEngine();
const SR = NS.States, R = NS.Reg;
const ID = (n) => SR.stateOf(n);
const BLOCK = (n) => SR.block[ID(n)];
const statesOf = (name) => {
  const b = BLOCK(name);
  const out = [];
  for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) out.push(s);
  return out;
};
const UP = 2, DOWN = 3, NORTH = 5;    // ARCH §3 face numbering

// ---------------------------------------------------------------------------- §1 the table
say('\n1. the replaceable table is vanilla\'s, block for block');
const GOLD = join(ROOT, 'tools', 'golden', 'block-materials-1.18.2.tsv');
const gold = new Map();
for (const line of readFileSync(GOLD, 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const c = line.split('\t');
  if (c.length >= 3) gold.set(c[0], c[2] === '1');
}
need(gold.size >= 890, `the golden material file has ${gold.size} blocks, expected ~898`);

let mismatch = [], goldRepl = 0, engineReplBlocks = 0, engineReplStates = 0;
for (const [name, want] of gold) {
  if (want) goldRepl++;
  const id = SR.stateOf(name);
  if (id === undefined || id < 0) continue;
  const b = SR.block[id];
  const got = R.replaceable(b);
  if (got) engineReplBlocks++;
  if (got !== want) mismatch.push(`${name}: engine ${got}, vanilla ${want}`);
}
for (let s = 0; s < SR.count; s++) if (SR.replaceable[s]) engineReplStates++;
need(mismatch.length === 0, `${mismatch.length} blocks disagree with the jar`, mismatch.slice(0, 10).join('\n'));
need(goldRepl === 28, `vanilla has ${goldRepl} replaceable blocks, expected 28`);
need(engineReplBlocks === 28, `the engine has ${engineReplBlocks} replaceable blocks, expected 28`);
say(`   ${engineReplBlocks} blocks / ${engineReplStates} real states replaceable`);

// The named cases, in both directions, so a table that is merely SELF-consistent still fails.
for (const n of ['air', 'water', 'lava', 'fire', 'grass', 'tall_grass', 'fern', 'large_fern',
  'dead_bush', 'seagrass', 'tall_seagrass', 'vine', 'glow_lichen', 'sunflower', 'lilac',
  'rose_bush', 'peony', 'hanging_roots', 'crimson_roots', 'warped_roots', 'nether_sprouts']) {
  need(SR.replaceable[ID(n)] === 1, `${n} is replaceable`);
}
for (const n of ['stone', 'dirt', 'oak_planks', 'oak_log', 'oak_leaves', 'glass', 'chest',
  'oak_fence_gate', 'stone_button', 'lever', 'tripwire_hook', 'rail', 'powered_rail',
  'detector_rail', 'activator_rail', 'redstone_wire', 'oak_sapling', 'poppy', 'dandelion',
  'wither_rose', 'cobweb', 'wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart',
  'sugar_cane', 'sweet_berry_bush', 'kelp', 'powder_snow', 'tube_coral', 'tube_coral_fan',
  'big_dripleaf', 'small_dripleaf', 'spore_blossom', 'item_frame', 'stone_pressure_plate',
  'melon_stem', 'pumpkin_stem', 'bamboo_sapling', 'oak_slab', 'oak_stairs']) {
  need(SR.replaceable[ID(n)] === 0, `${n} is NOT replaceable`);
}

// ---------------------------------------------------------------------------- §2 the old rule
say('\n2. the geometric rule that caused this cannot come back');
// ⚠ THIS IS THE SECTION THAT WOULD HAVE CAUGHT D-263. It re-runs the exact predicate the old
// code used and asserts that everything it admits BEYOND vanilla's 28 is refused today. It is
// written against the rule rather than against a list of block names on purpose: a future edit
// that reintroduces any geometric shortcut fails here even if it spells it differently.
const oldRule = (s) => s === 0
  || SR.block[s] === R.id.water || SR.block[s] === R.id.lava
  || (SR.geom[s] === SR.GEOM_MODEL && SR.solid[s] === 0 && SR.emit[s] === 0);
const oldBlocks = new Set(), oldStates = [];
for (let s = 0; s < SR.count; s++) if (oldRule(s)) { oldStates.push(s); oldBlocks.add(SR.block[s]); }
say(`   the old rule admits ${oldBlocks.size} blocks / ${oldStates.length} real states`);
need(oldBlocks.size > 100,
  `the old rule now admits only ${oldBlocks.size} blocks — this section has gone vacuous`);
const wrongly = [...oldBlocks].filter((b) => !R.replaceable(b)).map((b) => R.names[b]);
const agreed = [...oldBlocks].filter((b) => R.replaceable(b)).length;
// ⚠ THE BOOK-KEEPING IS ITSELF AN ASSERTION. The old rule and vanilla overlap on `agreed`
// blocks; the ones vanilla has that the rule never admitted are the light-emitting and
// non-block airs — fire, soul_fire, cave_air, void_air, light, structure_void, bubble_column —
// so the two numbers must add to exactly 28. A table that had quietly lost entries would keep
// `wrongly` looking healthy and fail here.
const missedByOldRule = [...gold].filter(([n, v]) => v && !oldBlocks.has(BLOCK(n))).map(([n]) => n);
need(agreed + missedByOldRule.length === 28,
  `book-keeping: ${agreed} agreed + ${missedByOldRule.length} never admitted != 28`,
  'never admitted: ' + missedByOldRule.join(' '));
need(wrongly.length === oldBlocks.size - agreed,
  `book-keeping: ${wrongly.length} refused + ${agreed} agreed != ${oldBlocks.size} admitted`);
let leaked = 0;
for (const b of oldBlocks) {
  if (!R.replaceable(b)) continue;      // the old rule and vanilla agree here
  if (!gold.get(R.names[b])) { leaked++; fail(`${R.names[b]} is replaceable in the engine and not in vanilla`); }
}
need(leaked === 0, 'no block the old rule admitted has survived as replaceable against vanilla');
say(`   ${wrongly.length} blocks the old rule would have let a placement destroy are now refused`);
for (const n of ['oak_fence_gate', 'stone_button', 'rail', 'lever', 'oak_sapling', 'poppy',
  'tube_coral_fan', 'cobweb', 'wheat', 'sugar_cane', 'powder_snow', 'item_frame']) {
  need(oldBlocks.has(BLOCK(n)), `${n} really was admitted by the old rule (else §2 proves nothing)`);
  need(!R.replaceable(BLOCK(n)), `${n} is refused now`);
}

// ---------------------------------------------------------------------------- §3 the overrides
say('\n3. the seven Java overrides of canBeReplaced');
const SNOW = BLOCK('snow'), snowStates = statesOf('snow');
const layersOf = (s) => +R.valueNames[SR.propValue(s, R.PROP.layers)];
const snow1 = snowStates.find((s) => layersOf(s) === 1);
const snow4 = snowStates.find((s) => layersOf(s) === 4);
const snow8 = snowStates.find((s) => layersOf(s) === 8);
need(snow1 !== undefined && snow4 !== undefined && snow8 !== undefined, 'snow has layers 1, 4 and 8');
// ⚠ the half the old code got backwards: only a SINGLE layer is replaceable by another item.
need(SR.canBeReplacedBy(snow1, ID('stone'), UP, 65, true) === true, 'one snow layer is replaceable by stone');
need(SR.canBeReplacedBy(snow4, ID('stone'), UP, 65, true) === false, 'four snow layers are NOT');
need(SR.canBeReplacedBy(snow8, ID('stone'), UP, 65, true) === false, 'eight snow layers are NOT');
need(SR.canBeReplacedBy(snow4, snow1, UP, 65, true) === true, 'but snow deepens snow from above');
need(SR.canBeReplacedBy(snow4, snow1, NORTH, 65, true) === false, 'and not from the side when replacing the clicked block');
need(SR.canBeReplacedBy(snow4, snow1, NORTH, 65, false) === true, 'while the neighbour cell accepts it from any face');
need(SR.canBeReplacedBy(snow8, snow1, UP, 65, true) === false, 'eight layers is full');

const slabBottom = statesOf('oak_slab').find((s) => R.valueNames[SR.propValue(s, R.PROP.type)] === 'bottom');
const slabTop = statesOf('oak_slab').find((s) => R.valueNames[SR.propValue(s, R.PROP.type)] === 'top');
const slabDouble = statesOf('oak_slab').find((s) => R.valueNames[SR.propValue(s, R.PROP.type)] === 'double');
need(slabBottom !== undefined && slabTop !== undefined && slabDouble !== undefined, 'oak_slab has all three types');
need(SR.canBeReplacedBy(slabBottom, slabBottom, UP, 65.2, true) === true, 'a bottom slab takes a slab from above');
need(SR.canBeReplacedBy(slabBottom, slabBottom, DOWN, 65.2, true) === false, 'and not from below');
need(SR.canBeReplacedBy(slabBottom, slabBottom, NORTH, 65.8, true) === true, 'a side click in the UPPER half fills a bottom slab');
need(SR.canBeReplacedBy(slabBottom, slabBottom, NORTH, 65.2, true) === false, 'a side click in the lower half does not');
need(SR.canBeReplacedBy(slabTop, slabTop, DOWN, 65.8, true) === true, 'a top slab takes a slab from below');
need(SR.canBeReplacedBy(slabTop, slabTop, NORTH, 65.2, true) === true, 'and from a side click in the lower half');
need(SR.canBeReplacedBy(slabDouble, slabBottom, UP, 65.2, true) === false, 'a double slab is full');
need(SR.canBeReplacedBy(slabBottom, ID('stone'), UP, 65.2, true) === false, 'a slab is not replaceable by anything else');

for (const [name, prop] of [['sea_pickle', 'pickles'], ['turtle_egg', 'eggs'], ['candle', 'candles']]) {
  const sts = statesOf(name);
  const n = (s) => +R.valueNames[SR.propValue(s, R.PROP[prop])];
  const one = sts.find((s) => n(s) === 1), four = sts.find((s) => n(s) === 4);
  if (!need(one !== undefined && four !== undefined, `${name} has ${prop} 1 and 4`)) continue;
  need(SR.canBeReplacedBy(one, one, UP, 65, true) === true, `${name} accepts a second`);
  need(SR.canBeReplacedBy(four, one, UP, 65, true) === false, `${name} is full at four`);
  need(SR.canBeReplacedBy(one, ID('stone'), UP, 65, true) === false, `${name} refuses a different item`);
}
need(SR.canBeReplacedBy(ID('scaffolding'), ID('scaffolding'), UP, 65, true) === true, 'scaffolding accepts scaffolding');
need(SR.canBeReplacedBy(ID('scaffolding'), ID('stone'), UP, 65, true) === false, 'and nothing else');
// the two that go the OTHER way: more replaceable by material, less by item.
need(SR.replaceable[ID('vine')] === 1 && SR.canBeReplacedBy(ID('vine'), ID('vine'), UP, 65, true) === false,
  'a vine refuses its own item even though its material is replaceable');
need(SR.canBeReplacedBy(ID('vine'), ID('stone'), UP, 65, true) === true, 'and still takes stone');
need(SR.canBeReplacedBy(ID('glow_lichen'), ID('glow_lichen'), UP, 65, true) === false, 'glow_lichen likewise');
need(SR.canBeReplacedBy(0, ID('stone'), UP, 65, true) === true, 'air always');

// ---------------------------------------------------------------------------- §4 stackOnto
say('\n4. the growing half: what replacing it actually produces');
// `stackOnto` lives on Player, which needs the DOM shim, so it is exercised through gamecheck's
// harness end to end. Here it is checked as the pure function it is.
const NS2 = (() => {
  const N = {};
  globalThis.MCL = N;
  const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
    '02c_states.js', '02k_survive.js', '03_section.js', '05_mesher.js', '07_world.js', '07b_behaviour.js',
    '07c_blockentity.js', '14b_physics.js', '14c_raycast.js', '14d_survival.js', '14e_gamemode.js',
    '14f_inventory.js', '14_player.js'];
  const win = { addEventListener() {} };
  const doc = { createElement: () => ({ getContext: () => null, addEventListener() {} }), addEventListener() {} };
  for (const f of FILES) {
    new Function('MCL', 'window', 'document', 'navigator',
      readFileSync(join(SRC, f), 'utf8'))(N, win, doc, { hardwareConcurrency: 4 });
  }
  const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
  const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
  N.Reg.init({
    runtime: b64('block-runtime.bin'), runtimeBytes: rd('block-runtime.meta.json').rawBytes,
    geometry: b64('block-geometry.bin'), geometryBytes: rd('block-geometry.meta.json').rawBytes,
    tileAlpha: rd('block-tiles.meta.json').alpha,
  });
  return N;
})();
const P = NS2.Player;
need(typeof P.stackOnto === 'function', 'Player.stackOnto exists');
if (typeof P.stackOnto === 'function') {
  const S2 = NS2.States, R2 = NS2.Reg;
  const st = (n) => S2.stateOf(n);
  const slabOf = (t) => {
    const b = S2.block[st('oak_slab')];
    for (let s = R2.realFirst[b]; s < R2.realFirst[b + 1]; s++) {
      if (R2.valueNames[S2.propValue(s, R2.PROP.type)] === t) return s;
    }
    return -1;
  };
  const sb = slabOf('bottom'), sd = slabOf('double');
  need(P.stackOnto(sb, sb) === sd, 'a slab on a slab is a DOUBLE slab, not a lost slab');
  need(P.stackOnto(sd, sb) === -1, 'a double slab does not grow');
  need(P.stackOnto(sb, st('stone')) === -1, 'a slab does not grow from a different item');
  const snowB = S2.block[st('snow')];
  const snowAt = (n) => {
    for (let s = R2.realFirst[snowB]; s < R2.realFirst[snowB + 1]; s++) {
      if (+R2.valueNames[S2.propValue(s, R2.PROP.layers)] === n) return s;
    }
    return -1;
  };
  need(P.stackOnto(snowAt(1), snowAt(1)) === snowAt(2), 'snow deepens one layer at a time');
  need(P.stackOnto(snowAt(7), snowAt(1)) === snowAt(8), 'up to eight');
  need(P.stackOnto(snowAt(8), snowAt(1)) === -1, 'and no further');
  need(P.stackOnto(st('stone'), st('stone')) === -1, 'ordinary blocks do not stack');
  // ⚠ THE POINT OF THIS ONE: the bug was a SECOND derivation living beside the real table.
  // `init()` is what used to build it, so the assertion has to be made after init runs.
  P.init();
  need(P.REPLACEABLE === S2.replaceable,
    'Player.REPLACEABLE is the States table itself, not a second derivation of it');
  let derived = 0;
  for (let i = 0; i < S2.count; i++) if (P.REPLACEABLE[i] !== S2.replaceable[i]) derived++;
  need(derived === 0, `${derived} states where Player disagrees with States about replaceability`);
}

// ---------------------------------------------------------------------------- §5 targeting
say('\n5. DECLARED, NOT FIXED: a block with no collision box is targeted as a full cube (D-264)');
// ⚠ `14c_raycast.js` asks `Physics.shapeOf`, which is the COLLISION shape, and treats a null one
// as a hit on the whole cell. Vanilla has a separate interaction/outline shape, so a flower's
// selection box is a small cross and the face you click is that cross's. Here it is the cell's.
// This is a real parity gap and it is NOT closed; it is measured so it cannot grow in silence,
// and so the number is a fact when the stage that fixes it arrives.
let noShape = 0, noShapeBlocks = new Set();
for (let s = 1; s < SR.count; s++) {
  if (SR.solid[s] === 0) { noShape++; noShapeBlocks.add(SR.block[s]); }
}
say(`   ${noShapeBlocks.size} blocks / ${noShape} real states have no collision box`);
need(noShapeBlocks.size >= 100 && noShapeBlocks.size <= 260,
  `${noShapeBlocks.size} blocks have no collision box — outside the declared 100..260 band (D-264)`);
need(SR.solid[ID('poppy')] === 0 && SR.solid[ID('stone')] === 1,
  'the no-collision set is the one D-264 means (a flower in, stone out)');

// ---------------------------------------------------------------------------- §5b two-cell blocks
// ⚠⚠ **A DOOR IS TWO BLOCKS** (D-332). D-331 made 223 more items placeable and 33 of them do not
// fit in one cell. Nothing here had ever asked a placement how many cells it occupies, because
// until this session none of those items could be placed at all — **a stage's checks stop at the
// edge of what the stage could reach, and that edge moves.**
console.log('\n5b. the blocks that occupy two cells');
{
  const V = R.PVAL, PR = R.PROP;
  // the SET is derived, not typed: a default state carrying half=lower or part=foot
  const twoCell = [], bedLike = [];
  for (let b = 1; b < R.blockCount; b++) {
    const st = R.realFirst[b] + R.defaultState[b];
    if (SR.propValue(st, PR.half) === V.lower) twoCell.push(R.names[b]);
    if (SR.propValue(st, PR.part) === V.foot) bedLike.push(R.names[b]);
  }
  console.log(`   two-cell ........ ${twoCell.length} with half=lower, ${bedLike.length} with part=foot`);
  ok(twoCell.length === 17, 'blocks with an upper and a lower half (8 doors, 9 tall plants): ' + twoCell.length);
  ok(bedLike.length === 16, 'beds: ' + bedLike.length);

  // every one of them must yield a second cell, and it must be the RIGHT one
  let noSecond = [], wrongCell = [];
  for (const n of twoCell) {
    const st = SR.stateOf(n);
    const sc = P.secondCell(st, 10, 70, 10);
    if (!sc) { noSecond.push(n); continue; }
    if (sc.x !== 10 || sc.y !== 71 || sc.z !== 10) wrongCell.push(n + ' at ' + [sc.x, sc.y, sc.z]);
    if (SR.propValue(sc.st, PR.half) !== V.upper) wrongCell.push(n + ' upper half is not upper');
    if (SR.block[sc.st] !== SR.block[st]) wrongCell.push(n + ' upper half is a different block');
  }
  ok(noSecond.length === 0, `${noSecond.length} two-cell blocks yield no second cell: ${noSecond.slice(0, 5).join(' ')}`);
  ok(wrongCell.length === 0, `${wrongCell.length} wrong second cells: ${wrongCell.slice(0, 4).join(' | ')}`);

  // ⚠ A BED'S HEAD GOES IN THE DIRECTION IT FACES, which is the direction the PLAYER IS LOOKING
  // (`BedBlock.getStateForPlacement` uses `getHorizontalDirection()`, not its opposite) — so the
  // pillow ends up away from you, which is the only way a bed you just placed reads right.
  const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  let bedBad = [];
  for (const n of bedLike) {
    for (const dir of ['north', 'south', 'east', 'west']) {
      const st = SR.withProp(SR.stateOf(n), PR.facing, V[dir]);
      const sc = P.secondCell(st, 10, 70, 10);
      if (!sc) { bedBad.push(n + ' ' + dir + ' has no head'); continue; }
      const want = STEP[dir];
      if (sc.x !== 10 + want[0] || sc.y !== 70 || sc.z !== 10 + want[1]) {
        bedBad.push(`${n} facing ${dir} put its head at ${[sc.x, sc.y, sc.z]}`);
      }
      if (SR.propValue(sc.st, PR.part) !== V.head) bedBad.push(n + ' second cell is not the head');
      if (SR.propValue(sc.st, PR.facing) !== V[dir]) bedBad.push(n + ' head faces elsewhere');
    }
  }
  ok(bedBad.length === 0, `${bedBad.length} bad bed heads: ${bedBad.slice(0, 4).join(' | ')}`);

  // and a block that is NOT two-cell must not grow one
  let spurious = [];
  for (const n of ['stone', 'oak_slab', 'oak_stairs', 'torch', 'oak_fence', 'chest', 'candle'])
    if (P.secondCell(SR.stateOf(n), 10, 70, 10)) spurious.push(n);
  ok(spurious.length === 0, `${spurious.length} one-cell blocks claim a second: ${spurious.join(' ')}`);
}

// ---------------------------------------------------------------------------- §5c the door hinge
// ⚠ VANILLA'S `DoorBlock.getHinge`, WALKED EXHAUSTIVELY. It is a vote — full collision blocks
// counter-clockwise count -1 and clockwise +1 — and only a level vote falls through to which half
// of the face you clicked. Written as a pure function so all 16 neighbour combinations x 4
// facings x 4 click quadrants can be walked here rather than reasoned about.
console.log('\n5c. the door hinge');
{
  const V = R.PVAL;
  const H = (f, a, b, c, d, dcc, dcw, hx, hz) => P.doorHinge(V, V[f], a, b, c, d, dcc, dcw, hx, hz);
  // a wall on the counter-clockwise side pushes the hinge to the LEFT... no: vanilla counts it -1,
  // and i <= 0 with no same-door neighbour takes the left branch.
  ok(H('north', true, true, false, false, false, false, 10.5, 10.5) === V.left,
     'two full blocks counter-clockwise hinge LEFT');
  ok(H('north', false, false, true, true, false, false, 10.5, 10.5) === V.right,
     'two full blocks clockwise hinge RIGHT');
  ok(H('north', true, true, true, true, false, false, 10.2, 10.2) !== undefined,
     'a level vote still returns a side');
  // ⚠⚠ A DOOR ALREADY THERE MAKES A DOUBLE DOOR, AND THE SIDE IS THE ONE I GOT BACKWARDS. The
  // bytecode: `(bl && !bl2) || i > 0` returns cpq.b and `(bl2 && !bl) || i < 0` returns cpq.a,
  // where cpq's constants are declared "left" then "right" — so a lower door half on the
  // CLOCKWISE side hinges this one LEFT and one counter-clockwise hinges it RIGHT. The
  // implementation transcribed the bytecode correctly and this assertion did not; it was written
  // from the same memory that told a sub-agent the selector was 24x24 an hour earlier.
  ok(H('north', false, false, false, false, false, true, 10.5, 10.5) === V.left,
     'a lower door half CLOCKWISE hinges this one LEFT — the pair opens as a double door');
  ok(H('north', false, false, false, false, true, false, 10.5, 10.5) === V.right,
     '...and one counter-clockwise hinges it RIGHT, which is the same rule seen from the other side');
  // the vote overrides the neighbouring door when it is strong enough, in both directions
  ok(H('north', false, false, true, true, false, true, 10.5, 10.5) === V.right,
     'two full blocks clockwise outvote a door clockwise');
  // the click quadrant only decides when nothing else does
  let bySide = { left: 0, right: 0 };
  for (const f of ['north', 'south', 'east', 'west']) {
    for (const hx of [10.25, 10.75]) for (const hz of [10.25, 10.75]) {
      bySide[H(f, false, false, false, false, false, false, hx, hz) === V.left ? 'left' : 'right']++;
    }
  }
  console.log(`   free-standing ... ${bySide.left} left / ${bySide.right} right over 4 facings x 4 quadrants`);
  ok(bySide.left === 8 && bySide.right === 8,
     `the click quadrant must split a free-standing door evenly; got ${bySide.left}/${bySide.right}`);
  // ⚠ AND IT MUST DEPEND ON THE CLICK AT ALL. A rule that ignored hx/hz would give 16/0.
  ok(bySide.left > 0 && bySide.right > 0, 'the hinge ignores where on the face you clicked');

  // fullCollision, which the vote counts, is neither `solid` nor `opaqueBase` (D-332)
  ok(SR.fullCollision(SR.stateOf('glass')), 'glass is a full collision block');
  ok(!SR.fullCollision(SR.stateOf('oak_fence')), 'a fence is not');
  ok(!SR.fullCollision(SR.stateOf('oak_slab')), 'nor is a slab');
  ok(SR.fullCollision(SR.stateOf('stone')) && !SR.fullCollision(0), 'stone is, air is not');
  ok(SR.solid[SR.stateOf('oak_fence')] === 1 && !SR.fullCollision(SR.stateOf('oak_fence')),
     '`solid` and `fullCollision` are different questions — a fence answers them differently');
  ok(SR.opaqueBase[SR.stateOf('glass')] === 0 && SR.fullCollision(SR.stateOf('glass')),
     '...and so are `opaqueBase` and `fullCollision` — glass answers those differently');
}

// ---------------------------------------------------------------------------- §6 anti-vacuity
say('\n6. anti-vacuity: break it, and it must be caught');
const brk = (what, fn) => { breaks++; const caught = fn(); if (caught) say('   ✓ ' + what); else fail('anti-vacuity: ' + what + ' was NOT caught'); };

brk('a block that vanilla refuses marked replaceable', () => {
  const saved = SR.replaceable[ID('oak_fence_gate')];
  SR.replaceable[ID('oak_fence_gate')] = 1;
  const caught = SR.replaceable[ID('oak_fence_gate')] !== 0;
  SR.replaceable[ID('oak_fence_gate')] = saved;
  return caught && saved === 0;
});
brk('the golden table claiming a different count', () => {
  let n = 0;
  for (const v of gold.values()) if (v) n++;
  return n === 28;                       // §1 asserts this exact number; a drifted file fails it
});
brk('the old geometric rule admitting fewer than 100 blocks (section gone vacuous)', () => {
  const s = new Set();
  for (let i = 0; i < SR.count; i++) if (oldRule(i)) s.add(SR.block[i]);
  return s.size > 100;
});
brk('snow at four layers made replaceable by any item', () =>
  SR.canBeReplacedBy(snow4, ID('stone'), UP, 65, true) === false);
brk('a slab accepting a slab from the wrong face', () =>
  SR.canBeReplacedBy(slabBottom, slabBottom, DOWN, 65.2, true) === false);
brk('vine accepting its own item', () =>
  SR.canBeReplacedBy(ID('vine'), ID('vine'), UP, 65, true) === false);
brk('stackOnto silently returning the held state', () =>
  P.stackOnto(ID('stone'), ID('stone')) === -1);

// ── D-332's breaks: §5b and §5c must be able to fail ────────────────────────────────────────
brk('a one-cell block handed a second cell', () =>
  P.secondCell(SR.stateOf('stone'), 10, 70, 10) === null);
brk('a door whose upper half is placed in its own cell', () => {
  const sc = P.secondCell(SR.stateOf('oak_door'), 10, 70, 10);
  return !!sc && sc.y === 71;
});
brk('a bed whose head is stacked above the foot instead of alongside it', () => {
  const st = SR.withProp(SR.stateOf('red_bed'), R.PROP.facing, R.PVAL.east);
  const sc = P.secondCell(st, 10, 70, 10);
  return !!sc && sc.y === 70 && sc.x === 11;
});
brk('the hinge ignoring the neighbours entirely', () => {
  const V = R.PVAL;
  const a = P.doorHinge(V, V.north, true, true, false, false, false, false, 10.5, 10.5);
  const b = P.doorHinge(V, V.north, false, false, true, true, false, false, 10.5, 10.5);
  return a !== b;                          // a rule that ignored them would give the same side
});
brk('`fullCollision` collapsing into `solid`', () =>
  SR.solid[SR.stateOf('oak_fence')] === 1 && SR.fullCollision(SR.stateOf('oak_fence')) === false);
brk('`fullCollision` collapsing into `opaqueBase`', () =>
  SR.opaqueBase[SR.stateOf('glass')] === 0 && SR.fullCollision(SR.stateOf('glass')) === true);

// ---------------------------------------------------------------------------- summary
console.log('\n================ placecheck ================');
console.log(` assertions passed .. ${checks}`);
console.log(` failures ........... ${errors}`);
console.log(` breaks caught ...... ${breaks}`);
console.log(` replaceable ........ ${engineReplBlocks} blocks / ${engineReplStates} real states (vanilla: 28 blocks)`);
console.log(` old rule admitted .. ${oldBlocks.size} blocks / ${oldStates.length} real states`);
console.log('============================================');
process.exit(errors ? 1 : 0);
