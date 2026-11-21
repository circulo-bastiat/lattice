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

console.log('bowstatecheck — #216 RangedBowAttackGoal draw state machine');

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
ok(M.Ai.hazardsReady(), 'D-398: the hazard/door tag table resolved from real jar tag data');

const Ai = M.Ai, W = M.World, CH = M.CH, PH = M.Physics;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone'), WATER = stateOf('water');

/** A flat square platform of stone at y=PLAT_Y, centred on 0,0, radius r — nothing beyond it. */
const PLAT_Y = 8;
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
/** A synthetic mob — enough of `EntityList.spawn`'s own shape for the goals to read. */
function mob(type, x, y, z) {
  return { id: 1, type, x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.9, height: 1.4, inWater: false };
}
// ⚠⚠ **A GOAL AIMS; `Ph.travelMob` MOVES — D-417.** Every fixture below used to tick a goal and
// then read the mob's POSITION, which only worked because `Ai.stepToward` teleported it. It does
// not any more: a goal writes a heading, a speed and a jump flag, and the travel step turns them
// into motion through the collision sweep. So a fixture that ticks a goal must travel too, or it
// is testing a mob that vanilla would have left standing still. `drive` is that pair.
// ⚠ AND THE SPEEDS ARE MODIFIERS NOW: `1.0` is "this mob's own MOVEMENT_SPEED", not 0.1 blocks
// per tick.
function drive(g, e, n, each) {
  for (let t = 0; t < n; t++) {
    e.zza = 0;                 // MoveControl's WAIT branch — see EL.tickMob
    g.tick();
    PH.travelMob(e);
    if (each && each(t) === false) return t;
  }
  return n;
}
function fixedRandom(seq) {
  let i = 0;
  return () => seq[i++ % seq.length];
}


const fixedTarget = (x) => ({ x, y: PLAT_Y + 1, z: 0, height: 1.8 });
function run(goal, e, n, seeAt, onTick) {
  const shots = [];
  goal.g = goal.make(e, (me, t, pull) => shots.push({ t: goal.now, pull }), () => seeAt(goal.now));
  goal.g.start();
  const draw = [];
  for (goal.now = 1; goal.now <= n; goal.now++) {
    e.zza = 0; goal.g.tick(); draw.push({ using: !!e.usingItem, use: e.itemUseTime || 0, charge: e.bowCharge });
    PH.travelMob(e); e.x = 0; e.vx = 0; e.z = 0;   // scripted: the mob stays put, the target is at 10 blocks
    if (onTick) onTick(goal.now);
  }
  return { shots, draw };
}
const mk = (make) => ({ make, now: 0 });
const RB = (e, sh, see) => new Ai.RangedBowAttackGoal(e, 1.0, sh, 15, see);

console.log('\n 1. first shot is drawn, not instant');
{
  freshWorld(); plate(30);
  const e = mob('skeleton', 0, PLAT_Y + 1, 0); e.target = fixedTarget(10);
  const r = run(mk(RB), e, 60, () => true);
  ok(r.shots.length >= 1, `it fires (${r.shots.length})`);
  ok(r.shots[0] && r.shots[0].t === 21, `first shot leaves on tick 21 after a 20-tick draw started on tick 1 (tick ${r.shots[0] && r.shots[0].t})`);
  ok(r.shots[0] && r.shots[0].pull === 1, 'pull progress of a 20-tick draw is 1');
  ok(r.draw[0].using && r.draw[0].charge === 0, 'tick 1: startUsingItem, charge 0 (no instant undrawn shot)');
  ok(r.draw[10].use === 10 && Math.abs(r.draw[10].charge - 0.5) < 1e-9, 'charge = ticksUsingItem/20 while drawing');
  const gap = r.shots[1] && (r.shots[1].t - r.shots[0].t);
  ok(gap === 20 + Ai.BOW_DRAW_TICKS || r.shots.length < 2, `shot-to-shot = interval + redraw (${gap})`);
  okAv(r.shots[0] && r.shots[0].t > 1, 'anti-vacuity: the old cooldown-as-charge goal fired on tick 1');
}
console.log('\n 2. line of sight gates the draw');
{
  freshWorld(); plate(30);
  const e = mob('skeleton', 0, PLAT_Y + 1, 0); e.target = fixedTarget(10);
  const r = run(mk(RB), e, 200, () => false);
  ok(r.shots.length === 0, 'an unseen target is never shot');
  ok(!e.usingItem, 'the draw is dropped after 60 unseen ticks (stopUsingItem)');
  ok(r.draw[30].using, 'but a draw may begin within the -60 grace');
  // sight lost mid-draw for a few ticks: draw keeps counting, shot waits for sight
  const e2 = mob('skeleton', 0, PLAT_Y + 1, 0); e2.target = fixedTarget(10);
  const r2 = run(mk(RB), e2, 60, (t) => !(t >= 5 && t <= 40));
  ok(r2.shots.length >= 1 && r2.shots[0].t >= 41, `blind mid-draw: no shot until sight returns (tick ${r2.shots[0] && r2.shots[0].t})`);
  ok(r2.shots[0] && r2.shots[0].pull === 1, 'the draw kept counting while blind (pull capped at 1)');
  okAv(r2.draw[20].using, 'anti-vacuity: the draw was still held (not reset) while blind');
}
console.log('\n 3. out of range: no draw start');
{
  freshWorld(); plate(30);
  const e = mob('skeleton', 0, PLAT_Y + 1, 0); e.target = fixedTarget(40);
  const r = run(mk(RB), e, 5, () => true, () => { e.target.x = 40; });
  ok(r.shots.length === 0 && !r.draw.some((d) => d.using), 'a target beyond the radius is not drawn on');
}
console.log('\n 4. strafe input decays *0.98 (EntityList.tickMob)');
{
  freshWorld(); plate(30);
  const e = mob('skeleton', 0, PLAT_Y + 1, 0);
  e.type = 'skeleton'; e.xxa = 0.5;
  const before = e.xxa;
  M.EntityList.tickMob && (function () { try { M.EntityList.tickMob(e); } catch (_) {} })();
  ok(e.xxa > 0 && e.xxa < before, `sideways input persists and decays after a tick (${e.xxa})`);
  ok(Math.abs(e.xxa - before * Math.fround(0.98)) < 1e-6, 'decay factor is 0.98');
  okAv(e.xxa !== 0, 'anti-vacuity: the old code zeroed it');
}

console.log('');
console.log('================ bowstatecheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
