#!/usr/bin/env node
// spawnloccheck.mjs — cloud owed-spawn-owed: `SpawnRestriction`'s per-type LOCATION (ON_GROUND /
// IN_WATER / IN_LAVA / NO_RESTRICTIONS) as `Spawn.checkPlacement` asks it.
//
//   node tools/spawnloccheck.mjs [--verbose]
//
// Before this, every type was cleared as ON_GROUND, which refuses a water cell: no axolotl,
// squid, fish, dolphin, drowned or guardian could ever be placed naturally (Spawn.OWED's own
// "the axolotls category has no placeable member" line was the visible end of it).
//
//   1. Spawn.LOCATION == the table tools/spawnloc-decomp.mjs reads out of .decomp, both directions
//   2. Spawn.locationOk per location, both directions (in_water / in_lava / on_ground / none)
//   3. Spawn.checkPlacement: axolotl in water over clay places; out of water, or under a solid
//      block, it does not; a zombie in water does not; a spawner asks no location (MobSpawnerLogic)
//   4. RANDOM_Y_CATEGORY covers every category whose members are all IN_WATER/IN_LAVA (derived)
//   5. anti-vacuity — break the parse, the table, the category list; each break is caught

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { parseSpawnLocations, readDecomp, decompPresent } from './spawnloc-decomp.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('spawnloccheck — cloud owed-spawn-owed, SpawnRestriction.Location in Spawn.checkPlacement');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07z_potion.js',
               '07m_breed.js', '07zh_rabbit.js', '07zj_fox.js', '07zj_goat.js', '07zl_panda.js',
               '07q_effects.js', '07zm_axolotl.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities, W = MCL.World, S = MCL.States;
Ent.init(); Ent.attrs = MCL.DATA.entities.attrs;
W.init(1); MCL.Behave.init(W); EL.init(); Ai.init(); Spawn.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const st = (n) => S.stateOf(n) | 0;
const AIR = 0, WATER = st('water'), LAVA = st('lava'), CLAY = st('clay'), STONE = st('stone'), GLASS = st('glass');

// ── 1. the table vs .decomp ────────────────────────────────────────────────────────────────────
say('1. Spawn.LOCATION vs .decomp/SpawnRestriction.java');
const sameTable = (a, b) => Object.keys(a).every((k) => a[k] === b[k]) && Object.keys(b).every((k) => b[k] === a[k]);
let decomp = null, derived = null;
if (ok(decompPresent(), '.decomp/ is missing — `node tools/cloud/bootstrap.mjs` (cloud) or D-488 (PC) puts it in place')) {
  decomp = readDecomp();
  derived = parseSpawnLocations(decomp).table;
  ok(Object.keys(derived).length >= 60, `.decomp registers ${Object.keys(derived).length} types — the parse is wrong`);
  for (const [id, loc] of Object.entries(derived))
    ok(Spawn.LOCATION[id] === loc, `Spawn.LOCATION.${id} = ${Spawn.LOCATION[id]}, .decomp says ${loc}`);
  for (const id of Object.keys(Spawn.LOCATION))
    ok(id in derived, `Spawn.LOCATION.${id} is not a SpawnRestriction registration in .decomp`);
  ok(Spawn.locationOf('minecraft:axolotl') === 'in_water', 'locationOf strips the namespace');
  ok(Spawn.locationOf('item') === 'none', 'an unregistered type is NO_RESTRICTIONS (getLocation\'s null branch)');
}

// ── 2. Spawn.locationOk ───────────────────────────────────────────────────────────────────────
say('2. Spawn.locationOk, both directions');
const col = (x, z, cells) => { for (const [y, s] of cells) W.setBlock(x, y, z, s); };
col(0, 0, [[60, CLAY], [61, WATER], [62, WATER], [63, AIR]]);
ok(Spawn.locationOk('in_water', 0, 61, 0), 'in_water: a water cell under water');
ok(Spawn.locationOk('in_water', 0, 62, 0), 'in_water: a water cell under air');
ok(!Spawn.locationOk('in_water', 0, 63, 0), 'in_water: an air cell is refused');
col(1, 0, [[60, CLAY], [61, WATER], [62, STONE]]);
ok(!Spawn.locationOk('in_water', 1, 61, 0), 'in_water: a solid full cube above is refused');
col(2, 0, [[60, CLAY], [61, WATER], [62, GLASS]]);
ok(!Spawn.locationOk('in_water', 2, 61, 0), 'in_water: glass above is a solid block (isSolidBlock) and is refused');
col(12, 12, [[60, STONE], [61, LAVA], [62, AIR]]);  // far from the water: lava beside water is obsidian
ok(Spawn.locationOk('in_lava', 12, 61, 12), 'in_lava: a lava cell');
ok(!Spawn.locationOk('in_lava', 0, 61, 0), 'in_lava: a water cell is refused');
ok(!Spawn.locationOk('in_lava', 12, 62, 12), 'in_lava: an air cell is refused');
col(4, 0, [[60, STONE], [61, AIR], [62, AIR]]);
ok(Spawn.locationOk('on_ground', 4, 61, 0), 'on_ground: two clear cells');
ok(!Spawn.locationOk('on_ground', 0, 61, 0), 'on_ground: a water cell is refused (isClearForSpawn: no fluid)');
ok(Spawn.locationOk('none', 12, 61, 12) && Spawn.locationOk('none', 0, 61, 0), 'none: anything');

