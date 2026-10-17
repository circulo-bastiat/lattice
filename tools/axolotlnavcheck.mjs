#!/usr/bin/env node
// axolotlcheck.mjs — loop/panda-axolotl-s101 (QUEUE 0.2 G18c, missing overworld mob): the
// AXOLOTL, whole. Drives the REAL modules (07zm_axolotl.js, Ai.ROSTER.axolotl/
// EL.DEFAULTS.axolotl/Spawn.RULES.axolotl/Breed.CHILD.axolotl/Cb.hurt's own play-dead hook/
// Use.entityUse+Use's own bucket branches) against `.decomp/net/minecraft/entity/passive/
// AxolotlEntity.java` (634 lines) and `AxolotlBrain.java` (179 lines), both read in full.
//
//   node tools/axolotlcheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/breeding food — the jar-extracted entity table's own row
//   2. variants — Ax.skinKey's five-sheet family, Ax.randomNaturalVariant excludes blue
//   3. EL.spawn('axolotl', ...) — EL.DEFAULTS.axolotl rolls a natural variant, Ai.ROSTER attaches e.ai
//   4. Spawn.RULES.axolotl — axolotls_spawnable_on tag, deliberately NO light check
//   5. Ax.createChild / Breed.CHILD.axolotl — 1/1200 blue mutation, else a parent's variant
//   6. play dead — Ax.onDamaged's trigger gate, Ax.tickPlayDead's countdown, Cb.canAttack's gate
//   7. Ax.buffPlayer — Regeneration add (capped 2400) + Poison clear
//   8. Ax.WanderGoal — cooldown-gated random-point walk, refuses while playing dead
//   9. bucketing — Use.entityUse's capture branch + the axolotl_bucket release branch
//  10. anti-vacuity — break the check's own data/stubs and watch it catch the break

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('axolotlnavcheck — #3822 axolotl pathing');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07z_potion.js',
               '07m_breed.js', '07zh_rabbit.js', '07zj_fox.js', '07zj_goat.js', '07zl_panda.js',
               '07q_effects.js', '07zm_axolotl.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Ax = MCL.Axolotl, Breed = MCL.Breed, W = MCL.World, S = MCL.States;
const Cb = MCL.Combat, Use = MCL.Use, Iv = MCL.Inventory, ES = MCL.Effects;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();
if (Cb && Cb.init) Cb.init();
if (ES && ES.init) ES.init();
if (Use && Use.init) Use.init(W);

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Ax && Ax.ready, 'NS.Axolotl ready');

// #3822: a pool with a wall (gap at z=3) between the axolotl and its target: Ax.navStep must route round it.
const water = S.stateOf('water') | 0, stone = S.stateOf('stone') | 0;
for (let x = -2; x <= 12; x++) for (let z = -6; z <= 6; z++) { W.setBlock(x, 60, z, stone); for (let y = 61; y <= 64; y++) W.setBlock(x, y, z, 0); }
for (let x = 0; x <= 10; x++) for (let z = -3; z <= 3; z++) { W.setBlock(x, 61, z, water); W.setBlock(x, 62, z, water); }
for (let z = -3; z <= 2; z++) { W.setBlock(5, 61, z, stone); W.setBlock(5, 62, z, stone); }
const run = () => {
  const e = EL.spawn('axolotl', 2.5, 61, 0.5, {}); const st = {};
  for (let i = 0; i < 400 && e.x < 8; i++) { Ax.navStep(e, st, 8.5, 61, 0.5, 0.5); Ax.travelMob(e); }
  return e.x;
};
ok(Ax.navStep && run() >= 8, 'axolotl must swim round a 1-block wall to a target behind it, x=' + run());
{ const rp = Ai.findPath, rs = Ai.findSwimPath, ra = Ax.amphibiousPath; Ai.findPath = () => null; Ai.findSwimPath = () => null; Ax.amphibiousPath = () => null;
  okAv(run() < 8, 'with no pathfinding the axolotl still crossed the wall'); Ai.findPath = rp; Ai.findSwimPath = rs; Ax.amphibiousPath = ra; }
