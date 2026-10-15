#!/usr/bin/env node
// patrolleadercheck.mjs — #744: Ai.PatrolGoal findPatrolTargets. Breaks its own data.
// (scaffold copied from raidgoalresiduecheck.mjs)
// PatrolApproachGoal's
// isRaidCenterSet() is PatrolEntity's `patrolling` flag (not hasPatrolTarget); pillager's
// priority-8 goal is a real WanderAroundGoal; vindicator/pillager/ravager's ActiveTargetGoals
// refuse an unseen candidate (TargetPredicate.respectsVisibility) and, with mustSee, drop one
// unseen > 60 ticks (TrackTargetGoal.shouldContinue). Every section breaks its own data.
//
//   node tools/raidgoalresiduecheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('patrolleadercheck — #2481: lone leader near target keeps patrolTarget (vanilla if/else-if)');

const M = loadEngine({
  // loop/spells-s93 — `07k_goals.js`'s evoker/illusioner roster entries now construct
  // `NS.Spell.*Goal`s (07v_spell.js); AFTER 07q_effects.js (NS.Spell.init needs NS.Effects),
  // BEFORE 07k_goals.js (build.mjs's own order — see there).
  // D-602 (raidergoals) added `02g_items.js`/`02f_tags.js`/`14f_inventory.js`/`07y_equip.js`/
  // `07b_behaviour.js`/`07l_spawn.js` — merchant/iron-golem/johnny targeting, the vindicator's
  // own BreakDoorGoal (needs `M.Diff`, `07l_spawn.js`) and the CrossbowAttackGoal
  // isEntityHoldingCrossbow() gate (needs `NS.Equip`/`NS.Items` real, not the "always assumed"
  // fallback) all need real equipment/items/door-block/difficulty modules §4 never did —
  // `build.mjs`'s own order (villagegolemcheck.mjs's own EXTRA list already proves this exact
  // module set loads and inits cleanly together for villager/iron_golem, reused here).
  extra: ['02g_items.js', '02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js',
          '07y_equip.js', '07i_entitylist.js', '14b_physics.js', '14d_survival.js',
          '14f_inventory.js', '14i_hand.js', '07q_effects.js', '14j_combat.js', '07v_spell.js',
          '07k_goals.js', '07l_spawn.js',
          // loop/raidvex-s96 -- `Ai.ROSTER.vex` (07k_goals.js) constructs `NS.Fly.
          // VexMoveControl`; `07t_fly.js` is loaded straight after, matching build.mjs's own
          // relative order (it does not matter which loads first — ROSTER factories are only
          // ever CALLED at spawn time, after every module has finished loading).
          '07t_fly.js']
});
const entitiesJson = JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'));
M.DATA = Object.assign({}, M.DATA, { entities: entitiesJson });
M.Entities.init();
{
  const imeta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
}
M.EntityList.init();
M.Hand.init();
M.Combat.init();
M.Ai.init();
M.Equip.init();
ok(M.Entities.ready, 'the entity table loaded');
ok(M.Ai.ready, 'Ai module reports ready');
ok(M.Equip.ready, 'D-602: Equip module reports ready (real crossbow/bow-holding reads, not the "always assumed" fallback)');

const EL = M.EntityList, Ai = M.Ai, Cb = M.Combat, W = M.World, CH = M.CH, Diff = M.Diff, Eq = M.Equip, IT = M.Items;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8;
M.Behave.init(M.World);

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  ok(W.loadedAt(0, 0), 'a chunk is loaded to place into');
}
function plate(radius) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    W.setBlock(x, PLAT_Y, z, STONE);
  }
}
function mkPlayer(over) {
  return Object.assign({
    x: 0, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: null,
    sprinting: false, onGround: true, fallDistance: 0, onClimbable: false, inWater: false,
    walkDist: 0, walkDistO: 0, speed: 0.1, health: 20
  }, over || {});
}

const RAID_MOBS = ['vindicator', 'pillager', 'witch', 'ravager', 'evoker', 'illusioner'];

{
  freshWorld(); plate(30);
  Ai.findPath = (x, y, z, tx, ty, tz) => [{ x, y, z }, { x: tx, y: ty, z: tz }];
  const run = (l, ticks) => { const g = new Ai.PatrolGoal(l, EL.aiCtx(l)); g.start(); for (let i = 0; i < ticks; i++) g.tick(); };
  const mk = () => {
    const l = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
    l.patrolLeader = true; l.patrolling = true; l.patrolTarget = { x: 5, y: PLAT_Y + 1, z: 0 };
    return l;
  };
  let l = mk();
  run(l, 3);
  okAv(l.patrolTarget.x === 5 && l.patrolTarget.z === 0, 'lone leader near its target: patrolTarget untouched');
  okAv(l.patrolling === false, 'lone leader: patrolling cleared');
  EL.clear();
  freshWorld(); plate(30);
  l = mk();
  EL.spawn('pillager', 3, PLAT_Y + 1, 0);
  run(l, 3);
  okAv(!(l.patrolTarget.x === 5 && l.patrolTarget.z === 0), 'leader with a mate near its target: fresh patrolTarget');
  EL.clear();
}

console.log(`\n${fails.length === 0 ? 'PASS' : 'FAIL'} patrolleadercheck: ${pass} assertions, ${breaks} breaks caught, ${fails.length} failure(s)`);
console.log(`${breaks} breaks caught`);
if (fails.length) { for (const f of fails.slice(0, 40)) console.log('   x ' + f); process.exit(1); }
