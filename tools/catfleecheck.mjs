#!/usr/bin/env node
// catfleecheck -- #7654: untamed cat flees a nearby survival player (CatEntity.CatFleeGoal, 16 / 0.8 / 1.33, EXCEPT_CREATIVE_OR_SPECTATOR),
// also right after being hit; a tamed cat does not start, and a flee in progress stops when the cat becomes tamed (shouldContinue).
import { readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
const R = new URL('..', import.meta.url).pathname;
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js', '07m_breed.js', '07n_tame.js', '07zw_mobnbt.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(R + 'assets/entities.json', 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init(); M.Breed.init(); M.Tame.init();
const W = M.World, CH = M.CH, Ai = M.Ai, S = M.States.stateOf('stone') | 0;
W.init(1);
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) W.setBlock(x, 7, z, S);
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
function goalOf(e, p, build) {
  const gs = (build || Ai.ROSTER.cat)(e, { players: () => [p], animals: () => [], onBreed() {}, isTempting: () => false, random: Math.random, skyAngle: () => 0, dropGift() {} });
  return gs.entries.filter((x) => x.priority === 4 && x.flags === Ai.MOVE)[0].goal;
}
const starts = (g) => { for (let i = 0; i < 60; i++) if (g.canUse()) return true; return false; };
const mk = (gm) => ({ x: 3, y: 8, z: 0, height: 1.8, invulnerableGamemode: gm });
{ const e = M.EntityList.spawn('cat', 0, 8, 0); ok(starts(goalOf(e, mk(false))), 'untamed cat flees survival player'); }
{ const e = M.EntityList.spawn('cat', 0, 8, 0); e.hurtTime = 10; e.invulnerableTime = 10; ok(starts(goalOf(e, mk(false))), 'hit untamed cat flees'); }
{ const e = M.EntityList.spawn('cat', 0, 8, 0); ok(!starts(goalOf(e, mk(true))), 'creative player does not scare'); }
{ const e = M.EntityList.spawn('cat', 0, 8, 0); e.tamed = true; ok(!starts(goalOf(e, mk(false))), 'tamed cat does not flee'); }
{ const e = M.EntityList.spawn('cat', 0, 8, 0), g = goalOf(e, mk(false)); starts(g); g.start(); ok(g.canContinueToUse(), 'flee continues'); e.tamed = true; ok(!g.canContinueToUse(), 'tamed mid-flee stops'); }
{ const e = M.EntityList.spawn('cat', 0, 8, 0); const none = () => { const gs = new Ai.GoalSelector(); return gs; };
  let g; try { g = goalOf(e, mk(false), none); } catch (_) { g = null; }
  caught(!g || !starts(g), 'cat without flee goal does not flee'); }
{ const e = M.EntityList.spawn('cat', 0, 8, 0), g = new Ai.AvoidEntityGoal(e, 16, 0.8, () => [mk(false)], () => true, { fastSpeed: 1.33 }); starts(g); g.start(); e.tamed = true;
  caught(g.canContinueToUse(), 'goal without tamed stop keeps fleeing'); }
console.log(`9 assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
