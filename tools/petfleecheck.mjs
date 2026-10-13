#!/usr/bin/env node
// petfleecheck.mjs -- D-707 leftover unit (this pass, mob-test-passive-leftover), cat/ocelot
// flee RANGE only.
//
//   node tools/petfleecheck.mjs [--verbose]
//
// WHAT THIS PROVES. .decomp's own CatEntity.java:471 (onTamedChanged) and
// OcelotEntity.java:224 build their flee goal as new ...FleeGoal<>(this, PlayerEntity.class,
// 16.0F, 0.8, 1.33) -- the THIRD constructor argument, 16.0F, is the distance at which the goal's
// own canUse() starts firing (this engine's Ai.AvoidEntityGoal's own range argument, same
// semantic: d <= range). Ai.ROSTER.cat/Ai.ROSTER.ocelot (07k_goals.js) had this wired to 6,
// not 16 -- a wild cat or ocelot stood still while a player walked to within 6 blocks of it,
// instead of bolting the moment one came within 16, as vanilla's own two constructors say. This
// check drives the REAL Ai.ROSTER.cat/Ai.ROSTER.ocelot factories (not a copy of the goal) and
// proves the live flee goal actually fires at the vanilla distance, in both directions (rule 6):
// it must fire somewhere in (6, 16] and must NOT fire past 16.
//
// This does not touch the dual walk/sprint speed (0.8/1.33) or the crouch/sprint pose vanilla's
// mobTick drives from it -- Ai.OWED's new entry (07k_goals.js, appended this pass) names that
// gap explicitly; .decomp does not ship AvoidEntityGoal.java itself, so there is no cited
// switch-distance to test against, and guessing one would violate the project's own evidence
// rule. Only the RADIUS bug, which is fully cited, is fixed and checked here.

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
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ok ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('petfleecheck -- D-707 leftover unit, cat/ocelot flee range (this pass)');

const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Behave.init(M.World);
M.Ai.init();
ok(M.Ai.ready, 'Ai module reports ready');

const Ai = M.Ai, W = M.World, CH = M.CH;
const STONE = M.States.stateOf('stone') | 0;
// KW-45 follow-up: `Ai.AvoidEntityGoal`'s canUse() now actually pathfinds the escape point
// (same as vanilla's own FleeEntityGoal.canStart), so a real floor is required -- an unloaded
// world (D-73) is treated as solid everywhere and no path is ever found. A flat plate wide
// enough for the ±16-block fuzzed search from any mob position this file uses.
W.init(1);
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz);
  c.state = CH.GENERATED;
  W.chunks.set(W.key(cx, cz), c);
}
for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) W.setBlock(x, 7, z, STONE);
function mob(type, x, y, z) {
  return { id: 1, type, x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.6, height: 0.7, tamed: false };
}
function player(x, y, z) { return { x, y, z, height: 1.8 }; }

function findFleeGoal(gs) {
  // #213: CatEntity.onTamedChanged / OcelotEntity.updateFleeing add the flee goal at priority 4 (goals-1.18.2.tsv)
  const hit = gs.entries.filter((e) => e.priority === 4 && e.flags === Ai.MOVE);
  return hit.length === 1 ? hit[0].goal : null;
}

for (const kind of ['cat', 'ocelot']) {
  say('\n-- ' + kind + ' --');
  const e = mob(kind, 0, 8, 0);
  const p = player(10, 8, 0);
  const ctx = {
    players: () => [p], animals: () => [], onBreed: () => {},
    isTempting: () => false, random: Math.random
  };
  const gs = Ai.ROSTER[kind](e, ctx);
  const flee = findFleeGoal(gs);
  ok(!!flee, kind + "'s ROSTER factory has exactly one priority-4 MOVE-only goal (the flee goal)");
  if (!flee) continue;

  // KW-45 follow-up: canUse() now re-derives vanilla's own fuzzed 10-candidate escape search
  // (real RNG per attempt), exactly as probabilistic as a real goal selector's per-tick retries.
  let fled = false;
  for (let i = 0; i < 30 && !fled; i++) fled = flee.canUse();
  ok(fled === true,
     kind + ' 10 blocks from a player DOES flee (vanilla FleeGoal radius is 16.0F, ' +
     '.decomp CatEntity.java:471/OcelotEntity.java:224) -- was false when the radius was 6');

  e.x = 0; p.x = 20;
  ok(flee.canUse() === false, kind + ' 20 blocks from a player does NOT flee (past vanilla 16.0F radius)');

  // #3156: EXCEPT_CREATIVE_OR_SPECTATOR -- a creative/spectator player is never a flee threat.
  e.x = 0; p.x = 10; p.invulnerableGamemode = true;
  let fledC = false;
  for (let i = 0; i < 30 && !fledC; i++) fledC = flee.canUse();
  ok(fledC === false, kind + ' ignores a creative/spectator player at 10 blocks');
  p.invulnerableGamemode = false;
  fledC = false;
  for (let i = 0; i < 30 && !fledC; i++) fledC = flee.canUse();
  okAv(fledC === true, kind + ' anti-vacuity: the same player in survival still makes it flee');
}

say('\n-- anti-vacuity: the old radius=6 shape fails the 10-block case, for both mobs --');
{
  const e = mob('cat', 0, 8, 0);
  const p = player(10, 8, 0);
  const oldFlee = new Ai.AvoidEntityGoal(e, 6, 1.6, () => [p], () => !e.tamed);
  okAv(oldFlee.canUse() === false,
       'cat: reconstructing the goal at the OLD radius (6) makes the 10-block case fail ' +
       'canUse() -- proving the fixed 16 above is not a check that always passes');
}
{
  const e = mob('ocelot', 0, 8, 0);
  const p = player(10, 8, 0);
  const oldFlee = new Ai.AvoidEntityGoal(e, 6, 1.6, () => [p], () => !e.tamed);
  okAv(oldFlee.canUse() === false,
       'ocelot: reconstructing the goal at the OLD radius (6) makes the 10-block case fail ' +
       'canUse() -- proving the fixed 16 above is not a check that always passes');
}

console.log('');
console.log('================ petfleecheck ==================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
console.log('==================================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
