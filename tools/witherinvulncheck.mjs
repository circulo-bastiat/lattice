#!/usr/bin/env node
// witherinvulncheck.mjs — loop/wither-invuln: src/07zzm_wither.js's own DescendAtHalfHealthGoal
// + the 220-tick invulnerability timer (INVUL_TIMER dataTracker) + the regen-while-invulnerable
// tick + the invuln-expiry explosion. NOT the soul-sand+3-skull summoning-structure detector
// (lives on a block/world-interaction class, out of this unit's own scope — Wi.OWED names it).
//
//   node tools/witherinvulncheck.mjs [--verbose]
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

console.log('witherinvulncheck -- loop/wither-invuln: DescendAtHalfHealthGoal + 220-tick invuln timer + regen + expiry explosion');

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

// ============ 1. API surface ================================================================
say('\n§1 API surface');
ok(typeof Wi.getInvulnerableTimer === 'function', 'Wi.getInvulnerableTimer exists');
ok(typeof Wi.setInvulTimer === 'function', 'Wi.setInvulTimer exists');
ok(typeof Wi.onSummoned === 'function', 'Wi.onSummoned exists (the real vanilla setInvulTimer(220) trigger)');
ok(typeof Wi.DescendAtHalfHealthGoal === 'function', 'Wi.DescendAtHalfHealthGoal exists');
ok(typeof Wi.tickInvuln === 'function', 'Wi.tickInvuln exists');
ok(Wi.DEFAULT_INVUL_TIMER === 220, 'Wi.DEFAULT_INVUL_TIMER is the real 220 (.decomp DEFAULT_INVUL_TIMER field)');
ok(Wi.INVUL_EXPLOSION_POWER === 7.0, 'Wi.INVUL_EXPLOSION_POWER is the real 7.0F');
ok(Wi.INVUL_REGEN_AMOUNT === 10.0, 'Wi.INVUL_REGEN_AMOUNT is the real 10.0F');
{
  freshWorld();
  const w = spawn('wither', 0.5, 70, 0.5, {});
  ok(Wi.getInvulnerableTimer(w) === 0, 'a bare EL.spawn(\'wither\', ...) leaves the invuln timer at its real DataTracker default (0)');
}

// ============ 2. Wi.onSummoned ===============================================================
say('\n§2 Wi.onSummoned (the real vanilla setInvulTimer(220) trigger, .decomp confirmed)');
{
  freshWorld();
  const w = spawn('wither', 0.5, 70, 0.5, {});
  w.health = w.maxHealth;   // full 300 before summoning
  Wi.onSummoned(w);
  ok(Wi.getInvulnerableTimer(w) === 220, 'onSummoned sets the invuln timer to the real 220');
  ok(near(w.health, w.maxHealth / 3.0), `onSummoned drops health to maxHealth/3 (${w.maxHealth}/3 = ${w.maxHealth / 3}, got ${w.health})`);
}

// ============ 3. DescendAtHalfHealthGoal blocks MOVE|LOOK|JUMP while invulnerable ===========
say('\n§3 DescendAtHalfHealthGoal (goal-flag arbitration, priority 0)');
{
  freshWorld();
  const w = spawn('wither', 500, 70, 0, {});
  const ctx = EL.aiCtx(w);
  const gs = Wi.roster(w, ctx);
  Wi.onSummoned(w);   // invuln timer -> 220
  gs.tick();
  const descendEntry = gs.entries.find((en) => en.goal instanceof Wi.DescendAtHalfHealthGoal);
  const flyEntry = gs.entries.find((en) => en.goal instanceof Wi.FlyGoal);
  ok(!!descendEntry && descendEntry.running === true, 'DescendAtHalfHealthGoal is running while invulnerable');
  okAv(!!flyEntry && flyEntry.running === false, 'the lower-priority FlyGoal (shares MOVE) is BLOCKED while invulnerable');

  // anti-vacuity: the SAME roster, once the timer actually reaches 0, stops blocking -- proves
  // the block is a real consequence of the timer, not a permanent/always-on stub.
  Wi.setInvulTimer(w, 0);
  gs.tick();
  for (let i = 0; i < 3000 && !flyEntry.running; i++) gs.tick();   // FlyGoal's own 1-in-120 canStart gate
  ok(descendEntry.running === false, 'DescendAtHalfHealthGoal stops the instant the timer is 0 (canContinueToUse)');
  okAv(flyEntry.running === true, 'FlyGoal is now free to run once no longer invulnerable');
}

// ============ 4. regen-while-invulnerable =====================================================
say('\n§4 regen-while-invulnerable (age % 10 == 0 only)');
{
  freshWorld();
  const w = spawn('wither', 700, 70, 0, {});
  w.health = 50; w.maxHealth = 300;
  Wi.setInvulTimer(w, 100);
  w.age = 20;   // age % 10 == 0 -> this tick regens
  const h0 = w.health;
  Wi.tickInvuln(w);
  ok(near(w.health - h0, Wi.INVUL_REGEN_AMOUNT), `age%10==0: health rises by the real 10 (${h0} -> ${w.health})`);

  w.age = 21;   // age % 10 != 0 -> this tick must NOT regen
  const h1 = w.health;
  Wi.tickInvuln(w);
  okAv(near(w.health, h1), `age%10!=0: no regen this tick (${h1} -> ${w.health}, anti-vacuity: a stub "heal every tick" would fail this)`);

  ok(near(w.health, h1), 'sanity: health unchanged from the off-tick check above');
}

