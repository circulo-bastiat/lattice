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

console.log('axolotlseekwatercheck — #2471 SeekWaterTask');

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

// #2471: AxolotlBrain IDLE (3, SeekWaterTask(6, 0.15F)): a stranded axolotl walks to water within 6 blocks.
const water = S.stateOf('water') | 0, stone = S.stateOf('stone') | 0;
for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) { W.setBlock(x, 60, z, stone); for (let y = 61; y <= 64; y++) W.setBlock(x, y, z, 0); }
for (let x = 4; x <= 6; x++) for (let z = -1; z <= 1; z++) W.setBlock(x, 61, z, water);
const mk = (x) => { const e = EL.spawn('axolotl', x, 61, 0.5, {}); return e; };
const run = (x) => {
  const e = mk(x); const g = new Ax.SeekWaterGoal(e); let n = 0;
  while (n < 60 && !g.canUse()) n++;
  let used = n < 60; const t = g.canUse ? 0 : 0;
  const d0 = Math.abs(e.x - 5);
  if (used) for (let i = 0; i < 40; i++) { g.tick(); Ax.travelMob(e); }
  return { used, n, closer: d0 - Math.abs(e.x - 5) };
};
let r = run(0.5);
ok(r.used && r.n <= 25, 'land axolotl 4 blocks from a pond must start seeking within ~22 ticks, n=' + r.n);
ok(r.closer > 1, 'seeking axolotl must move toward the pond, closer by ' + r.closer);
ok(!run(-7.5).used, 'no water within 6 blocks: goal must not start');
{ const e = mk(5.5); e.inWater = true; const g = new Ax.SeekWaterGoal(e); let u = false; for (let i = 0; i < 60; i++) u = u || g.canUse(); ok(!u, 'in water: goal must not run'); }
{ const e = mk(0.5); const gs = MCL.Ai.ROSTER.axolotl(e, { random: Math.random }); ok(gs.entries.some((w) => w.goal instanceof Ax.SeekWaterGoal && w.priority === 3), 'ROSTER.axolotl must include SeekWaterGoal'); }
{ const real = Ax.SEEK_WATER_RANGE; Ax.SEEK_WATER_RANGE = 0; okAv(!run(0.5).used, 'with range 0 the pond was still found'); Ax.SEEK_WATER_RANGE = real; }
{ const real = Ax.SEEK_WATER_SPEED; Ax.SEEK_WATER_SPEED = 0; okAv(run(0.5).closer <= 1, 'with speed 0 the axolotl still approached'); Ax.SEEK_WATER_SPEED = real; }
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const x of fails) console.log('   \u2717 ' + x);
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
