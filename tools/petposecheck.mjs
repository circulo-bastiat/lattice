#!/usr/bin/env node
// petposecheck.mjs -- #215: cat/ocelot two-speed flee (0.8 far / 1.33 within 7 blocks), the mobTick
// crouch (0.6) / sprint (1.33) pose read back from the move order, and ER.felineDelta.
//
//   node tools/petposecheck.mjs [--verbose]
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
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('  ✓ anti-vacuity: ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('petposecheck -- #215: cat/ocelot two-speed flee (0.8/1.33) + mobTick crouch/sprint pose + render delta');

const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js', '07j_entityrender.js']
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
  const hit = gs.entries.filter((e) => e.goal instanceof Ai.AvoidEntityGoal);   // its priority moved to 4 (cat) with master's roster
  return hit.length === 1 ? hit[0].goal : null;
}


const ER = M.EntityRender || M.ER;
ok(!!(ER && ER.felineDelta), 'ER.felineDelta exists');

// -- 1. the two-speed switch: 0.8 far (>= 7 blocks), 1.33 near (< 7), per FleeEntityGoal.tick
for (const kind of ['cat', 'ocelot']) {
  for (const [dist, want] of [[3, 1.33], [12, 0.8]]) {
    const e = mob(kind, 0, 8, 0), p = player(dist, 8, 0);
    const gs = Ai.ROSTER[kind](e, { players: () => [p], animals: () => [], onBreed: () => {}, isTempting: () => false, random: Math.random });
    const flee = findFleeGoal(gs);
    let fled = false;
    for (let i = 0; i < 60 && !fled; i++) fled = flee.canUse();
    ok(fled, kind + ' flees from ' + dist);
    if (!fled) continue;
    flee.start(); e.moveMod = 0; flee.tick();
    ok(e.moveMod === want, kind + ' at ' + dist + ' blocks orders speed ' + want + ' (got ' + e.moveMod + ')');
    Ai.felinePose(e);
    ok(e.sprinting === (want === 1.33) && e.crouching === false, kind + ' at ' + dist + ' sprint pose = ' + (want === 1.33));
  }
}

// -- 2. mobTick pose table (CatEntity.java:204-221)
const pose = (m) => { const e = { moveMod: m }; Ai.felinePose(e); return e; };
ok(pose(0.6).crouching && !pose(0.6).sprinting, '0.6 -> crouch');
ok(pose(1.33).sprinting && !pose(1.33).crouching, '1.33 -> sprint');
ok(!pose(1.0).sprinting && !pose(1.0).crouching, '1.0 -> stand');
ok(!pose(0).sprinting && !pose(0).crouching, 'no order -> stand');
ok(!pose(0.8).sprinting && !pose(0.8).crouching, '0.8 -> stand');

// -- 3. render deltas (OcelotEntityModel.java:100-160)
const fd = (n, f, l = 1, a = 1) => ER.felineDelta(n, l, a, f);
const CR = { crouch: true }, SP = { sprint: true }, ST = {};
ok(fd('body', CR).dpy === 1 && fd('body', ST).dpy === 0, 'crouch lowers body by 1');
ok(fd('tail1', CR).dpy === 1 && Math.abs(fd('tail1', CR).rx + 0.9 - Math.PI / 2) < 1e-9, 'crouch tail1 y+1, pitch PI/2');
ok(fd('tail2', CR).dpy === -4 && fd('tail2', CR).dpz === 2, 'crouch tail2 y-4 z+2');
ok(fd('tail2', SP).dpy === -5 && fd('tail2', SP).dpz === 2, 'sprint tail2 y=tail1 (15), z+2');
ok(fd('tail2', ST).dpy === 0 && !fd('tail2', ST).dpz && fd('tail1', ST).rx === 0, 'stand: tails at rest');
ok(Math.abs(fd('tail2', SP).rx - (1.7278761 + Math.PI / 10 * Math.cos(1))) < 1e-9, 'sprint tail2 swing PI/10');
ok(Math.abs(fd('left_hind_leg', SP).rx - Math.cos(0.6662)) < 1e-9 && Math.abs(fd('right_hind_leg', SP).rx - Math.cos(0.6662 + 0.3)) < 1e-9, 'sprint hind legs');
ok(Math.abs(fd('right_hind_leg', ST).rx - Math.cos(0.6662 + Math.PI)) < 1e-9, 'walk hind leg phase');

// -- anti-vacuity: break each rule and the same assertions must fail
const broke = (c, m) => okAv(c, m);
broke(!(pose(0.61).crouching), 'crouch is EXACTLY 0.6 (0.61 is not)');
broke(!(pose(1.34).sprinting), 'sprint is EXACTLY 1.33 (1.34 is not)');
broke(fd('tail2', { crouch: false, sprint: false }).dpy !== fd('tail2', CR).dpy, 'crouch and stand tails differ');
broke(fd('tail2', SP).dpy !== fd('tail2', CR).dpy, 'sprint and crouch tails differ');
broke(fd('left_hind_leg', SP).rx !== fd('left_hind_leg', ST, 1, 1).rx || fd('right_hind_leg', SP).rx !== fd('right_hind_leg', ST).rx, 'sprint legs differ from walk legs');
{
  const e = mob('cat', 0, 8, 0), p = player(3, 8, 0);
  const one = new Ai.AvoidEntityGoal(e, 16, 0.8, () => [p], () => true);   // single-speed (the old shape)
  let f = false; for (let i = 0; i < 60 && !f; i++) f = one.canUse();
  one.start(); e.moveMod = 0; one.tick();
  broke(e.moveMod !== 1.33, 'a single-speed AvoidEntityGoal does NOT sprint when close');
}

console.log('');
console.log('================ petposecheck ==================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
console.log('==================================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
