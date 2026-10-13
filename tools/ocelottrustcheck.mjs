#!/usr/bin/env node
// ocelottrustcheck.mjs -- #1605: OcelotEntity's trust state. OcelotEntity.interactMob (.decomp:160): raw cod/salmon within 3
// blocks, untrusting, tempt goal active -> eaten; 1/3 chance Trusting=true (hearts, status 41) else smoke (status 40);
// updateFleeing removes the FleeGoal while trusting; canImmediatelyDespawn = !trusting && age>2400; Trusting persists in NBT.
// Anti-vacuity: break the 1/3 roll, break the flee gate, break the NBT field -- each must be caught.
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
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('ocelottrustcheck -- #1605 ocelot trust state');

const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js', '07m_breed.js', '07n_tame.js', '07zw_mobnbt.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Behave.init(M.World);
M.Ai.init();
M.Breed.init();
M.Tame.init();
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
const Tm = M.Tame, EL = M.EntityList;

function trials(n) {
  let t = 0;
  for (let i = 0; i < n; i++) {
    const e = EL.spawn('ocelot', i, 64, 0); e.temptActive = true;
    const r = Tm.feedOcelot(e, 'cod', { random: Math.random, distSq: 4 });
    if (r && r.trusting && e.trusting) t++;
  }
  return t;
}
{
  const t = trials(900);
  ok(t > 220 && t < 380, 'cod trusts about 1 in 3 (' + t + '/900)');
  const real = Tm.CHANCE_DENOM; let b;
  try { Tm.CHANCE_DENOM = 1; b = trials(900); } finally { Tm.CHANCE_DENOM = real; }
  okAv(!(b > 220 && b < 380), 'anti-vacuity: a broken roll (always trusts) leaves the 1/3 band');
}
{
  const e = EL.spawn('ocelot', 0, 64, 0);
  const f = (it, d, tempt) => { e.trusting = false; e.temptActive = tempt; return Tm.feedOcelot(e, it, { random: () => 0.9, distSq: d }); };
  ok(f('salmon', 4, true) && !e.trusting, 'salmon is eaten (failed roll: not trusting)');
  ok(f('cod', 9, true) === null, 'exactly 3 blocks away (9) is out of range');
  ok(f('cod', 4, false) === null, 'tempt goal inactive: not handled');
  ok(f('wheat', 4, true) === null && f('cooked_cod', 4, true) === null, 'only raw cod/salmon');
  e.trusting = true; e.temptActive = true;
  ok(Tm.feedOcelot(e, 'cod', { random: () => 0, distSq: 4 }) === null, 'already trusting: falls through (breeding)');
  ok(Tm.feed(e, 'cod', {}) === null && !Tm.TAMABLE.ocelot, 'still not TAMABLE');
}
// flee gate + despawn
W.init(1);
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) W.setBlock(x, 7, z, STONE);
function flees(trusting, mk) {
  const e = mob('ocelot', 0, 8, 0), p = { x: 10, y: 8, z: 0, height: 1.8 };
  e.trusting = trusting;
  const gs = mk ? mk(e, p) : Ai.ROSTER.ocelot(e, { players: () => [p], animals: () => [], onBreed() {}, isTempting: () => false, random: Math.random });
  const g = gs.entries.filter((x) => x.priority === 4 && x.flags === Ai.MOVE)[0].goal;
  for (let i = 0; i < 30; i++) if (g.canUse()) return true;
  return false;
}
ok(flees(false) === true, 'untrusting ocelot flees');
ok(flees(true) === false, 'trusting ocelot does not flee');
{
  const old = (e, p) => { const gs = new Ai.GoalSelector(); gs.add(4, Ai.MOVE, new Ai.AvoidEntityGoal(e, 16, 0.8, () => [p], () => true, { fastSpeed: 1.33 })); return gs; };
  okAv(flees(true, old) === true, 'anti-vacuity: an ungated flee goal still flees while trusting');
}
{
  const e = EL.spawn('ocelot', 0, 64, 0); e.age = 3000;
  const can = () => M.Spawn.canImmediatelyDespawn(e, 0);
  e.trusting = true; const a = can(); e.trusting = false; const b = can();
  ok(a === false && b === true, 'trusting ocelot never despawns; untrusting old one does (' + a + '/' + b + ')');
}
// NBT: Trusting survives save -> restore through the real spawn path
{
  const roundTrip = (strip) => {
    const e = EL.spawn('ocelot', 3, 64, 3); e.trusting = true;
    const recs = M.MobNbt.serializeAll().filter((x) => x.type === 'ocelot');
    e.removed = true;
    if (strip) for (const r of recs) delete r.trusting;
    const before = EL.list.length;
    M.MobNbt.restoreAll(recs);
    return EL.list.slice(before).some((x) => x && x.type === 'ocelot' && x.trusting === true);
  };
  ok(roundTrip(false) === true, 'Trusting persists through MobNbt serialize/restore');
  okAv(roundTrip(true) === false, 'anti-vacuity: a record without the field restores untrusting');
}
console.log('');
console.log('=============== ocelottrustcheck ===============');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
console.log('===============================================');
for (const f of fails) console.log('FAIL  ' + f);
console.log(pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
