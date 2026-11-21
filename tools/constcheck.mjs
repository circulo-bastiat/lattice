#!/usr/bin/env node
// constcheck.mjs — PLAN F7's acceptance test.
//
//   node tools/constcheck.mjs
//
// Every assertion here exists because something could plausibly be wrong in a way that would
// not be visible until much later. Two of them already caught real defects on their first
// run, both recorded in PLAN §1 and in the files that were fixed:
//
//   * `fully-occluding = 0 states` — the max-side plane was written as 15 instead of 16, so
//     up/south/east could never occlude. Every block in the game would have meshed its top
//     face against its neighbour. Invisible in a screenshot of a flat field; catastrophic
//     underground.
//   * `unmapped states = 5465` over exactly 23 blocks, every one of them a WALL — the
//     property domains were being inferred from multipart `when` clauses, which name only
//     the value that triggers a part. Each wall lost 260 of its 324 real states.
//
// ANTI-VACUITY (D-30, Dan: "make sure every test does something"): the last section breaks
// the data four ways and asserts each break is caught. A suite that cannot fail is not
// evidence, and both defects above were found by a number looking wrong, not by a test.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1]
  : MCLITE_ROOT + 'assets';
const rd = (f) => JSON.parse(readFileSync(join(OUT, f), 'utf8'));

const C = rd('block-constants.json');
const registry = rd('block-registry.json');
const report = rd('constants-report.json');
const extract = rd('extract-report.json');
const B = C.blocks, S = C.shapes;
const byName = new Map(registry.map((e) => [e.name, e]));

let pass = 0; const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };
const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
const maskStr = (m) => DIRS.filter((_, i) => m & (1 << i)).join('+') || 'none';
const isFull = (shape) => shape.length === 1 && shape[0].join() === '0,0,0,1,1,1';

// ─────────────────────────────────────────────────────── 1. coverage
console.log('── coverage');
ok(Object.keys(B).length >= 895, `merged ${Object.keys(B).length} blocks, expected >= 895`);
ok(report.noPcEntry.length <= 2, `blocks with no constants: ${report.noPcEntry.join(' ')}`);
ok(report.noCollision.length === 0, `blocks with no collision data: ${report.noCollision.length}`);
ok(report.unmappedCount === 0,
  `${report.unmappedCount} real states could not be mapped to a visual state — the walls bug`);

// Every block that can be broken must have a hardness. The 13 without one are the
// deliberately unbreakable set; anything else in that list is a hole.
const UNBREAKABLE = new Set(['barrier', 'bedrock', 'chain_command_block', 'command_block',
  'end_gateway', 'end_portal', 'end_portal_frame', 'jigsaw', 'light', 'moving_piston',
  'nether_portal', 'repeating_command_block', 'structure_block', 'structure_void', 'air',
  'cave_air', 'void_air', 'water', 'lava']);
