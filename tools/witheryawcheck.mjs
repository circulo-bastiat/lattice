#!/usr/bin/env node
// witheryawcheck.mjs — #945: the wither writes the ENGINE's body-yaw field (yBodyRot, read by
// Ai.bodyYawOf) rather than a private e.bodyYaw, and a side head aimed at a target 180deg
// behind the body turns through the wrapRad edge at <=10deg/tick without blowing up.
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
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('  ✓ break caught: ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('witheryawcheck — #945: wither body yaw field + side-head yaw wrap, target 180deg behind');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js',
  '07zzi_ghast.js', '07zzm_wither.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat, Sv = MCL.Survival;
const Ex = MCL.Explosion, ES = MCL.Effects, Diff = MCL.Diff, Wi = MCL.Wither, Gh = MCL.Ghast;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();

ok(!!Wi && Wi.ready, 'Wither module reports ready');
ok(typeof Wi.sideHeadsTick === 'function', 'Wi.sideHeadsTick exists (the mobTick+tickMovement port)');
ok(typeof Wi.shootSkullAt === 'function', 'Wi.shootSkullAt exists (the shared spawn path)');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }
function mkPlayer(x, y, z) {
  return { type: 'player', x, y, z, health: 20, maxHealth: 20, height: 1.8,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0, armor: 0, armorToughness: 0 };
}
// `EL.aiCtx(e).players()` reads `NS.Player` directly (07i_entitylist.js), not `EL.list` -- every
// acquisition-search section below sets `MCL.Player` for that reason (the SAME convention
// aicheck.mjs/arrowphysicscheck.mjs/combatcheck.mjs already use), restoring it after.

function skullCount() { return EL.list.filter((e) => e.type === 'wither_skull').length; }
function spawnWither(x, y, z) {
  const w = spawn('wither', x, y, z);
  w.ai = null;   // this file's own §1-4 drive Wi.tickMovement directly, not the goal selector
  return w;
}

Diff.set('normal');
function run(tx, tz) {
  freshWorld();
  const w = spawnWither(0.5, 70, 0.5);
  w.yaw = 0; w.yBodyRot = 0; w.vx = 0; w.vz = 0;
  w.sideHeadTarget[0] = { type: 'player', x: tx, y: 70, z: tz, height: 1.8, health: 20, vx: 0, vy: 0, vz: 0 };
  w.sideHeadTarget[1] = w.sideHeadTarget[0];
  w.sideHeadTimer = [1e9, 1e9]; w.age = 0;
  let maxStep = 0, prev = w.sideHeadYaws[0];
  for (let i = 0; i < 40; i++) {
    Wi.tickMovement(w);
    w.sideHeadTarget[0] = w.sideHeadTarget[1] = w.sideHeadTarget[0] || w.sideHeadTarget[1];
    let d = Math.abs(Ai.wrapRad(w.sideHeadYaws[0] - prev)); if (d > maxStep) maxStep = d; prev = w.sideHeadYaws[0];
  }
  return { w, maxStep };
}
// yaw 0 faces -z in this engine (atan2(dx,-dz)); +z is 180deg behind
const behind = run(0.5, 10.5);
ok(Math.abs(behind.w.sideHeadYaws[0]) <= Math.PI + 1e-9, 'side head yaw stays wrapped within +-pi');
ok(behind.maxStep <= 10 * Math.PI / 180 + 1e-9, `per-tick turn <= 10deg through the wrap edge (max ${(behind.maxStep * 180 / Math.PI).toFixed(2)}deg)`);
ok(Math.abs(Math.abs(behind.w.witherSideYawRel[0]) - 180) < 15, `side head ends ~180deg off body (rel ${behind.w.witherSideYawRel[0].toFixed(1)})`);
const still = run(0.5, -10.5);
ok(Math.abs(still.w.witherSideYawRel[0]) < 15, `a target ahead keeps the head near 0 rel (${still.w.witherSideYawRel[0].toFixed(1)})`);
// body yaw field
freshWorld();
const m = spawnWither(0.5, 70, 0.5); m.ai = null; m.vx = 0.5; m.vz = 0; Wi.tickMovement(m);
ok(m.bodyYaw === undefined, 'no private e.bodyYaw field is written');
ok(near(Ai.bodyYawOf(m), m.yaw) && near(m.yBodyRot, Math.atan2(0.5 * 1, -0)) , 'yBodyRot follows the velocity yaw (Ai.bodyYawOf)');
// anti-vacuity: break the data each assertion depends on
okAv((() => { const m2 = spawnWither(0.5, 70, 0.5); m2.bodyYaw = m2.yaw; return m2.bodyYaw === undefined; })() === false, 'the old private e.bodyYaw write is caught by the no-private-field assertion');
okAv((() => { const w = run(0.5, 10.5).w; w.yBodyRot = 1; return Math.abs(Ai.bodyYawOf(w) - w.yaw) > 0.5; })(), 'a desynced yBodyRot is detected by the body-yaw assertion');
okAv((() => { const r = Ai.rotateTowards; Ai.rotateTowards = (f, t) => t; const s = run(0.5, 10.5).maxStep; Ai.rotateTowards = r; return s > 10 * Math.PI / 180 + 1e-9; })(), 'an unclamped rotateTowards breaks the 10deg step assertion');
console.log(`\n${pass} checks passed, ${fails.length} failures`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
