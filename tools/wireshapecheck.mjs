#!/usr/bin/env node
// wireshapecheck.mjs — #339 (G15a). Redstone dust's STORED connection properties
// (north/east/south/west = none | side | up), which the model draws: a dot, a line, a cross, a climb.
//
//   node tools/wireshapecheck.mjs [--quiet]
//
// Every expected shape below is derived by hand from .decomp/net/minecraft/block/RedstoneWireBlock.java:
//   getPlacementState(ctx)      grown from `dotState` (all SIDE — Yarn's name, it is the CROSS)
//   getPlacementState(w, s, p)  recompute all four from a blank state; unless the seed was a dot and still
//                               nothing connects, an axis with nothing on it gets BOTH its sides set to SIDE
//   getRenderConnectionType     aboveOpen && canRunOnTop(side) && wire on it -> UP if the side's face toward
//                               us is sturdy, else SIDE; else NONE when !connectsTo(side, dir) && (side
//                               conducts || no wire below it); else SIDE
//   getStateForNeighborUpdate   DOWN: unchanged. UP: getPlacementState(state). A side: rewrite that side in
//                               place unless its connected-ness flipped or the wire is a cross -> regrow
//   prepare                     the diagonal (side-down / side-up) wires hear about this one
//   onUse                       cross <-> dot, regrown; anything else PASSes
// The world is a plain array whose setBlock runs Behave.changed, exactly as World.setBlock does, and a
// placement goes through Behave.place first, exactly as the player's does (14_player.js).
// Anti-vacuity (D-30): the engine's wire rules are knocked out one at a time (placement, neighbour update,
// the diagonal prepare, the climb's UP, the right-click) and one expected shape is flipped; each must fail.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');
const say = (...a) => { if (!QUIET) console.log(...a); };
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js',
               '14b_physics.js', '14f_inventory.js', '07f_redstone.js'];
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');

const X = 'none', SD = 'side', UP = 'up';
const CROSS = [SD, SD, SD, SD], DOT = [X, X, X, X], LINE_EW = [X, SD, X, SD], LINE_NS = [SD, X, SD, X];

/** An engine bound to a world; `scene()` wipes it to a stone floor at y = -1. `hook(M)` may break the engine. */
function engine(hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  const N = 32, MID = 16;
  const cells = new Uint16Array(N * N * N);
  const inside = (x, y, z) => x + MID >= 0 && x + MID < N && y + MID >= 0 && y + MID < N && z + MID >= 0 && z + MID < N;
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const get = (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0);
  const B = M.Behave, S = M.States, Rs = M.Redstone;
  // World.setBlock's shape: write, then Behave.changed(x, y, z, old)
  const w = {
    get, getBlock: get,
    setBlock: (x, y, z, s) => { if (!inside(x, y, z)) return false; const old = get(x, y, z); cells[idx(x, y, z)] = s; B.changed(x, y, z, old); return true; },
    getLight: () => 15 << 4,
  };
  w.set = w.setBlock;
  B.init(w);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  Rs.init();
  if (hook) hook(M);
  const stone = S.stateOf('stone');
  const scene = () => {
    cells.fill(0);
    B.clearSchedule();
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) cells[idx(x, -1, z)] = stone;
    return api;
  };
  const state = (name, props) => {
    let st = S.stateOf(name);
    if (!st) throw new Error('no state ' + name);
    for (const [k, v] of Object.entries(props || {})) st = B.setProp(st, k, v);
    return st;
  };
  const api = {
    M, w, Rs, B,
    /** the player's path: Behave.place, then World.setBlock */
    place: (x, y, z, name, props) => w.setBlock(x, y, z, B.place(state(name, props), x, y, z)),
    /** /setblock: the state as given (a dust arrives as the all-none dot), then the neighbour updates */
    setblock: (x, y, z, name, props) => w.setBlock(x, y, z, name === 'air' ? 0 : state(name, props)),
    use: (x, y, z) => Rs.wireUse(x, y, z),
    conn: (x, y, z) => { const st = get(x, y, z); return ['north', 'east', 'south', 'west'].map((p) => B.propName(st, p) || '-'); },
    power: (x, y, z) => Rs.powerOf(get(x, y, z)),
    lit: (x, y, z) => B.propName(get(x, y, z), 'lit') === 'true',
    ticks: (n) => {
      const real = B.scheduledTick;
      B.scheduledTick = (x, y, z) => { if (!Rs.lampTick(x, y, z)) Rs.diodeTick(x, y, z); };
      for (let t = 0; t < n; t++) B.tick();
      B.scheduledTick = real;
    },
  };
  return scene;
}

