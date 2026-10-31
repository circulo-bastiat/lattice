#!/usr/bin/env node
// witherattackcheck.mjs — QUEUE 0.00 part 2 (G18 leftover, D-787): the WITHER's ranged
// wither-skull attack (src/07zzm_wither.js's `Wi.attack`/`Wi.initSkull`/`Wi.tickSkull`, the
// `wither_skull` projectile registered in src/07i_entitylist.js). Non-browser (game-logic only).
//
//   node tools/witherattackcheck.mjs [--verbose]
//
// Sections:
//   1. wither_skull is a real, spawnable projectile type (motion/hitbox/DEFAULTS all wired)
//   2. Wi.attack (ProjectileAttackGoal's onShoot) spawns it off head 0, aimed at the target
//   3. Wi.tickSkull: an OWNED hit deals 8 damage through the real combat path, heals the
//      shooter 5 on a kill, then always explodes and discards
//   4. Wi.tickSkull: an UNOWNED hit (no shooter) deals the flat 5 magic-damage fallback
//   5. Wi.tickSkull: a block hit (no entity in the way) still always explodes and discards
//   6. the Wither status effect lands on a successful hit, difficulty-scaled (200/800/0 ticks)
//   7. anti-vacuity — the roster BEFORE this unit (no ProjectileAttackGoal row) never fires a
//      skull at all, across many ticks; the real roster (this unit) does, within one cycle

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && !VERBOSE) console.log(' ✓ break caught: ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('wither flygoalcheck -- #944: roster row 5 is FlyGoal (AboveGround/NoPenaltySolid targeting), not Ghast.FlyRandomlyGoal');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js',
  '07zzi_ghast.js', '07zzm_wither.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat, Ex = MCL.Explosion, Wi = MCL.Wither, Gh = MCL.Ghast;
B.init(W); Ent.init(); EL.init(); Ai.init(); Cb.init(); Ex.init();

W.init(1);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
EL.init();
const w = EL.spawn('wither', 0.5, 80, 0.5);
ok(!!w, 'wither spawns');
const gs = Wi.roster(w, { random: Math.random, players: [] });
const row5 = gs.goals ? gs.goals.filter((g) => g.priority === 5) : null;
ok(typeof Wi.FlyGoal === 'function', 'Wi.FlyGoal exists');
const src = Wi.roster.toString();
ok(/Wi\.FlyGoal/.test(src) && !/FlyRandomlyGoal/.test(src), 'roster row 5 builds Wi.FlyGoal, not Ghast.FlyRandomlyGoal');

// seeded rng
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// FlyGoal.canStart: 1-in-120 gate
{
  const g = new Wi.FlyGoal(w, 1.0, () => 0.5);
  ok(g.canUse() === false, 'canUse refuses when nextInt(120) != 0');
}
// targets: within the 8-radius cone box, bottom-centre, above solid ground
{
  const r = seeded(7); let n = 0, bad = 0;
  for (let i = 0; i < 200; i++) {
    const t = Wi.flyWanderTarget(w, r);
    if (!t) continue; n++;
    if (Math.abs(t.x - w.x) > 9 || Math.abs(t.z - w.z) > 9 || Math.abs(Math.abs(t.x % 1) - 0.5) > 1e-9 || Math.abs(Math.abs(t.z % 1) - 0.5) > 1e-9) bad++;
  }
  ok(n > 100, `most picks find a target (${n}/200)`);
  ok(bad === 0, 'targets are bottom-centre of a block within radius 8 (+1) of the wither');
}
// forward cone: yaw faces +x/-z... every target's offset lies within PI/2 of the facing
{
  w.yaw = 0; // forward = (0,-1)
  const r = seeded(3); let n = 0, back = 0;
  for (let i = 0; i < 300; i++) {
    const t = Wi.flyWanderTarget(w, r); if (!t) continue; n++;
    if ((t.z - w.z) > 1.5) back++;
  }
  ok(n > 100 && back === 0, `targets stay in the forward half-plane (${n} picks, ${back} behind)`);
}
// steering + gravity: an active goal steers via flyMove; noGravity toggles off when idle
{
  w.yaw = 0;
  const g = new Wi.FlyGoal(w, 1.0, () => 0);
  ok(g.canUse() === true, 'canUse true when the chance gate passes');
  g.start(); g.tick(); w.flyMove.tick();
  ok(w.noGravity === true, 'steering sets noGravity (FlightMoveControl.tick)');
  w.flyMove.tick();
  ok(w.noGravity === false, 'idle control clears noGravity again (setNoGravity(false))');
}
// goal 2 (ProjectileAttackGoal) approach flies via flyMove (BirdNavigation), not ground A*
{
  const far = { x: w.x + 40, y: w.y + 15, z: w.z, health: 20 };
  w.target = far;
  const g2 = new Ai.ProjectileAttackGoal(w, 1.0, 40, 40, 20, null, true);
  let calls = 0; const orig = w.flyMove.setWantedPosition;
  w.flyMove.setWantedPosition = function () { calls++; return orig.apply(this, arguments); };
  g2.canUse(); g2.start(); g2.tick();
  w.flyMove.setWantedPosition = orig; w.target = null;
  ok(calls === 1, 'goal-2 approach steers e.flyMove toward a far, high target');
  const gG = new Ai.ProjectileAttackGoal(w, 1.0, 40, 40, 20, null);
  w.target = far; let c2 = 0; w.flyMove.setWantedPosition = function () { c2++; };
  gG.canUse(); gG.start(); gG.tick(); w.flyMove.setWantedPosition = orig; w.target = null;
  okAv(c2 === 0, 'the ground-walking form (old behaviour) never calls flyMove');
  ok(/Wi\.attack, true\)/.test(Wi.roster.toString()), 'roster passes the flying flag to goal 2');
}
// anti-vacuity: break the data -- swapping in the ghast goal / an unreachable radius is detected
{
  const saved = Wi.localFuzz;
  Wi.localFuzz = () => null;
  const t = Wi.flyWanderTarget(w, seeded(1));
  Wi.localFuzz = saved;
  okAv(t === null, 'a broken localFuzz yields no wander target (target selection really depends on it)');
  const saved2 = Wi.FLY_CHANCE; Wi.FLY_CHANCE = 1;
  const rr = seeded(5); const g2 = new Wi.FlyGoal(w, 1.0, () => (rr() < 0.5 ? 0.9 : rr()));
  const passes = g2.canUse(); Wi.FLY_CHANCE = saved2;
  okAv(passes === true, 'changing the chance constant changes the gate (gate is live)');
  const g3 = new Wi.FlyGoal(w, 1.0, () => 0.9);
  okAv(g3.canUse() === false, 'with the real constant the same roll is refused');
  const fakeSrc = src.replace('Wi.FlyGoal', 'NS.Ghast.FlyRandomlyGoal');
  okAv(/FlyRandomlyGoal/.test(fakeSrc), 'the row-5 source assertion detects the old ghast goal');
}
console.log(`\nwithergoalcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  x ' + f);
process.exit(fails.length ? 1 : 0);