// ── 3. Spawn.checkPlacement ────────────────────────────────────────────────────────────────────
say('3. Spawn.checkPlacement');
const place = (t, x, y, z, r) => Spawn.checkPlacement(t, x, y, z, r || 'natural', () => 0);
ok(place('axolotl', 0, 61, 0), 'an axolotl in water over clay is placeable (was refused as ON_GROUND)');
col(5, 0, [[60, CLAY], [61, AIR], [62, AIR]]);
ok(Spawn.RULES.axolotl(5, 61, 0), 'setup: the axolotl rule alone passes over dry clay');
ok(!place('axolotl', 5, 61, 0), 'an axolotl in AIR over clay is not naturally placeable (IN_WATER)');
ok(!place('axolotl', 1, 61, 0), 'an axolotl in water under stone is not placeable');
ok(place('axolotl', 5, 61, 0, 'spawner'), 'a spawner asks no location: axolotl over clay in air (MobSpawnerLogic:97/109)');
col(7, 0, [[59, CLAY], [60, CLAY], [61, STONE], [62, AIR]]);
ok(!place('axolotl', 7, 61, 0, 'spawner'), 'a spawner still asks isSpaceEmpty: an axolotl inside stone is refused');

// ── 4. random-Y categories ───────────────────────────────────────────────────────────────────
say('4. RANDOM_Y_CATEGORY covers every all-fluid category');
function fluidCats(LOC, RY) {
  const byCat = {};
  for (const [t, row] of Object.entries(Spawn.DESPAWN_TYPES)) {
    const loc = LOC[t] || 'none';
    (byCat[row[0]] = byCat[row[0]] || []).push(loc === 'in_water' || loc === 'in_lava');
  }
  const bad = [];
  for (const [cat, flags] of Object.entries(byCat)) if (flags.length && flags.every(Boolean) && RY[cat] !== 1) bad.push(cat);
  return { byCat, bad };
}
{
  const { byCat, bad } = fluidCats(Spawn.LOCATION, Spawn.RANDOM_Y_CATEGORY);
  ok('axolotls' in byCat, 'the axolotls category has a member in Spawn.DESPAWN_TYPES');
  ok(bad.length === 0, `all-fluid categories not searched at a random Y: ${bad.join(', ')}`);
}

// ── 5. anti-vacuity ─────────────────────────────────────────────────────────────────────────
say('5. anti-vacuity');
if (derived) {
  const reparse = (d) => { try { return parseSpawnLocations(d).table; } catch (e) { return null; } };
  const swapped = reparse({ ...decomp, fluidTags: decomp.fluidTags.replace('register("water")', 'register("tmp")')
    .replace('register("lava")', 'register("water")').replace('register("tmp")', 'register("lava")') });
  okAv(swapped && !sameTable(swapped, Spawn.LOCATION), 'break: FluidTags water/lava swapped in the parse — the table no longer matches');
  const blind = reparse({ ...decomp, fluidTags: decomp.fluidTags.replace('register("water")', 'register("wat3r")') });
  okAv(blind === null, 'break: the water tag unreadable — the parse refuses rather than guessing');
  const d2 = { ...derived, axolotl: 'on_ground' };
  okAv(!sameTable(d2, Spawn.LOCATION), 'break: axolotl read as on_ground — the comparison catches it');
  const d3 = { ...derived, not_a_mob: 'none' };
  okAv(!sameTable(d3, Spawn.LOCATION), 'break: an extra registration — the reverse direction catches it');
}
{
  const saved = Spawn.LOCATION.axolotl;
  Spawn.LOCATION.axolotl = 'on_ground';
  okAv(!place('axolotl', 0, 61, 0), 'break: axolotl as ON_GROUND — the water placement is refused again (the old bug)');
  Spawn.LOCATION.axolotl = saved;
}
{
  const ry = { ...Spawn.RANDOM_Y_CATEGORY }; delete ry.axolotls;
  okAv(fluidCats(Spawn.LOCATION, ry).bad.includes('axolotls'), 'break: axolotls dropped from RANDOM_Y_CATEGORY — caught');
}
{
  const savedLoc = Spawn.locationOk;
  Spawn.locationOk = () => false;
  okAv(place('axolotl', 5, 61, 0, 'spawner') && !place('axolotl', 0, 61, 0), 'break: locationOk always false — natural refused, spawner unaffected');
  Spawn.locationOk = savedLoc;
}

console.log('================ spawnloccheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('===============================================');
process.exit(fails.length ? 1 : 0);
