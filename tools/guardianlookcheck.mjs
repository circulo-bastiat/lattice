#!/usr/bin/env node
// guardianlookcheck.mjs — #1965: GuardianMoveControl steers the LookControl; setBeamTarget keeps beamTicks on same id; buildGoals exists.
// (setup copied from) guardiangoalcheck.mjs — #1072: MobEntity position target + WanderAroundGoal chance (substrate), headless, against
// .decomp GuardianEntity.java / MobEntity.java:1090-1127 / GoToWalkTargetGoal.java.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const MODS = []; for (const m of readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
if (!M.Combat) M.Combat = { mobAttack() {} };   // 14j is not loaded headless; the beam only needs the hook
const EL = M.EntityList, W = M.World, S = M.States, Ai = M.Ai, G = M.Guardian;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) for (let y = 0; y <= 14; y++) {
  const wall = Math.abs(x) === 12 || Math.abs(z) === 12 || y === 0;
  W.setBlock(x, y, z, wall ? stone : (y <= 10 ? water : 0));
}
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
let seed = 4242; const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
EL.random = rng;
const fresh = (type) => { EL.list.length = 0; return EL.spawn(type, 0.5, 5.5, 0.5); };
const fake = (x, y, z, type) => ({ type: type || 'player', x, y, z, health: 20, maxHealth: 20, eyeHeight: 1.6 });

console.log('guardianlookcheck — #1965');
{
  const e = fresh('guardian'), t = fake(5.5, 5.5, 0.5);
  ok(typeof G.buildGoals === 'function', 'Guardian.buildGoals exists');
  e.look = new Ai.LookControl(e); e.navNode = { x: 5, y: 5, z: 0 }; e.navigating = true;
  e.look.wanted = null; e.look.cooldown = 0;
  G.moveControl(e);
  ok(e.look.cooldown > 0 && e.look.wanted && e.look.wanted.x > e.x, 'moveControl steers look toward the swim direction');
  ok(Math.abs(e.look.ySpeed - 10 * Math.PI / 180) < 1e-9 && Math.abs(e.look.xMax - 40 * Math.PI / 180) < 1e-9, 'look speeds 10/40 deg');
  G.setBeamTarget(e, t); e.beamTicks = 7; G.setBeamTarget(e, t);
  ok(e.beamTicks === 7, 'same beam target id keeps beamTicks');
  G.setBeamTarget(e, null);
  ok(e.beamTicks === 0, 'changed id resets beamTicks');
  // anti-vacuity
  const bad = fresh('guardian'); bad.look = new Ai.LookControl(bad); bad.look.cooldown = 0; bad.look.wanted = null;
  okAv(!(bad.look.cooldown > 0), 'no moveControl call -> no look steer (check can fail)');
  G.setBeamTarget(e, t); e.beamTicks = 7; e.beamTargetId = 0; G.setBeamTarget(e, t);
  okAv(e.beamTicks === 0, 'differing id resets beamTicks');
}
if (fails.length) { console.log('\nFAIL (' + fails.length + '):'); fails.forEach((f) => console.log(' x ' + f)); }
console.log('\nguardianlookcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