// ── the scenarios: [id, build(s) -> [[label, got, want], ...]] ────────────────────────────────
const SCEN = [
  ['lone_placed_is_cross', (s) => { s.place(0, 0, 0, 'redstone_wire'); return [['(0,0,0)', s.conn(0, 0, 0), CROSS]]; }],
  ['straight_run_placed', (s) => {
    s.place(0, 0, 0, 'redstone_wire'); s.place(1, 0, 0, 'redstone_wire');
    return [['(0,0,0)', s.conn(0, 0, 0), LINE_EW], ['(1,0,0)', s.conn(1, 0, 0), LINE_EW]];
  }],
  // the issue's reproduction: two /setblock dots, each regrown into a line by the other's update
  ['straight_run_setblock', (s) => {
    s.setblock(0, 0, 0, 'redstone_wire'); s.setblock(1, 0, 0, 'redstone_wire');
    return [['(0,0,0)', s.conn(0, 0, 0), LINE_EW], ['(1,0,0)', s.conn(1, 0, 0), LINE_EW]];
  }],
  ['lone_setblock_is_dot', (s) => { s.setblock(0, 0, 0, 'redstone_wire'); return [['(0,0,0)', s.conn(0, 0, 0), DOT]]; }],
  ['t_junction', (s) => {
    for (const [x, z] of [[0, 0], [1, 0], [-1, 0], [0, 1]]) s.place(x, 0, z, 'redstone_wire');
    return [['centre', s.conn(0, 0, 0), [X, SD, SD, SD]], ['south arm', s.conn(0, 0, 1), LINE_NS],
            ['east arm', s.conn(1, 0, 0), LINE_EW]];
  }],
  ['plus_junction', (s) => {
    for (const [x, z] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) s.place(x, 0, z, 'redstone_wire');
    return [['centre', s.conn(0, 0, 0), CROSS]];
  }],
  ['corner', (s) => {
    s.place(0, 0, 0, 'redstone_wire'); s.place(1, 0, 0, 'redstone_wire'); s.place(0, 0, 1, 'redstone_wire');
    return [['corner', s.conn(0, 0, 0), [X, SD, SD, X]]];
  }],
  // breaking the neighbour of a line leaves a CROSS (the regrow from the cross seed), not a dot
  ['break_leaves_cross', (s) => {
    s.place(0, 0, 0, 'redstone_wire'); s.place(1, 0, 0, 'redstone_wire'); s.setblock(1, 0, 0, 'air');
    return [['(0,0,0)', s.conn(0, 0, 0), CROSS]];
  }],
  // climb, lower dust placed FIRST: it only hears of the upper one through `prepare` (a diagonal)
  ['climb_lower_first', (s) => {
    s.place(1, 0, 0, 'stone'); s.place(0, 0, 0, 'redstone_wire'); s.place(1, 1, 0, 'redstone_wire');
    return [['lower', s.conn(0, 0, 0), [X, UP, X, SD]], ['upper (step down)', s.conn(1, 1, 0), LINE_EW]];
  }],
  ['climb_upper_first', (s) => {
    s.place(1, 0, 0, 'stone'); s.place(1, 1, 0, 'redstone_wire'); s.place(0, 0, 0, 'redstone_wire');
    return [['lower', s.conn(0, 0, 0), [X, UP, X, SD]], ['upper (step down)', s.conn(1, 1, 0), LINE_EW]];
  }],
  // a conductor over the lower dust cuts the climb: both regrow to a cross
  ['climb_capped', (s) => {
    s.place(1, 0, 0, 'stone'); s.place(0, 0, 0, 'redstone_wire'); s.place(1, 1, 0, 'redstone_wire');
    s.place(0, 1, 0, 'stone');
    return [['lower', s.conn(0, 0, 0), CROSS], ['upper', s.conn(1, 1, 0), CROSS]];
  }],
  // glass is no conductor but its top can hold dust: canRunOnTop, not isSolidBlock, decides the climb
  ['climb_glass', (s) => {
    s.place(1, 0, 0, 'glass'); s.place(0, 0, 0, 'redstone_wire'); s.place(1, 1, 0, 'redstone_wire');
    return [['lower', s.conn(0, 0, 0), [X, UP, X, SD]], ['upper', s.conn(1, 1, 0), LINE_EW]];
  }],
  // a top slab holds dust but its west face is not sturdy: the climb is SIDE, not UP
  ['climb_top_slab', (s) => {
    s.place(1, 0, 0, 'stone_slab', { type: 'top' }); s.place(0, 0, 0, 'redstone_wire'); s.place(1, 1, 0, 'redstone_wire');
    return [['lower', s.conn(0, 0, 0), LINE_EW]];
  }],
  ['repeater_along_axis', (s) => {
    s.place(1, 0, 0, 'repeater', { facing: 'east' }); s.place(0, 0, 0, 'redstone_wire');
    return [['(0,0,0)', s.conn(0, 0, 0), LINE_EW]];
  }],
  ['repeater_across', (s) => {
    s.place(1, 0, 0, 'repeater', { facing: 'north' }); s.place(0, 0, 0, 'redstone_wire');
    return [['(0,0,0)', s.conn(0, 0, 0), CROSS]];
  }],
  ['lamp_no_connect', (s) => {
    s.place(0, 0, 0, 'redstone_wire'); s.place(1, 0, 0, 'redstone_lamp');
    return [['(0,0,0)', s.conn(0, 0, 0), CROSS]];
  }],
  // right-click: cross -> dot -> cross; a line or a T PASSes and keeps its shape
  ['use_toggle', (s) => {
    s.place(0, 0, 0, 'redstone_wire');
    const r1 = s.use(0, 0, 0), a = s.conn(0, 0, 0);
    const r2 = s.use(0, 0, 0), b = s.conn(0, 0, 0);
    return [['cross->dot', a, DOT], ['dot->cross', b, CROSS], ['both SUCCESS', [r1, r2], [true, true]]];
  }],
  ['use_line_passes', (s) => {
    s.place(0, 0, 0, 'redstone_wire'); s.place(1, 0, 0, 'redstone_wire');
    const r = s.use(0, 0, 0);
    return [['line', s.conn(0, 0, 0), LINE_EW], ['PASS', [r], [false]]];
  }],
  // a neighbour update keeps a dot a dot while nothing connects, and regrows it when something does
  ['dot_survives_stone_then_lever', (s) => {
    s.place(0, 0, 0, 'redstone_wire'); s.use(0, 0, 0);
    s.place(1, 0, 0, 'stone');
    const a = s.conn(0, 0, 0);
    s.place(0, 0, 1, 'lever', { face: 'floor', facing: 'north' });
    return [['dot beside stone', a, DOT], ['dot beside a lever', s.conn(0, 0, 0), LINE_NS]];
  }],
  // what the shape is FOR: a placed lone cross powers the lamp beside it; right-clicked to a dot, it does not
  ['cross_powers_lamp_dot_does_not', (s) => {
    s.setblock(0, -1, 0, 'redstone_block');
    s.place(1, 0, 0, 'redstone_lamp'); s.place(0, 0, 0, 'redstone_wire'); s.ticks(4);
    const litCross = s.lit(1, 0, 0), pw = s.power(0, 0, 0);
    s.use(0, 0, 0); s.ticks(6);
    const shape = s.conn(0, 0, 0);
    return [['wire power', [pw], [15]], ['lamp lit by cross', [litCross], [true]],
            ['dot shape keeps power', [s.power(0, 0, 0)], [15]], ['after use', shape, DOT],
            ['lamp dark beside dot', [s.lit(1, 0, 0)], [false]]];
  }],
];

