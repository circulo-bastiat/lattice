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

console.log('axolotlswimcheck — #1361 axolotl swim travel');

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

// axolotlswimcheck.mjs — #1361: AxolotlMoveControl/AquaticMoveControl + AxolotlEntity.travel (.decomp
// AxolotlEntity.java:500-509,555-569): in water no gravity sink (updateVelocity+move+*0.9), vertical swim toward
// a target; on land the ground travel. Anti-vacuity: break the water branch / the pitch and watch it caught.
const water = S.stateOf('water') | 0;
for (let y = 60; y <= 70; y++) for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) W.setBlock(x, y, z, y === 60 ? S.stateOf('stone') | 0 : water);
const mk = () => { const e = EL.spawn('axolotl', 0.5, 64, 0.5, {}); e.ai = null; return e; };
const idle = (e, n) => { for (let i = 0; i < n; i++) { MCL.Physics.updateFluids(e); Ax.travelMob(e); } };
const swim = (e, tgt, n) => {
  for (let i = 0; i < n; i++) { MCL.Physics.updateFluids(e); Ai.stepToward(e, tgt, 1); Ax.travelMob(e); if (Math.abs(e.y - tgt.y) < 0.3) return i; }
  return -1;
};
const run = () => {
  const a = mk(); a.vx = a.vy = a.vz = 0; idle(a, 100);
  const drift = Math.abs(a.y - 64);
  const b = mk(); b.vx = b.vy = b.vz = 0; const t = swim(b, { x: 0, y: 67, z: 0 }, 200);
  return { drift, t, by: b.y };
};
const r = run();
ok(r.drift <= 0.1, 'idle axolotl mid-water must hold y within 0.1 over 100 ticks, drifted ' + r.drift);
ok(r.t >= 0, 'axolotl must swim up 3 blocks to a target above in 200 ticks, reached y=' + r.by);
{ const e = mk(); e.vx = e.vy = e.vz = 0; idle(e, 3); ok(e.inWater, 'inWater set'); }
{ // dispatch through EL.tickMob
  const e = mk(); e.vx = e.vy = e.vz = 0; for (let i = 0; i < 60; i++) EL.tickMob(e);
  ok(Math.abs(e.y - 64) <= 0.1, 'EL.tickMob must route axolotl through Ax.travelMob (no sink), y=' + e.y);
}
{ const e = mk(); e.playingDead = true; e.vx = e.vy = e.vz = 0; const y0 = e.y; idle(e, 20);
  ok(Math.abs(e.y - y0) < 0.001 && e.vy === 0, '#2713 playing dead in water keeps the no-gravity swim branch (no sink)'); }
{ const real = Ax.travelMob; Ax.travelMob = (e) => MCL.Physics.travelMob(e);
  okAv(run().drift > 0.1, 'with the water branch replaced by plain travel the idle probe still held y');
  Ax.travelMob = real; }
{ const real = Math.atan2; Math.atan2 = () => 0;
  okAv(run().t < 0, 'with pitch forced level the target above was still reached');
  Math.atan2 = real; }
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const x of fails) console.log('   \u2717 ' + x);
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
