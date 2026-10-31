#!/usr/bin/env node
// giantcheck.mjs — QUEUE 0.00 part 2 (G18 leftover): giant is now spawnable via EL.spawn.
//
// .decomp read whole: net/minecraft/entity/mob/GiantEntity.java (33 lines -- overrides only
// getActiveEyeHeight/createGiantAttributes/getPathfindingFavor; no initGoals, no getGravity(),
// no drag-affecting tick method); EntityRenderers.java (`new GiantEntityRenderer($$0, 6.0F)`,
// EntityType.Builder `.setDimensions(3.6F, 12.0F)`).
//
//   node tools/giantcheck.mjs [--verbose]
//
// Sections:
//   1. EL.canSpawn('giant') is true and EL.spawn actually produces one (D-391's own closed-set
//      gate -- this is the assertion that FAILS without 07i_entitylist.js's motionFor row).
//   2. the spawned entity's hitbox is the real 3.6 x 12 vanilla constant (`entity-types-
//      1.18.2.tsv`'s own `giant` row), not the un-scaled zombie 0.6 x 1.95.
//   3. the render-time scale factor (`ER.RENDER_SCALE.giant`) is the real vanilla 6.0F
//      (`EntityRenderers.java`'s own literal), and 3.6/0.6 == 12/1.95 == 6 -- the hitbox growth
//      and the draw-time growth agree, both off the SAME .decomp-read factor.
//   4. anti-vacuity: a type nobody has ever wired (a made-up name) is still refused by
//      EL.canSpawn/EL.spawn, so this is a real closed-set gate, not one that now says yes to
//      everything.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m) && !VERBOSE) console.log('   ✓ ' + m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('giantcheck -- QUEUE 0.00 part 2: giant spawnable via EL.spawn, real hitbox + render scale');

const M = loadEngine({ extra: ['07h_entities.js', '07_world.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '14j_combat.js'], dom: false });
if (initRegistry) initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.World.init(1);
M.Physics.init && M.Physics.init();
M.EntityList.init();

const EL = M.EntityList, E = M.Entities, ER = M.EntityRender || M.ER;

ok(E.ready === true, 'Entities.ready is true');
ok(EL.ready === true, 'EL.ready is true');

// ============ 1. spawnability ================================================================
ok(EL.canSpawn('giant') === true, "EL.canSpawn('giant') is true");
const g = EL.spawn('giant', 0, 5, 0);
ok(g !== null, 'EL.spawn(giant, ...) returns a live entity, not null');
ok(!!g && g.type === 'giant', "the spawned entity's type is 'giant'");

// ============ 2. real vanilla hitbox (entity-types-1.18.2.tsv: giant 3.6 x 12) ===============
ok(!!g && near(g.width, 3.6), 'spawned giant width is the real vanilla 3.6 (not zombie\'s 0.6)');
ok(!!g && near(g.height, 12.0), 'spawned giant height is the real vanilla 12.0 (not zombie\'s 1.95)');

// ============ 3. the render-time 6x scale (EntityRenderers.java: new GiantEntityRenderer(ctx, 6.0F))
ok(!!ER && ER.RENDER_SCALE && near(ER.RENDER_SCALE.giant, 6.0), 'ER.RENDER_SCALE.giant is the real vanilla 6.0F');
// the WIDTH growth agrees with the render-time factor read above (3.6 / 0.6 == 6 exactly);
// the HEIGHT does NOT (12.0 / 1.95 == 6.1538..., not 6) -- EntityType.Builder's own
// `.setDimensions(3.6F, 12.0F)` is an independently-set literal, not `zombieDims * 6`, so this
// check asserts the real bytecode-read numbers rather than a "scale factor squared" guess.
const zd = E.dimensions('zombie'), gd = E.dimensions('giant');
ok(!!zd && !!gd && near(gd.width / zd.width, 6.0),
  "giant's WIDTH is exactly 6x zombie's own (3.6 / 0.6 == 6), matching ER.RENDER_SCALE.giant");
ok(!!zd && !!gd && !near(gd.height / zd.height, 6.0) && near(gd.height, 12.0),
  "giant's HEIGHT is the real 12.0 literal, NOT simply 6x zombie's 1.95 (11.7) -- .decomp's own setDimensions(3.6F, 12.0F)");

// ============ 3b. #912 eye height: GiantEntity.getActiveEyeHeight = 10.440001F, not height*0.85 (10.2)
const Cb = M.Combat || M.Cb;
ok(!!g && !!Cb && Cb.eyeHeightOf(g) === Math.fround(10.440001), 'Cb.eyeHeightOf(giant) === fround(10.440001)');
ok(!!ER && ER.eyeHeightStanding('giant') === Math.fround(10.440001), 'ER.eyeHeightStanding(giant) === fround(10.440001)');
okAv(!!g && Cb.eyeHeightOf({ type: 'zombie_x', height: 12 }) !== Math.fround(10.440001), 'the height*0.85 fallback (10.2) is not the giant value');

// ============ 4. anti-vacuity: the closed set still refuses an unbuilt type ===================
okAv(EL.canSpawn('not_a_real_mob_xyz') === false, "a made-up type is still refused (EL.canSpawn)");
okAv(EL.spawn('not_a_real_mob_xyz', 0, 5, 0) === null, "a made-up type is still refused (EL.spawn)");

console.log(`giantcheck: ${pass}/${pass + fails.length} passed, ${breaks} anti-vacuity break(s) verified`);
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
process.exit(0);
