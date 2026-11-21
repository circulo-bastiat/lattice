#!/usr/bin/env node
// professioncheck.mjs — PLAN G18f unit 2 (D-479): PROFESSIONS AND WORKSTATIONS, the registry.
//
//   node tools/professioncheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. `Prof.WORKSTATIONS` is read by hand off `bnz`/`bhv`/`cdr`'s own bytecode
// (DECISIONS.md D-479 has the disassembly), so this does not re-derive the mapping — it proves
// the REGISTRY matches the jar-read table exactly (a corrupted row is caught, rule 1), and that
// `Prof.tryClaim`'s adjacency rule actually GRANTS a profession from a real workstation and
// REFUSES both a wrong block and an already-claimed one (rule 6, both directions).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, m ? 'anti-vacuity: ' + m : m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('professioncheck — PLAN G18f unit 2 (D-479), professions/workstations');

const MCL = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07o_profession.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js',
          '14j_combat.js'],
  dom: false
});
const W = MCL.World, S = MCL.States, B = MCL.Behave, CH = MCL.CH;
const EL = MCL.EntityList, Prof = MCL.Profession, Cb = MCL.Combat;

B.init(W);
MCL.DATA = Object.assign({}, MCL.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
MCL.Entities.init();
EL.init();
MCL.Ai.init();
Prof.init();

ok(Prof.ready, 'Profession module reports ready');
if (!Prof.ready) { console.log('\nFAIL  Profession did not initialise'); process.exit(1); }

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  Prof.claimed = {};
  EL.clear();
}
// G18f-J1: the combat tick no longer calls tryClaim (the Brain acquires jobs now); this check
// tests tryClaim's adjacency rule itself, so it calls it explicitly.
function tk(e) { Prof.tryClaim(e); Cb.tickEntity(e); }
function blockAt(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
function villagerAt(x, y, z) { return EL.spawn('villager', x, y, z); }

// ── §1. the registry — 15 professions, the jar-verified block for each ───────────────────────────────────────────
say('\n§1 — the registry');
ok(Prof.ALL.length === 15, 'Prof.ALL carries all 15 bnz constants (' + Prof.ALL.length + ')');
const EXPECT = {
  armorer: 'blast_furnace', butcher: 'smoker', cartographer: 'cartography_table',
  cleric: 'brewing_stand', farmer: 'composter', fisherman: 'barrel',
  fletcher: 'fletching_table', librarian: 'lectern', mason: 'stonecutter',
  shepherd: 'loom', toolsmith: 'smithing_table', weaponsmith: 'grindstone'
};
for (const p in EXPECT) {
  ok(Prof.WORKSTATIONS[p].indexOf(EXPECT[p]) >= 0, p + ' → ' + EXPECT[p] + ' (bhv/cdr, D-479)');
}
ok(Prof.WORKSTATIONS.leatherworker.length === 4 &&
   ['cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron']
     .every((b) => Prof.WORKSTATIONS.leatherworker.indexOf(b) >= 0),
   'leatherworker → all 4 cauldron blocks (bhv.k’s own 4-member set)');
ok(!Prof.WORKSTATIONS.none && !Prof.WORKSTATIONS.nitwit,
   'none/nitwit carry no workstation (bhv.c/bhv.n’s own empty set)');

// ── §2. professionForBlockName — both directions ───────────────────────────────────────────
say('\n§2 — professionForBlockName, both directions');
ok(Prof.professionForBlockName('smoker') === 'butcher', 'smoker → butcher');
ok(Prof.professionForBlockName('lava_cauldron') === 'leatherworker', 'lava_cauldron → leatherworker');
ok(Prof.professionForBlockName('stone') === null, 'stone → null (not a workstation)');
ok(Prof.professionForBlockName('furnace') === null,
   'furnace → null (plain furnace is NOT armorer’s blast_furnace — a real vanilla distinction)');
ok(Prof.professionForBlockName(null) === null, 'no name → null, not a throw');

// ── §3. tryClaim — a villager next to its real workstation takes the job ──────────────────
say('\n§3 — tryClaim: adjacency grants the right profession');
freshWorld();
blockAt(1, 64, 0, 'smoker');
let v = villagerAt(0, 64, 0);
ok(v.profession === 'none', 'villager spawns unemployed');
tk(v);
ok(v.profession === 'butcher', 'adjacent to a smoker → claims butcher (got ' + v.profession + ')');
ok(!!v.workstation && v.workstation.x === 1 && v.workstation.y === 64 && v.workstation.z === 0,
   'e.workstation records the claimed block’s position');
ok(Prof.claimed['1,64,0'] === v.id, 'the block itself is marked claimed, keyed by position');

// ── §4. tryClaim — both directions: wrong block refuses, no block refuses ──────────────────
say('\n§4 — tryClaim refuses, both directions');
freshWorld();
blockAt(1, 64, 0, 'stone');
v = villagerAt(0, 64, 0);
tk(v);
ok(v.profession === 'none', 'a stone neighbour grants no profession');

freshWorld();
v = villagerAt(0, 64, 0);
tk(v);
ok(v.profession === 'none', 'no neighbours at all → stays unemployed, no throw');

// ── §5. rule 6, both directions again: ONE workstation cannot employ TWO villagers ─────────
say('\n§5 — a claimed workstation refuses a second villager');
freshWorld();
blockAt(1, 64, 0, 'loom');
const v1 = villagerAt(0, 64, 0);
const v2 = villagerAt(2, 64, 0);   // also adjacent to the same (1,64,0) loom
tk(v1);
tk(v2);
ok(v1.profession === 'shepherd', 'the first villager claims the loom (shepherd)');
ok(v2.profession === 'none', 'the second villager, same loom, gets nothing — one job, one villager');

// ── §5b. releaseAt — breaking the workstation frees the slot, keeps the profession ─────────
say('\n§5b — releaseAt frees the slot, not the profession');
freshWorld();
blockAt(1, 64, 0, 'composter');
const v3 = villagerAt(0, 64, 0);
tk(v3);
ok(v3.profession === 'farmer', 'claims farmer off the composter');
Prof.releaseAt(1, 64, 0);
ok(Prof.claimed['1,64,0'] === undefined, 'releaseAt frees the claim slot');
ok(v3.profession === 'none', 'releaseAt strips a fresh villager\'s profession (LoseJobOnSiteLossTask)');
blockAt(1, 64, 0, 'loom');
const v4 = villagerAt(2, 64, 0);
tk(v4);
ok(v4.profession === 'shepherd', 'a second villager can claim the freed slot once it holds a new workstation');

// ── §5b. LoseJobOnSiteLossTask — breaking the claimed site strips a fresh villager's job ────
say('\n§5b — job loss on site loss');
function jobLoss(station, prof, setup, skip) {
  freshWorld();
  Prof.skip = skip || {};
  blockAt(1, 64, 0, station);
  const e = villagerAt(0, 64, 0);
  tk(e);
  if (setup) setup(e);
  const holder = Prof.releaseAt(1, 64, 0);
  Prof.skip = {};
  return { e, holder, prof };
}
{
  let r = jobLoss('composter', 'farmer');
  ok(r.holder === r.e && r.e.profession === 'none' && !r.e.workstation, 'fresh farmer loses job');
  blockAt(1, 64, 0, 'air');
  blockAt(-1, 64, 0, 'lectern');
  tk(r.e);
  ok(r.e.profession === 'librarian', 'ex-farmer claims a different free station');
  r = jobLoss('lectern', 'librarian');
  ok(r.e.profession === 'none', 'fresh librarian loses job');
  r = jobLoss('composter', 'farmer', (e) => { e.tradeXp = 5; });
  ok(r.e.profession === 'farmer', 'xp>0 keeps profession');
  r = jobLoss('composter', 'farmer', (e) => { e.villagerLevel = 2; });
  ok(r.e.profession === 'farmer', 'level>1 keeps profession');
  r = jobLoss('composter', 'farmer', (e) => { e.profession = 'nitwit'; });
  ok(r.e.profession === 'nitwit', 'nitwit untouched');
}
{
  let r = jobLoss('composter', 'farmer', (e) => { e.tradeXp = 5; }, { guard: 1 });
  okAv(r.e.profession === 'none', 'skipping the xp/level guard is caught');
  r = jobLoss('composter', 'farmer', null, { reset: 1 });
  okAv(r.e.profession !== 'none', 'skipping the profession reset is caught');
  r = jobLoss('composter', 'farmer', null, { holder: 1 });
  okAv(r.holder === null && r.e.profession === 'farmer', 'skipping the holder lookup is caught');
}

// ── §6. anti-vacuity — break the registry and the claim rule, both must actually fail ────────
say('\n§6 — anti-vacuity');
{
  const real = Prof.WORKSTATIONS.butcher;
  Prof.WORKSTATIONS.butcher = ['stonecutter'];   // wrong on purpose
  Prof.init();   // blockToProfession is built once from WORKSTATIONS; rebuild it to see the break
  okAv(Prof.professionForBlockName('smoker') !== 'butcher',
    'a corrupted registry row is caught (smoker no longer reads as butcher)');
  Prof.WORKSTATIONS.butcher = real;
  Prof.init();
}
{
  const realN = Prof.NEIGHBOURS;
  Prof.NEIGHBOURS = [];
  freshWorld();
  blockAt(1, 64, 0, 'smoker');
  const dead = villagerAt(0, 64, 0);
  tk(dead);
  okAv(dead.profession === 'none', 'an empty neighbour list is caught (claim can be made to fail)');
  Prof.NEIGHBOURS = realN;
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed, ' + breaks + ' anti-vacuity breaks caught');
if (fails.length) {
  console.log('FAILURES:');
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
console.log('professioncheck: PASS');
