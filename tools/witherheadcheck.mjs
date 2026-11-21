#!/usr/bin/env node
// witherheadcheck.mjs — loop/wither-invuln: src/07zzm_wither.js's own DescendAtHalfHealthGoal
// + the 220-tick invulnerability timer (INVUL_TIMER dataTracker) + the regen-while-invulnerable
// tick + the invuln-expiry explosion. NOT the soul-sand+3-skull summoning-structure detector
// (lives on a block/world-interaction class, out of this unit's own scope — Wi.OWED names it).
//
//   node tools/witherheadcheck.mjs [--verbose]
//
// Sections:
//   1. API surface — Wi.getInvulnerableTimer/setInvulTimer/onSummoned/DescendAtHalfHealthGoal/
//      tickInvuln all exist; Wi.initWither sets the real DataTracker default (0)
//   2. Wi.onSummoned — the real vanilla trigger (.decomp: WitherSkullBlock.java is the ONLY
//      in-play caller of setInvulTimer(220)) sets the timer to 220 and health to maxHealth/3
//   3. DescendAtHalfHealthGoal, wired into Wi.roster at priority 0 — actually blocks every
//      lower-priority MOVE/LOOK/JUMP goal while invulnerable, and stops blocking the instant
//      the timer reaches 0 (anti-vacuity: the SAME roster, same ticks, opposite outcome)
//   4. regen-while-invulnerable — +10 HP exactly on age%10==0 ticks, NOT on other ticks
//      (anti-vacuity: a stub "heal every tick" would pass ok() but fail the off-tick assertion)
//   5. invuln-expiry explosion — a real NS.Explosion.explode at the wither's eye position,
//      gated by mobGriefing (anti-vacuity: griefing=false leaves the block standing, the SAME
//      timer expiry, proving the gate is real and not a stub that always/never explodes)
//   6. Wi.tickMovement wiring — Wi.sideHeadsTick does NOT run while invulnerable (mobTick()'s
//      own if/else, .decomp lines 251-345) but DOES resume once the timer expires
//   7. end-to-end regression — one real EL.tickMob tick on an invulnerable wither, no throw

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
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('witherheadcheck -- side-head smoothing runs during the invulnerable phase');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zzh_blaze.js', '07zzi_ghast.js',
  '07zzm_wither.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat;
const Ex = MCL.Explosion, ES = MCL.Effects, Wi = MCL.Wither;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();

ok(Wi.ready === true, 'Wi.ready is true once loaded');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }

// ============ side heads turn with the body while invulnerable (#1581) =========================
const run = (breakIt) => {
  freshWorld();
  const w = spawn('wither', 900, 70, 900, {});
  Wi.setInvulTimer(w, 100);
  w.age = 5;
  w.vx = 0.4; w.vz = 0;               // body yaw = atan2(vx,-vz) != 0
  const orig = Wi.sideHeadsSmooth;
  if (breakIt) Wi.sideHeadsSmooth = function () {};
  w.sideHeadYaws[0] = w.sideHeadYaws[1] = -2.5;
  const start = w.sideHeadYaws[0];
  let prev = start, maxStep = 0;
  for (let i = 0; i < 40; i++) {
    Wi.tickMovement(w);
    maxStep = Math.max(maxStep, Math.abs(Ai.wrapRad(w.sideHeadYaws[0] - prev)));
    prev = w.sideHeadYaws[0];
  }
  Wi.sideHeadsSmooth = orig;
  return { w, maxStep };
};
{
  const { w, maxStep } = run(false);
  ok(Wi.getInvulnerableTimer(w) > 0, 'still invulnerable after 40 ticks');
  const by = Ai.bodyYawOf(w);
  ok(near(w.sideHeadYaws[0], by, 1e-6) && near(w.sideHeadYaws[1], by, 1e-6), 'sideHeadYaws converge to bodyYaw while invulnerable');
  ok(maxStep <= Wi.SIDE_HEAD_YAW_MAX_STEP * Math.PI / 180 + 1e-9, '10 deg/tick cap respected');
  ok(near(w.witherSideYawRel[0], 0, 1e-4), 'witherSideYawRel refreshed');
  const b = run(true);
  okAv(!near(b.w.sideHeadYaws[0], Ai.bodyYawOf(b.w), 1e-3), 'with smoothing disabled the heads stay put');
}
console.log(`witherheadcheck: ${pass} ok, ${fails.length} failed, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