// ============ 5. invuln-expiry explosion ======================================================
say('\n§5 invuln-expiry explosion (real NS.Explosion.explode, mobGriefing-gated)');
{
  // griefing TRUE (default: no NS.Commands loaded -> Wi.tickInvuln's own fallback is true) --
  // the explosion actually breaks a real block.
  freshWorld();
  put(6, 69, 5, 'dirt');
  const w = spawn('wither', 5, 70, 5, {});
  Wi.setInvulTimer(w, 1);   // decrements to 0 THIS tick -> explodes
  const before = W.getBlock(6, 69, 5);
  Wi.tickInvuln(w);
  ok(Wi.getInvulnerableTimer(w) === 0, 'the timer reaches exactly 0 on the expiry tick');
  ok(before !== 0 && W.getBlock(6, 69, 5) === 0, `griefing=true: the real explosion broke the dirt beside it (${before} -> ${W.getBlock(6, 69, 5)})`);

  // anti-vacuity: griefing FALSE, same timer expiry -- block must survive, proving the gate
  // actually reads NS.Commands.ruleGet('mobGriefing') rather than always exploding through blocks.
  freshWorld();
  put(6, 69, 5, 'dirt');
  const w2 = spawn('wither', 5, 70, 5, {});
  Wi.setInvulTimer(w2, 1);
  MCL.Commands = { ruleGet: () => 'false' };
  const before2 = W.getBlock(6, 69, 5);
  Wi.tickInvuln(w2);
  delete MCL.Commands;
  okAv(before2 !== 0 && W.getBlock(6, 69, 5) === before2, `griefing=false: the dirt survives the SAME expiry (${before2} -> ${W.getBlock(6, 69, 5)})`);
  ok(Wi.getInvulnerableTimer(w2) === 0, 'the timer still reaches 0 even when griefing is off (only block damage is gated)');
}

// ============ 6. Wi.tickMovement wiring (sideHeadsTick gated by invulnerability) =============
say('\n§6 Wi.tickMovement: sideHeadsTick does NOT run while invulnerable');
{
  freshWorld();
  const w = spawn('wither', 900, 70, 900, {});
  const before = w.skullCooldowns.slice();
  Wi.setInvulTimer(w, 50);
  w.age = 5;
  Wi.tickMovement(w);
  ok(w.skullCooldowns[0] === before[0] && w.skullCooldowns[1] === before[1],
    'while invulnerable, skullCooldowns are untouched (sideHeadsTick did not run)');

  // anti-vacuity: the SAME wither, no longer invulnerable, DOES advance side-head state on the
  // very next tick -- proves §6's own gate is real, not a permanently-disabled call.
  Wi.setInvulTimer(w, 0);
  Wi.tickMovement(w);
  okAv(w.skullCooldowns[0] !== before[0] || w.skullCooldowns[1] !== before[1],
    'once no longer invulnerable, sideHeadsTick resumes and advances skullCooldowns');
}

// ============ 8. no steering while invulnerable (#3172) ======================================
say('\n§8 invulnerable wither hovers: tracked id 0 is set only in the non-invulnerable branch');
{
  freshWorld();
  const w = spawn('wither', 1200, 70, 1200, {});
  Wi.onSummoned(w);
  w.target = { x: 1220, y: 90, z: 1200, health: 20 };
  const x0 = w.x, y0 = w.y, z0 = w.z;
  for (let i = 0; i < 100; i++) Wi.tickMovement(w);
  ok(w.x === x0 && w.z === z0 && w.y === y0 && w.vy <= 0 && w.vx === 0,
    'invulnerable wither with a live target does not steer or climb (vy ' + w.vy + ')');
  Wi.setInvulTimer(w, 0);
  Wi.tickMovement(w);   // mobTick acquires the tracked id; the 0.3 impulse starts the NEXT tick (#10618)
  Wi.tickMovement(w);
  okAv(w.vy > 0 && w.vx > 0, 'the SAME wither steers toward the target once invulTimer is 0');
}

// ============ 7. end-to-end regression =======================================================
say('\n§7 end-to-end regression -- one real EL.tickMob tick, no throw');
{
  freshWorld();
  const w = spawn('wither', 1100, 70, 1100, {});
  Wi.onSummoned(w);
  let threw = null;
  try { EL.tickMob(w); } catch (err) { threw = err; }
  ok(threw === null, 'EL.tickMob(invulnerable wither) runs one full tick with no throw' + (threw ? (': ' + threw.stack) : ''));
}

console.log(`witherinvulncheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