function runAll(hook, flip) {
  const fails = [];
  const scene = engine(hook);
  let n = 0;
  for (const [id, build] of SCEN) {
    let rows;
    try { rows = build(scene()); } catch (e) { fails.push(id + ': threw ' + e.message); continue; }
    for (const [label, got, want0] of rows) {
      n++;
      const want = flip && flip.id === id && flip.label === label ? flip.want : want0;
      if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${id} ${label}: got [${got}] want [${want}]`);
    }
  }
  return { n, fails };
}

const base = runAll();
for (const f of base.fails) console.log('  ✗ ' + f);
say(`wireshapecheck: ${SCEN.length} scenarios, ${base.n} shapes compared`);

const BREAKS = [
  ['placement grows nothing (a placed dust keeps the default all-none dot)', (M) => { M.Redstone.wirePlace = (x, y, z, s) => s; }],
  ['the neighbour update ignores wire (the pre-#339 engine)', (M) => { M.Redstone.wireNeighbourShape = (s) => s; }],
  ['no diagonal prepare', (M) => { M.Redstone.wirePrepare = () => 0; }],
  ['a right-click does nothing', (M) => { M.Redstone.wireUse = () => false; }],
  ['no hopper/sturdy-top test: a climb only over conductors', (M) => {
    const isc = M.Redstone.isConductor, fs = M.Behave.faceSturdy;
    M.Behave.faceSturdy = (st, d) => (d === 1 ? isc(st) : fs(st, d));
  }],
  ['golden flipped: the climb reads side where vanilla has up', null, { id: 'climb_lower_first', label: 'lower', want: [X, SD, X, SD] }],
];
let breaks = 0;
for (const [name, hook, flip] of BREAKS) {
  const r = runAll(hook, flip);
  if (r.fails.length > 0) { breaks++; say(`   ✓ break caught: ${name} (${r.fails.length} shapes differ)`); }
  else console.log(`  ✗ break NOT caught: ${name}`);
}
const failed = base.fails.length + (BREAKS.length - breaks);
console.log(`wireshapecheck: ${base.n} assertions, ${base.fails.length} failures, ${breaks} breaks caught`);
process.exit(failed ? 1 : 0);