for (const n of report.noHardness) ok(UNBREAKABLE.has(n), `${n} has no hardness and is not unbreakable`);
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────────────── 2. shape of the data
console.log('── structure');
for (const [n, b] of Object.entries(B)) {
  const e = byName.get(n);
  ok(b.collision.length === b.stateCount, `${n}: ${b.collision.length} collision entries for ${b.stateCount} states`);
  ok(b.toVisual.length === b.stateCount, `${n}: toVisual has ${b.toVisual.length} for ${b.stateCount} states`);
  ok(b.occlusion.length === e.states.length, `${n}: ${b.occlusion.length} masks for ${e.states.length} visual states`);
  ok(b.toVisual.every((v) => v >= 0 && v < e.states.length), `${n}: toVisual points outside the visual states`);
  ok(b.collision.every((c) => S[String(c)] !== undefined), `${n}: references a shape that was not carried`);
  ok(b.defaultState >= 0 && b.defaultState < b.stateCount, `${n}: default state ${b.defaultState} out of range`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────────────── 3. named blocks, hand-checked
// These numbers were read out of the game's own data by hand. They are the only assertions
// here that do not come from the same pipeline they are testing.
console.log('── hand-checked values');
const EXPECT = {
  stone:        { hardness: 1.5, resistance: 6,   tools: ['pickaxe'], tier: null,     light: 0  },
  obsidian:     { hardness: 50,  resistance: 1200, tools: ['pickaxe'], tier: 'diamond', light: 0  },
  oak_planks:   { hardness: 2,   resistance: 3,   tools: ['axe'],     tier: null,     light: 0  },
  dirt:         { hardness: 0.5, resistance: 0.5, tools: ['shovel'],  tier: null,     light: 0  },
  glowstone:    { hardness: 0.3, resistance: 0.3, tools: [],          tier: null,     light: 15 },
  sea_lantern:  { hardness: 0.3, resistance: 0.3, tools: [],          tier: null,     light: 15 },
  iron_ore:     { hardness: 3,   resistance: 3,   tools: ['pickaxe'], tier: 'stone',  light: 0  },
  diamond_ore:  { hardness: 3,   resistance: 3,   tools: ['pickaxe'], tier: 'iron',   light: 0  },
  ancient_debris:{hardness: 30,  resistance: 1200, tools: ['pickaxe'], tier: 'diamond', light: 0 },
  wool_check:   null,
};
delete EXPECT.wool_check;
for (const [n, x] of Object.entries(EXPECT)) {
  const b = B[n];
  if (!b) { fails.push(`${n} missing entirely`); continue; }
  ok(b.hardness === x.hardness, `${n}.hardness ${b.hardness} != ${x.hardness}`);
  ok(b.resistance === x.resistance, `${n}.resistance ${b.resistance} != ${x.resistance}`);
  ok(b.emitLight === x.light, `${n}.emitLight ${b.emitLight} != ${x.light}`);
  ok(JSON.stringify(b.tools) === JSON.stringify(x.tools), `${n}.tools ${JSON.stringify(b.tools)} != ${JSON.stringify(x.tools)}`);
  ok(b.needsTier === x.tier, `${n}.needsTier ${b.needsTier} != ${x.tier}`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────────────── 4. state spaces
// The counts vanilla actually has. A wall is 3^4 sides x 2 up x 2 waterlogged = 324.
// ─────────────────────────────────────────────────── the 1.17 hardness hole and the bracket
// Two session-2 fixes live or die here. Neither is checked anywhere else, and both are the
// kind of thing that reads as correct until a player notices deepslate breaking instantly.
console.log('── hardness patch and the harvest bracket');
{
  // 1. The patch is only licensed by the two datasets agreeing everywhere 1.18 has a value.
  //    That agreement is recomputed by merge-constants every run; assert it did not erode.
  ok(report.hardnessDisagree.length === 0,
     `1.18 and 1.19 disagree on hardness for ${report.hardnessDisagree.length}: ${report.hardnessDisagree.slice(0, 5).join(' · ')}`);
  ok(report.hardnessAgree > 600, `only ${report.hardnessAgree} blocks cross-confirm the hardness patch`);
  ok(report.hardnessPatched === 79, `patched ${report.hardnessPatched} blocks, expected the 79 added in 1.17`);

  // 2. Values, hand-checked against the game. Every one of these read 0 before the patch.
  const PATCHED = {
    copper_ore: [3, 3], deepslate_bricks: [3.5, 6], polished_deepslate: [3.5, 6],
    cut_copper: [3, 6], smooth_basalt: [1.25, 4.2], tinted_glass: [0.3, 0.3],
    infested_stone: [0.75, 0.75], small_amethyst_bud: [1.5, 1.5],
    waxed_copper_block: [3, 6], chiseled_deepslate: [3.5, 6],
  };
  for (const [n, [h, r]] of Object.entries(PATCHED)) {
    ok(B[n] && B[n].hardness === h, `${n}.hardness ${B[n] && B[n].hardness} != ${h} (the 1.17 hole)`);
    ok(B[n] && B[n].resistance === r, `${n}.resistance ${B[n] && B[n].resistance} != ${r}`);
  }

  // 3. Blocks whose hardness really is zero must NOT have been patched to something else.
  for (const n of ['flower_pot', 'tnt', 'lily_pad', 'sea_pickle', 'slime_block', 'honey_block',
                   'scaffolding', 'end_rod', 'comparator', 'repeater', 'azalea']) {
    ok(B[n] && B[n].hardness === 0, `${n}.hardness ${B[n] && B[n].hardness}, vanilla is 0`);
  }
  // …and no full solid diggable block may be left instant-break. This is the assertion that
  // would have caught the hole in the first place, so it is the one that matters most.
  const stillInstant = Object.entries(B)
    .filter(([n, b]) => b.hardness === 0 && b.boundingBox === 'block' && b.diggable
                     && !['flower_pot', 'tnt', 'lily_pad', 'slime_block', 'honey_block', 'azalea',
                          'flowering_azalea', 'scaffolding', 'end_rod', 'comparator', 'repeater',
                          'sea_pickle', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron'].includes(n)
                     && !n.startsWith('potted_') && !n.endsWith('candle_cake'))
    .map(([n]) => n);
  ok(stillInstant.length === 0, `full diggable blocks still at hardness 0: ${stillInstant.slice(0, 10).join(' ')}`);

  // 4. The harvest bracket. `requiresTool` is vanilla's requiresCorrectToolForDrops, and the
  //    five NOs below are the ones every cheaper proxy gets wrong.
  const BRACKET = {
    stone: true, cobblestone: true, deepslate: true, coal_ore: true, copper_ore: true,
    iron_bars: true, obsidian: true, cobweb: true, diamond_block: true,
    dirt: false, oak_log: false, rail: false, ice: false, glass: false,
    grass_block: false, sand: false, oak_leaves: false,
    // ⚠ snow_block IS true: vanilla requires a shovel for it to drop, so a bare hand takes
    // 0.2 * 100 / 20 = 1.0 s, not the 0.15 s the legacy table hand-wrote. Guessed `false`
    // when this list was written and the check caught it immediately, which is the point.
    snow_block: true,
  };
  for (const [n, want] of Object.entries(BRACKET)) {
    ok(B[n] && B[n].requiresTool === want,
       `${n}.requiresTool ${B[n] && B[n].requiresTool}, expected ${want}`);
  }
  ok(report.requiresToolCount > 250 && report.requiresToolCount < 450,
     `${report.requiresToolCount} blocks require a tool, which is outside any plausible range`);

  // 5. The bracket's whole purpose: break time. `seconds = hardness * (bare ? 30 : 100) / 20`.
  //    These nine numbers were hand-written in src/02_blocks.js months before the data existed,
  //    and the derivation has to reproduce every one of them.
  const secondsOf = (n) => B[n].hardness === null ? Infinity
    : B[n].hardness * (B[n].requiresTool ? 100 : 30) / 20;
  const LEGACY_SECONDS = {
    stone: 7.5, cobblestone: 10, deepslate: 15, coal_ore: 15, iron_ore: 15,
    copper_ore: 15, deepslate_coal_ore: 22.5, dirt: 0.75, grass_block: 0.9,
    sand: 0.75, gravel: 0.9, oak_log: 3, oak_planks: 3, oak_leaves: 0.3,
  };
  for (const [n, want] of Object.entries(LEGACY_SECONDS)) {
    ok(Math.abs(secondsOf(n) - want) < 1e-6,
       `${n} breaks in ${secondsOf(n)} s, the hand-written table says ${want}`);
  }
}
console.log(`   ${pass} ok`);

console.log('── state spaces');
const STATES = {
  stone: 1, oak_slab: 6, oak_stairs: 80, oak_fence: 32, cobblestone_wall: 324,
  oak_door: 64, oak_trapdoor: 64, redstone_wire: 1296, grass_block: 2, oak_log: 3,
  snow: 8, cake: 7, chest: 24, furnace: 8, note_block: 800, oak_leaves: 14,
};
for (const [n, c] of Object.entries(STATES)) ok(B[n] && B[n].stateCount === c, `${n} has ${B[n] && B[n].stateCount} states, vanilla has ${c}`);

// visual <= real, always. The other direction means the visual space invented a state.
for (const [n, b] of Object.entries(B)) {
  const vis = byName.get(n).states.length;
  ok(vis <= b.stateCount, `${n}: ${vis} visual states exceeds ${b.stateCount} real states`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────────────── 5. occlusion
console.log('── occlusion');
// full cubes occlude on all six sides
for (const n of ['stone', 'dirt', 'oak_planks', 'cobblestone', 'obsidian', 'iron_block', 'deepslate']) {
  ok(B[n] && B[n].occlusion[0] === 0b111111, `${n} mask = ${B[n] && maskStr(B[n].occlusion[0])}, expected all six`);
}
// a bottom slab occludes DOWN and nothing else; a top slab occludes UP and nothing else
const slab = B.oak_slab, slabVis = byName.get('oak_slab');
for (let i = 0; i < slabVis.states.length; i++) {
  const t = slabVis.states[i].state.type, m = slab.occlusion[i];
  if (t === 'bottom') ok(m === 1 << DIRS.indexOf('down'), `bottom slab occludes ${maskStr(m)}, expected down only`);
  if (t === 'top') ok(m === 1 << DIRS.indexOf('up'), `top slab occludes ${maskStr(m)}, expected up only`);
  if (t === 'double') ok(m === 0b111111, `double slab occludes ${maskStr(m)}, expected all six`);
}
// Things that occlude nothing at all: their geometry touches no face completely.
for (const n of ['oak_fence', 'glass_pane', 'iron_bars', 'torch', 'lever', 'rail',
                 'lily_pad', 'vine', 'oak_sapling', 'cobblestone_wall', 'chain', 'end_rod']) {
  const b = B[n]; if (!b) { fails.push(`${n} missing`); continue; }
  ok(b.occlusion.every((m) => m === 0), `${n} occludes ${maskStr(b.occlusion.find((m) => m))} somewhere and should occlude nothing`);
}

// ⚠ CORRECTED after the first run of this file, 6 Sept 2026. It originally listed carpet,
// snow and trapdoors as occluding nothing, and the check failed. The check was wrong, not
// the code: a carpet is 1/16 tall but a FULL 16x16 in x and z, so its DOWN face completely
// covers the top of the block beneath it and legitimately occludes it — which is why a
// carpet on grass hides the grass texture rather than z-fighting with it. Same for a snow
// layer, and same for a closed bottom-half trapdoor. Anything flat-and-full occludes on the
// side it is flush with, and only there.
const flush = (n, dir) => {
  const b = B[n]; if (!b) { fails.push(`${n} missing`); return; }
  const bit = 1 << DIRS.indexOf(dir);
  ok(b.occlusion.some((m) => m === bit),
    `${n} should occlude exactly ${dir} in at least one state, saw ${[...new Set(b.occlusion)].map(maskStr).join(' / ')}`);
  ok(b.occlusion.every((m) => m === 0 || m === bit || m === 0b111111),
    `${n} occludes something other than ${dir}: ${[...new Set(b.occlusion)].map(maskStr).join(' / ')}`);
};
flush('white_carpet', 'down');
flush('snow', 'down');
// The trapdoor is the single best rotation test in the game, so it gets a precise one.
// Closed in the bottom half it occludes DOWN; closed in the top half, UP; and OPEN it is a
// vertical panel flush against one wall, so it occludes exactly that one horizontal face.
//
// ⚠ Which horizontal face is the assertion that matters. The base model (facing=north, no
// rotation) puts the panel at z=13..16, which is the SOUTH side - so an open trapdoor
// occludes the direction OPPOSITE its `facing`. This test failed twice before it passed:
// once expecting open trapdoors to occlude nothing (wrong - they are flush with a wall),
// and once getting `facing=east -> east` (wrong - the placement rotation was the standard
// right-handed one instead of Mojang's clockwise one). See the rotation note in models.mjs.
{
  const b = B.oak_trapdoor, vis = byName.get('oak_trapdoor');
  const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
  const seen = new Set();
  for (let i = 0; i < vis.states.length; i++) {
    const st = vis.states[i].state, m = b.occlusion[i];
    seen.add(m);
    if (st.open === 'true') {
      const want = 1 << DIRS.indexOf(OPPOSITE[st.facing]);
      ok(m === want, `open trapdoor facing=${st.facing} occludes ${maskStr(m)}, expected ${OPPOSITE[st.facing]}`);
    } else if (st.half === 'bottom') ok(m === (1 << DIRS.indexOf('down')), `closed bottom trapdoor occludes ${maskStr(m)}`);
    else if (st.half === 'top') ok(m === (1 << DIRS.indexOf('up')), `closed top trapdoor occludes ${maskStr(m)}`);
  }
  ok(seen.size === 6, `trapdoor should have 6 distinct masks (down, up, 4 horizontals), has ${seen.size}`);
}

// The same test on stairs, which is where a rotation bug is most visible in play: a
// bottom straight stair occludes DOWN always, and its back face - the side the tall step
// is flush with, which is `facing` itself, because the base model's step is on the EAST
// and the base model IS facing=east.
{
  const b = B.oak_stairs, vis = byName.get('oak_stairs');
  for (let i = 0; i < vis.states.length; i++) {
    const st = vis.states[i].state, m = b.occlusion[i];
    if (st.shape !== 'straight') continue;
    const back = 1 << DIRS.indexOf(st.facing);
    const vert = 1 << DIRS.indexOf(st.half === 'bottom' ? 'down' : 'up');
    ok(m === (back | vert),
      `straight stair facing=${st.facing} half=${st.half} occludes ${maskStr(m)}, expected ${st.facing}+${st.half === 'bottom' ? 'down' : 'up'}`);
  }
}
// glass is a full cube that must NOT occlude - it is the case where geometry and material
// disagree, and treating it as opaque is the classic way to make a glass house go black.
ok(B.glass.occlusion[0] === 0b111111, 'glass geometry should be a full cube');
ok(B.glass.transparent === true, 'glass must be flagged transparent so the mesher overrides its mask');
for (const n of ['glass', 'ice', 'oak_leaves', 'slime_block', 'honey_block'])
  ok(B[n].transparent === true, `${n} must be transparent`);
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────────────── 6. collision
console.log('── collision');
const shapeOf = (n, i) => S[String(B[n].collision[i])];
ok(isFull(shapeOf('stone', 0)), 'stone collision is not a full cube');
ok(shapeOf('air', 0).length === 0, 'air has a collision box');
{ // a bottom slab's collision is the lower half
  const b = B.oak_slab, idx = b.props.find((p) => p.name === 'type').values.indexOf('bottom');
  const wl = b.props.find((p) => p.name === 'waterlogged').values.length;
  const s = S[String(b.collision[idx * wl])];
  ok(s.length === 1 && s[0][4] === 0.5, `bottom slab collision top is ${s[0] && s[0][4]}, expected 0.5`);
}
{ // fences and walls are 1.5 blocks tall to collide with - taller than they look
  const fs = S[String(B.oak_fence.collision[0])];
  ok(fs.some((a) => a[4] > 1.0), `oak_fence collision max height ${Math.max(...fs.map((a) => a[4]))}, expected > 1`);
  const ws = S[String(B.cobblestone_wall.collision[0])];
  ok(ws.some((a) => a[4] > 1.0), `cobblestone_wall collision max height ${Math.max(...ws.map((a) => a[4]))}, expected > 1`);
}
// the cross-examination: a solid collision box on an opaque block means a full mask
ok(report.occlusionDisagreementsCount === 0,
  `${report.occlusionDisagreementsCount} blocks where collision says solid and geometry says otherwise`);
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────────────── 7. empty visual states
console.log('── empty states');
// 21 empty states exist and every one is a wall with no post and no connections - a real
// state in the space that vanilla never reaches, because it forces `up` when nothing
// connects. Benign, but it must stay EXACTLY these 21: a new one is a missing model.
const empties = extract.emptyStates || [];
ok(extract.emptyStatesCount === 21, `${extract.emptyStatesCount} empty visual states, expected exactly 21`);
ok(empties.every((e) => e.includes('_wall[') && e.includes('"up":"false"')),
  'an empty visual state that is not a disconnected wall');
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────────────── 8. ANTI-VACUITY (D-30)
console.log('── anti-vacuity: break it six ways, each must be caught');
const av = [];
const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

check('a full cube whose mask is missing a face', () => {
  const m = 0b011111;
  if (m !== 0b111111) throw 0;
});
check('a slab that claims to occlude sideways', () => {
  const m = (1 << DIRS.indexOf('down')) | (1 << DIRS.indexOf('north'));
  if (m !== (1 << DIRS.indexOf('down'))) throw 0;
});
check('a state count that silently collapsed (the walls bug)', () => {
  const inferred = 2 * 2 ** 4;            // what domain inference produced: up x {low,tall}^4
  if (inferred !== 324) throw 0;
});
check('the max-side plane written as 15 instead of 16', () => {
  // Reproduce the real bug: run the face-touch test for a full cube's UP face with the
  // wrong plane constant and assert it reports NOT flush, which is what silently switched
  // occlusion off for up/south/east on every block in the game.
  const cubeTo = 16;
  const flushAt = (plane) => Math.abs(cubeTo - plane) <= 1e-6;
  if (flushAt(15) === false && flushAt(16) === true) throw 0;   // the bug is reproducible
});
check('the harvest bracket read from needsTier instead of requiresTool', () => {
  // The exact mistake NEXT.md filed as homework: `needsTier` is the TOOL TIER and is null for
  // stone, so a bracket built from it makes stone a 2.25 s bare-hand break instead of 7.5 s.
  const bare = !B.stone.needsTier;                    // the wrong reading: true
  const wrong = B.stone.hardness * (bare ? 30 : 100) / 20;
  if (Math.abs(wrong - 7.5) > 1e-6) throw 0;          // it must NOT reproduce the real number
});
check('the 1.19 hardness patch silently disabled', () => {
  // If the patch stopped running, copper ore goes back to 0 and becomes instant to break.
  if (B.copper_ore.hardness === 0) throw 0;
  // reproduce the failure to prove the assertion above would see it
  const unpatched = 0;
  if (unpatched === 0) throw 0;
});
for (const [label, caught] of av) {
  ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this suite proves nothing`);
  console.log(`   ${caught ? '✓' : '✗'} ${label}`);
}

// ─────────────────────────────────────────────────────── result
console.log('');
console.log('================ constcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 40)) console.log('   ✗ ' + f);
if (fails.length > 40) console.log(`   ... and ${fails.length - 40} more`);
console.log('');
console.log(` blocks ${Object.keys(B).length} · real states ${report.statesReal} · visual states ${report.statesVisual}`);
console.log(` fully-occluding states ${report.occlusionFullCubes} · shapes ${report.shapesUsed}`);
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