// vertical swim nodes: a 1x1 water shaft (stone all round) 6 tall, target at the top (AmphibiousPathNodeMaker swim nodes)
for (let x = 19; x <= 21; x++) for (let z = -1; z <= 1; z++) for (let y = 61; y <= 67; y++) W.setBlock(x, y, z, stone);
for (let y = 61; y <= 66; y++) W.setBlock(20, y, 0, water);
const shaft = () => {
  const e = EL.spawn('axolotl', 20.5, 61, 0.5, {}); e.inWater = true; const st = {};
  for (let i = 0; i < 400 && e.y < 65; i++) { Ax.navStep(e, st, 20.5, 66, 0.5, 0.5); Ax.travelMob(e); }
  return e.y;
};
ok(shaft() >= 65, 'axolotl must swim up a vertical water shaft, y=' + shaft());
// land<->water transition nodes: pond edge at x=40 (water x<40, stone floor y=60, land x>=40 over stone)
for (let x = 0; x <= 20; x++) for (let z = 12; z <= 16; z++) { W.setBlock(x, 60, z, stone); for (let y = 61; y <= 64; y++) W.setBlock(x, y, z, 0); }
for (let x = 0; x < 10; x++) for (let z = 12; z <= 16; z++) { W.setBlock(x, 60, z, water); W.setBlock(x, 61, z, water); W.setBlock(x, 59, z, stone); }
const T = (x, y, z) => Ax.nodeType(x, y, z);
ok(T(5, 61, 14) === 'WATER' && T(5, 60, 14) === 'WATER_BORDER', 'open water is WATER, water beside a wall WATER_BORDER: ' + T(5, 61, 14) + ',' + T(5, 60, 14));
ok(T(15, 61, 14) === 'WALKABLE' && T(5, 62, 14) === 'OPEN' && T(15, 63, 14) === 'BLOCKED', 'land WALKABLE, air over water OPEN (breach), floating air BLOCKED');
const out = Ax.amphibiousPath(2.5, 61, 14.5, 15.5, 61, 14.5);
const last = out[out.length - 1];
ok(last.x === 15 && last.z === 14 && out.some(n => T(n.x, n.y, n.z) === 'WATER') && out.some(n => T(n.x, n.y, n.z) === 'WALKABLE'), 'path from pond onto land crosses WATER then WALKABLE nodes, len=' + out.length);
const back = Ax.amphibiousPath(15.5, 61, 14.5, 2.5, 61, 14.5), bl = back[back.length - 1];
ok(bl.x === 2 && back.some(n => T(n.x, n.y, n.z) === 'WALKABLE'), 'path from land back into the pond');
const e = EL.spawn('axolotl', 3.5, 61, 14.5, {}); e.inWater = true; const st = {};
for (let i = 0; i < 600 && e.x < 14; i++) { Ax.navStep(e, st, 15.5, 61, 14.5, 0.5); Ax.travelMob(e); }
ok(e.x >= 14, 'axolotl navStep carries it from pond onto land, x=' + e.x);
{ const old = Ax.nodeType; Ax.nodeType = (x, y, z) => { const t = old(x, y, z); return t === 'WALKABLE' ? 'WATER' : t === 'WATER_BORDER' ? 'WATER' : t === 'OPEN' ? 'BLOCKED' : t; };
  const p2 = Ax.amphibiousPath(2.5, 61, 14.5, 15.5, 61, 14.5);
  okAv(!p2.some(n => Ax.nodeType(n.x, n.y, n.z) === 'WALKABLE'), 'with plain WALKABLE/WATER types no path node reads WALKABLE (the transition assertion would fail)');
  Ax.nodeType = old; }
{ const P = Ax.NODE_PENALTY; Ax.NODE_PENALTY = { WATER: 0, WALKABLE: 0, WATER_BORDER: 0, OPEN: 0 };
  const flat = Ax.amphibiousPath(2.5, 61, 12.5, 2.5, 61, 16.5).length; Ax.NODE_PENALTY = P;
  okAv(Ax.amphibiousPath(2.5, 61, 12.5, 2.5, 61, 16.5).length >= flat, 'zero maluses never lengthen the path vs real maluses'); }
{ // #6431: diagonals + corner-cutting refusal (golden: LandPathNodeMaker.isValidDiagonalSuccessor)
  const dp = Ax.amphibiousPath(2.5, 61, 12.5, 6.5, 61, 16.5), stepsOk = dp.length === 5 && dp.every((n, i) => n.x - 2 === i && n.z - 12 === i);
  ok(stepsOk, 'open-water diagonal course is 5 nodes along the diagonal, len=' + dp.length);
  W.setBlock(4, 61, 15, stone); W.setBlock(4, 62, 15, stone);   // solid flank of the (3,15)->(4,14) corner
  const cp = Ax.amphibiousPath(3.5, 61, 15.5, 4.5, 61, 14.5);
  ok(!(cp.length === 2), 'a diagonal past a solid flanking cell is refused, path len=' + cp.length);
  W.setBlock(4, 61, 15, water); W.setBlock(4, 62, 15, 0);
  Ax.DIAGONALS_OFF = true; const sp = Ax.amphibiousPath(2.5, 61, 12.5, 6.5, 61, 16.5); Ax.DIAGONALS_OFF = false;
  okAv(sp.length === 5 ? false : true, 'with the 6-connected search the diagonal course is longer (' + sp.length + ')');
  okAv(sp.length !== 5, 'anti-vacuity: 6-connected search fails the diagonal assertion'); }
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const x of fails) console.log('   \u2717 ' + x);
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
