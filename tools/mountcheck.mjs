#!/usr/bin/env node
// mountcheck.mjs — QUEUE 0.2 "G18e remainder": HORSE, the equip/tame/ride substrate.
//
//   node tools/mountcheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. `Mount.FOOD`/`Mount.ARMOR_BONUS`/`Mount.JUMP_VELOCITY_BASE` etc. are
// transcribed off `HorseBaseEntity`/`HorseEntity`/`Items.java` (javap'd, .decomp — 07r_mount.js's
// own header cites every one), so the interesting question is never "is 0.42 right" — it is
// whether this module's STATE MACHINE (temper, tame, saddled, rider) actually runs on those
// numbers the way the jar's does, in both directions (rule 3), with a real `Ai.GoalSelector`,
// a real `EntityList` spawn and the real `Use.entityUse` dispatch, not a synthetic re-model.
//
// ⚠ NO BROWSER STAGE. §6 drives `Mount.travelRidden` against a SYNTHETIC rider object and a spy
// on `Ph.travelMob`/`Ph.move` rather than the live player's camera — see 07r_mount.js's own
// header for exactly what that leaves for a browser-visible follow-up (`Mount.OWED`).

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };
const near = (a, b, eps) => Math.abs(a - b) < (eps === undefined ? 1e-9 : eps);

console.log('mountcheck — QUEUE 0.2 G18e remainder, horse mount/tame/ride/saddle/armour');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07r_mount.js', '07zzj_strider.js', '07zzp_mobvoice.js', '14f_inventory.js', '14g_menu.js', '14l_use.js',
          '14j_combat.js', '14d_survival.js', '14_player.js',
          // QUEUE 0.2 (G18e remainder) -- `15b_gui.js`'s own `Gui.HORSE`/`Gui.horseSlotXY` are
          // pure data + geometry functions, no DOM at module scope (same reason `guicheck.mjs`
          // loads this file standalone) -- safe to load here headlessly, no `dom: true` needed.
          '15b_gui.js', '07zzp_mobvoice.js']
});
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')),
  mobSounds: Object.fromEntries(readFileSync(join(ROOT, 'tools/golden/mob-sounds-1.18.2.tsv'), 'utf8').split(/\r?\n/).filter(l => l && l[0] !== '#').map(l => { const c = l.split('\t'); return [c[0], c.slice(2)]; }))
});
M.Entities.init();
M.EntityList.init();
M.Ai.init();
M.Breed.init();
M.Tame.init();
M.Mount.init();

const Mnt = M.Mount, Br = M.Breed, EL = M.EntityList, Ai = M.Ai;
ok(Mnt.ready, 'Mount module reports ready');
if (!Mnt.ready) {
  console.log('\nFAIL  Mount did not initialise — Breed/Entities is missing');
  process.exit(1);
}

// a small flat stone platform, exactly tamecheck's/breedcheck's own §10 recipe, so
// `Ph.updateFluids`/`Ph.frictionOf`/`Ph.move` all resolve real registry state instead of
// crashing on an empty world.
M.World.init(1);
const PLAT_Y = 63;
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = M.World.makeChunk(cx, cz);
  c.state = M.CH.GENERATED;
  M.World.chunks.set(M.World.key(cx, cz), c);
}
const STONE = M.States.stateOf('stone') | 0;
for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) M.World.setBlock(x, PLAT_Y, z, STONE);

function mkHorse(x, z) {
  const e = EL.spawn('horse', x === undefined ? 0 : x, PLAT_Y + 1, z === undefined ? 0 : z);
  return e;
}

// ── §1. the roster this session actually builds ───────────────────────────────────────────────
say('\n§1 — MOUNTABLE roster');
ok(Mnt.MOUNTABLE.horse === true, 'horse is MOUNTABLE');
// loop/donkey-s96: donkey/mule now built (their own goal selector, chest, mule breeding --
// donkeycheck.mjs drives them). loop/llama-s97: llama too (llamacheck.mjs its own suite).
ok(Mnt.MOUNTABLE.donkey === true, 'donkey is MOUNTABLE (loop/donkey-s96)');
ok(Mnt.MOUNTABLE.mule === true, 'mule is MOUNTABLE (loop/donkey-s96)');
ok(Mnt.MOUNTABLE.llama === true, 'llama is MOUNTABLE too (loop/llama-s97)');
ok(!Mnt.MOUNTABLE.wolf, 'wolf is not a horse-family type');
ok(!Mnt.isMountable(null), 'a null entity is never mountable');

// ── §2. feed — heal, grow, love-gated-on-tame, and the "$$2||!isTame()" temper gate ──────────
say('\n§2 — Mount.feed: heal/grow/love/temper, off HorseBaseEntity.receiveFood');
{
  ok(Mnt.feed(mkHorse(), 'dirt') === null, 'a non-food item refuses (returns null, no consume)');
  const cow = EL.spawn('cow', 5, PLAT_Y + 1, 0);
  ok(Mnt.feed(cow, 'wheat') === null, 'Mount.feed refuses a non-horse-family type outright');

  // untamed: heals AND always adds temper (the `!isTame()` half of the gate) on every listed food
  const e = mkHorse();
  e.tamed = false; e.temper = 0; e.health = 10; e.maxHealth = 20;
  const r1 = Mnt.feed(e, 'wheat');
  ok(r1 && r1.consumed === true, 'feeding wheat reports consumed');
  ok(e.health === 12, 'wheat heals +2 (untamed horse, health 10 -> 12)');
  ok(e.temper === 3, 'wheat adds +3 temper on an UNTAMED horse (jar\'s own literal, not guessed)');

  // #3577: receiveFood -> playEatingAnimation plays getEatSound() for every horse-family type
  for (const t of ['horse', 'donkey', 'mule']) {
    const m = EL.spawn(t, 5, PLAT_Y + 1, 0); m.tamed = false; m.temper = 0; m.health = 1;
    M.Sound = M.Sound || {}; const S = M.Sound, old = S.play, got = []; S.play = (id) => { got.push(id); return true; };
    Mnt.feed(m, 'wheat');
    m.silent = true; Mnt.feed(m, 'wheat');
    S.play = old;
    ok(got.length === 1 && got[0] === 'entity.' + t + '.eat', t + ' feed plays entity.' + t + '.eat once (silent mutes it)');
    okAv(got.length !== 0, t + ' eat sound anti-vacuity: feed does emit');
  }

  // #1355: fractional health/maxHealth (foal's averaged max) is NOT truncated
  const f1355a = mkHorse();
  f1355a.tamed = true; f1355a.health = 10.5; f1355a.maxHealth = 21.67;
  Mnt.feed(f1355a, 'wheat');
  okAv(Math.abs(f1355a.health - 12.5) < 1e-9, 'wheat heals a 10.5-hp horse to 12.5 (fraction kept, #1355)');
  const f1355b = mkHorse();
  f1355b.tamed = true; f1355b.health = 21.5; f1355b.maxHealth = 21.67;
  Mnt.feed(f1355b, 'wheat');
  okAv(Math.abs(f1355b.health - 21.67) < 1e-9, '21.5/21.67 hp horse still heals, capped at the untruncated max');

  // tame, already full health, adult, no love item: temper must NOT move (did === false path) —
  // this is the exact branch tamecheck-shaped checks exist to catch: a bug that always adds
  // temper on any recognised food would pass every OTHER assertion here and fail only this one.
  const e2 = mkHorse();
  e2.tamed = true; e2.temper = 10; e2.health = 20; e2.maxHealth = 20;
  Mnt.feed(e2, 'wheat');
  ok(e2.temper === 10, 'wheat on an ALREADY-full-health TAME horse adds NO temper (did===false, isTame()===true)');
  // anti-vacuity: force the same horse to report "did something" (heal room) and watch the
  // temper move on the SAME tame/food combination — proves the gate is the `did` flag, not a
  // silent "tame horses never gain temper from food" shortcut.
  e2.health = 15;
  Mnt.feed(e2, 'wheat');
  okAv(e2.temper === 13, 'the SAME tame horse DOES gain temper once healing gives it an effect (10 -> 13)');

  // hay_block: heals 20, but temper literal is 0 — never moves temper, tame or not.
  const e3 = mkHorse();
  e3.tamed = false; e3.temper = 0; e3.health = 1; e3.maxHealth = 20;
  Mnt.feed(e3, 'hay_block');
  ok(e3.health === 20 && e3.temper === 0, 'hay_block heals to full but adds zero temper (its own literal is 0)');

  // golden_carrot: only tame + adult + not-already-in-love triggers love; untamed never does
  const e4 = mkHorse();
  e4.tamed = false; e4.growAge = 0; e4.health = 20; e4.maxHealth = 20;
  Mnt.feed(e4, 'golden_carrot');
  ok(!Br.isInLove(e4), 'golden_carrot on an UNTAMED horse does not start love mode');
  const e5 = mkHorse();
  e5.tamed = true; e5.growAge = 0; e5.health = 20; e5.maxHealth = 20; e5.temper = 0;
  Mnt.feed(e5, 'golden_carrot');
  ok(Br.isInLove(e5), 'golden_carrot on a TAME, full-health adult horse starts love mode');
  ok(e5.temper === 5, 'and adds its own +5 temper (did===true via the love effect)');

  // temper never exceeds MAX_TEMPER, both directions
  const e6 = mkHorse();
  e6.tamed = false; e6.temper = 99; e6.health = 1; e6.maxHealth = 1;
  Mnt.feed(e6, 'golden_apple');
  ok(e6.temper === Mnt.MAX_TEMPER, 'temper clamps at MAX_TEMPER (99+10 clamps to 100)');
}

// ── §3. saddling — direct equip (SaddleItem.useOnEntity), no screen needed ───────────────────
say('\n§3 — saddling: Mount.canBeSaddled / Mount.trySaddleItem');
{
  const baby = mkHorse(); baby.tamed = true; Br.setBaby(baby, true);
  ok(Mnt.trySaddleItem(baby) === null, 'a baby horse refuses a saddle, even tame');

  const wild = mkHorse(); wild.tamed = false;
  ok(Mnt.trySaddleItem(wild) === null, 'an UNTAMED horse refuses a saddle');
  okAv(!wild.saddled, 'anti-vacuity check-point: the refused saddle really did not equip');
  wild.tamed = true;   // simulate what a missing tame-gate bug would look like from outside
  ok(Mnt.trySaddleItem(wild) !== null && wild.saddled === true,
    'the SAME horse, now tame, accepts the saddle — proves the earlier refusal was the tame gate, not noise');

  const already = mkHorse(); already.tamed = true; already.saddled = true;
  ok(Mnt.trySaddleItem(already) === null, 'an already-saddled horse refuses a second saddle (useOnEntity PASSes)');
}

// ── §4. mounting — works whether tame or not; refuses baby and a second rider ────────────────
say('\n§4 — Mount.mount / Mount.dismount');
{
  const babyH = mkHorse(); Br.setBaby(babyH, true);
  ok(Mnt.mount(babyH) === false, 'a baby horse cannot be mounted');

  const wild = mkHorse(); wild.tamed = false;
  ok(Mnt.mount(wild) === true && wild.rider === 'player', 'an UNTAMED adult horse mounts on an empty-hand attempt (vanilla always does)');
  ok(Mnt.mount(wild) === false, 'a horse that already has a rider refuses a second one');
  Mnt.dismount(wild);
  ok(wild.rider === null, 'dismount clears the rider');
  ok(Mnt.mount(wild) === true, 'and it can be mounted again after dismounting');
}

// ── §5. Ai.HorseBondWithPlayerGoal — the temper roll, DISTRIBUTION not one sample ────────────
say('\n§5 — the HorseBondWithPlayerGoal roll, and proving the check can catch a wrong one');
function trialBond(temper, ticks) {
  const e = mkHorse();
  e.tamed = false; e.temper = temper; e.x = 0.5; e.y = PLAT_Y + 1; e.z = 0.5; e.onGround = true;
  Mnt.mount(e);
  const g = new Ai.HorseBondWithPlayerGoal(e, { random: Math.random });
  for (let i = 0; i < ticks && e.rider && !e.tamed; i++) g.tick();   // the goal is RUNNING (past canStart); tick() is what rolls
  return e;
}
{
  const bonded = trialBond(Mnt.MAX_TEMPER, 6000);
  ok(bonded.tamed === true && bonded.rider === 'player', 'temper===MAX_TEMPER bonds (and keeps the rider) well within 6000 ticks');

  const bucked = trialBond(0, 6000);
  ok(bucked.tamed === false && bucked.rider === null,
    'temper===0 NEVER bonds — the very first roll bucks the rider off instead (nextInt(max) < 0 is never true)');
  ok(bucked.temper === Mnt.BOND_FAIL_TEMPER, 'and that one failed roll added the flat +5 fail-temper');

  // anti-vacuity (rule 1): force MAX_TEMPER down to 1 the way tamecheck forces CHANCE_DENOM —
  // any nonzero temper now satisfies nextInt(1) < temper on the FIRST roll that fires, so the
  // bond rate over many independent horses must shoot to ~100%, proving the roll is live.
  const savedMax = Mnt.MAX_TEMPER;
  Mnt.MAX_TEMPER = 1;
  let bondedCount = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const e = mkHorse(); e.tamed = false; e.temper = 1; e.x = 0.5; e.y = PLAT_Y + 1; e.z = 0.5; e.onGround = true;
    Mnt.mount(e);
    const g = new Ai.HorseBondWithPlayerGoal(e, { random: Math.random });
    for (let t = 0; t < 400 && e.rider && !e.tamed; t++) g.tick();
    if (e.tamed) bondedCount++;
  }
  Mnt.MAX_TEMPER = savedMax;
  okAv(bondedCount / N > 0.9, `forcing MAX_TEMPER=1 (temper=1) bonds ~always (got ${(bondedCount / N).toFixed(2)}) — the roll is live, not a no-op`);

  // vanilla start(): navigation.startMovingTo(find(5,4), 1.2) -- the ridden untamed horse WALKS (bucking run)
  const walker = mkHorse(); walker.x = 0.5; walker.y = PLAT_Y + 1; walker.z = 0.5; walker.onGround = true; walker.tamed = false;
  Mnt.mount(walker);
  const gw = new Ai.HorseBondWithPlayerGoal(walker, { random: Math.random });
  let started = false, moved = false;
  for (let i = 0; i < 60 && !moved; i++) {   // a target on the horse's own cell is a zero-length path (idle) -- vanilla too
    if (!gw.canUse()) continue;
    started = true; gw.start();
    walker.navigating = false; gw.tick();
    moved = gw.canContinueToUse() && walker.navigating === true && walker.moveMod === 1.2;   // stepToward ran at the roster's 1.2
    gw.stop(); walker.x = 0.5; walker.z = 0.5;
  }
  ok(started, 'ridden untamed horse finds a NoPenaltyTargeting.find(5,4) target');
  okAv(moved, 'and its navigation is active: start() makes it walk toward the target');

  // an untamed horse with NO rider never rolls at all (canUse gates on e.rider)
  const noRider = mkHorse(); noRider.tamed = false; noRider.temper = Mnt.MAX_TEMPER;
  const g2 = new Ai.HorseBondWithPlayerGoal(noRider, { random: Math.random });
  ok(g2.canUse() === false, 'the goal never starts on an unridden horse, however high its temper');
}

// ── §6. Mount.travelRidden — the exact HorseBaseEntity.travel() arithmetic ───────────────────
say('\n§6 — Mount.travelRidden: rotation sync, angry-freeze, the charged jump, and Ph.travelMob\'s new xxa');
{
  const realTravelMob = M.Physics.travelMob;
  let spy = null;
  M.Physics.travelMob = function (e, xxa) {
    spy = { zza: e.zza, xxa: xxa, jumping: e.jumping, vyAtCall: e.vy };
    // stand-in for what a real `Ph.move` this tick would do: a positive vy this tick always
    // leaves the ground within the SAME tick (the collision sweep only sets onGround again on
    // a DOWNWARD landing) — `Ph.move`'s own real behaviour, not asserted again here.
    e.onGround = false;
  };

  // (a0) #4731: unrolled ridden speed falls back to the type's own base (0.2 undead, 0.225 horse)
  for (const [ty, want] of [['zombie_horse', 0.2], ['skeleton_horse', 0.2], ['horse', 0.225]]) {
    const e = mkHorse(); e.type = ty; e.movementSpeedAttr = undefined; e.saddled = true; e.onGround = true; e.jumpStrength = 0; e.angry = false; e.vx = e.vy = e.vz = 0;
    Mnt.travelRidden(e, { forwardSpeed: 1, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    ok(Math.abs(e.mobSpeed - want) < 1e-6, ty + ' ridden mobSpeed falls back to ' + want + ' (got ' + e.mobSpeed + ')');
  }
  { const e = mkHorse(); e.type = 'zombie_horse'; e.movementSpeedAttr = undefined; e.saddled = true; e.onGround = true; e.jumpStrength = 0; e.vx = e.vy = e.vz = 0;
    Mnt.travelRidden(e, { forwardSpeed: 1, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    okAv(!near(e.mobSpeed, 0.225), 'anti-vacuity: zombie_horse is distinguishable from the old 0.225 fallback'); }

  // (a) rotation sync
  {
    const e = mkHorse(); e.saddled = true; e.onGround = true; e.jumpStrength = 0; e.angry = false; e.vx = e.vy = e.vz = 0;
    Mnt.travelRidden(e, { forwardSpeed: 0, sidewaysSpeed: 0, yaw: 1.25, pitch: 0.5 });
    ok(e.yaw === 1.25, 'rider yaw is copied onto the horse');
    ok(near(e.pitch, 0.25), 'rider pitch is HALVED onto the horse (travel()\'s own `* 0.5F`)');
  }

  // (a2) #1832: forward <= 0 resets soundTicks (HorseBaseEntity.travel :716-720); forward > 0 leaves it
  {
    const e = mkHorse(); e.saddled = true; e.onGround = true; e.jumpStrength = 0; e.angry = false; e.soundTicks = 9;
    Mnt.travelRidden(e, { forwardSpeed: 1, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    okAv(e.soundTicks === 9, 'forward > 0 leaves soundTicks alone');
    Mnt.travelRidden(e, { forwardSpeed: 0, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    ok(e.soundTicks === 0, 'forward <= 0 resets soundTicks to 0 (gallop cadence restarts)');
  }

  // (b) angry + no charge + on ground + not jumping -> forward/sideways forced to zero
  {
    const e = mkHorse(); e.saddled = true; e.onGround = true; e.jumpStrength = 0; e.angry = true; e.jumping = false;
    Mnt.travelRidden(e, { forwardSpeed: 1, sidewaysSpeed: 1, yaw: 0, pitch: 0 });
    ok(spy.zza === 0 && spy.xxa === 0, 'an angry, on-ground, non-jumping, uncharged horse ignores rider input entirely');
    // anti-vacuity: the SAME rider input, angry cleared, must reach travelMob non-zero
    const e2 = mkHorse(); e2.saddled = true; e2.onGround = true; e2.jumpStrength = 0; e2.angry = false; e2.jumping = false;
    Mnt.travelRidden(e2, { forwardSpeed: 1, sidewaysSpeed: 1, yaw: 0, pitch: 0 });
    okAv(spy.zza !== 0 || spy.xxa !== 0, 'clearing e.angry restores the same rider input reaching Ph.travelMob');
  }

  // (c) reverse (forward<=0) is quartered, forward>0 passes through
  {
    const e = mkHorse(); e.saddled = true; e.onGround = true; e.jumpStrength = 0; e.angry = false;
    Mnt.travelRidden(e, { forwardSpeed: -1, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    ok(near(spy.zza, -0.25), 'forwardSpeed<=0 is quartered (travel()\'s own `*= 0.25F`)');
    const e2 = mkHorse(); e2.saddled = true; e2.onGround = true; e2.jumpStrength = 0; e2.angry = false;
    Mnt.travelRidden(e2, { forwardSpeed: 1, sidewaysSpeed: 0.6, yaw: 0, pitch: 0 });
    ok(near(spy.zza, 1) && near(spy.xxa, 0.3), 'forwardSpeed>0 passes through; sidewaysSpeed is HALVED (`* 0.5F`)');
  }

  // (d) the charged jump — exact vy, the horizontal kick only when moving forward, and
  //     `e.jumping` is forced false so Ph.travelMob's own flat-jump gate cannot ALSO fire.
  {
    // QUEUE 0.2 (G18e remainder) — vy is THIS horse's own rolled `jumpStrengthAttr`, not the
    // flat `LivingEntity` jump constant `JUMP_VELOCITY_BASE` names (`HorseBaseEntity.travel()`:
    // `getJumpStrength() * jumpStrength * multiplier`) — a horse with a below-average roll must
    // jump LOWER at full charge than one with an above-average roll, both different from 0.42.
    const e = mkHorse(); e.saddled = true; e.onGround = true; e.inAir = false; e.jumpStrength = 1.0; e.jumping = true;
    e.jumpStrengthAttr = 0.55;
    e.vx = 0; e.vy = 0; e.vz = 0; e.yaw = 0;
    Mnt.travelRidden(e, { forwardSpeed: 0, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    ok(near(spy.vyAtCall, 0.55), `full-charge jump injects vy = e.jumpStrengthAttr (got ${spy.vyAtCall})`);
    ok(spy.jumping === false, 'e.jumping is forced false before Ph.travelMob runs (no double jump)');
    ok(e.jumpStrength === 0, 'jumpStrength resets to 0 once spent');
    ok(e.inAir === true, 'setInAir(true) — the horse is airborne for horse-flag purposes');

    // anti-vacuity, DOUBLE direction: a different roll gives a DIFFERENT vy (proves the
    // attribute is actually read, not the flat constant this replaced), and an UNROLLED horse
    // (no jumpStrengthAttr at all — an old save, or a hand-built fixture) falls back to the
    // flat `Mnt.JUMP_STRENGTH_ATTR` default rather than silently jumping at 0.
    const eHi = mkHorse(); eHi.saddled = true; eHi.onGround = true; eHi.inAir = false; eHi.jumpStrength = 1.0;
    eHi.jumpStrengthAttr = 0.9; eHi.vx = 0; eHi.vy = 0; eHi.vz = 0; eHi.yaw = 0;
    Mnt.travelRidden(eHi, { forwardSpeed: 0, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    okAv(!near(spy.vyAtCall, 0.55) && near(spy.vyAtCall, 0.9), 'a different jumpStrengthAttr roll changes vy accordingly (not the old flat constant)');

    const eDflt = mkHorse(); eDflt.saddled = true; eDflt.onGround = true; eDflt.inAir = false; eDflt.jumpStrength = 1.0;
    delete eDflt.jumpStrengthAttr; eDflt.vx = 0; eDflt.vy = 0; eDflt.vz = 0; eDflt.yaw = 0;
    Mnt.travelRidden(eDflt, { forwardSpeed: 0, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    ok(near(spy.vyAtCall, Mnt.JUMP_STRENGTH_ATTR), 'an unrolled horse falls back to the flat JUMP_STRENGTH_ATTR default');

    // getJumpVelocityMultiplier: a horse standing in honey jumps at half height
    {
      const honey = M.States.stateOf('honey_block');
      M.Reg.buildPhysics({ defaults: { jumpFactor: 1 }, exceptions: { honey_block: { jumpFactor: 0.5 } } });   // golden value (19_data.gen physics)
      M.World.setBlock(0, PLAT_Y + 1, 0, honey);
      const eH = mkHorse(); eH.saddled = true; eH.onGround = true; eH.inAir = false; eH.jumpStrength = 1.0;
      eH.jumpStrengthAttr = 0.8; eH.x = 0.5; eH.y = PLAT_Y + 1; eH.z = 0.5; eH.vx = 0; eH.vy = 0; eH.vz = 0; eH.yaw = 0;
      Mnt.travelRidden(eH, { forwardSpeed: 0, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
      ok(near(spy.vyAtCall, 0.4), `jump in honey_block is halved (got ${spy.vyAtCall})`);
      M.World.setBlock(0, PLAT_Y + 1, 0, 0);
    }

    // anti-vacuity: no charge -> no vy injected at all
    const e2 = mkHorse(); e2.saddled = true; e2.onGround = true; e2.inAir = false; e2.jumpStrength = 0;
    e2.vx = 0; e2.vy = 0; e2.vz = 0;
    Mnt.travelRidden(e2, { forwardSpeed: 0, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    okAv(spy.vyAtCall === 0, 'zero jumpStrength injects no vy at all');

    // the forward horizontal kick only fires when moving forward at jump time
    const e3 = mkHorse(); e3.saddled = true; e3.onGround = true; e3.inAir = false; e3.jumpStrength = 1.0;
    e3.vx = 0; e3.vy = 0; e3.vz = 0; e3.yaw = 0;
    Mnt.travelRidden(e3, { forwardSpeed: 1, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    ok(!near(e3.vz, 0), 'a forward-moving charged jump also adds the horizontal forward kick (vz moved)');
  }

  // (e) the new Ph.travelMob `xxa` term: orthogonal to zza at equal magnitude, and it
  //     actually depends on xxa (killing it collapses back to the old zza-only shape).
  M.Physics.travelMob = realTravelMob;

  // (d2) #4106: airborne steering uses airStrafingSpeed = movementSpeed * 0.1, not the flat 0.02
  {
    const e = mkHorse(); e.saddled = true; e.onGround = false; e.inAir = true; e.jumpStrength = 0; e.angry = false;
    e.movementSpeedAttr = 0.3; e.vx = 0; e.vz = 0; e.vy = 0; e.yaw = 0;
    Mnt.travelRidden(e, { forwardSpeed: 1, sidewaysSpeed: 0, yaw: 0, pitch: 0 });
    okAv(near(e.vz, -0.03 * M.Physics.AIR_FRICTION), 'airborne ridden horse (speed 0.3) gains |vz| = 0.03 (0.1 * movementSpeed), not 0.02');
  }

  {
    const mkFlat = () => { const e = mkHorse(); e.onGround = true; e.vx = 0; e.vy = 0; e.vz = 0; e.yaw = 0.7; e.jumping = false; e.mobSpeed = 0.2; return e; };
    const eF = mkFlat(); eF.zza = 1; M.Physics.travelMob(eF, 0);
    const eS = mkFlat(); eS.zza = 0; M.Physics.travelMob(eS, 1);
    const dot = eF.vx * eS.vx + eF.vz * eS.vz;
    ok(near(dot, 0, 1e-6), 'a pure-forward push and a pure-sideways push land perpendicular to each other');
    ok(near(Math.hypot(eF.vx, eF.vz), Math.hypot(eS.vx, eS.vz), 1e-6), 'and at the same magnitude');
    // anti-vacuity: an xxa of 0 must reproduce the OLD (pre-this-session) zza-only vector exactly
    const eOld = mkFlat(); eOld.zza = 1; M.Physics.travelMob(eOld);   // no second argument at all
    okAv(near(eOld.vx, eF.vx) && near(eOld.vz, eF.vz), 'calling travelMob(e) with NO xxa argument is bit-for-bit the pre-existing behaviour');
  }
}

// ── §7. the mount/saddle branch actually wires into EL.tickMob (D-417's own risk) ────────────
say('\n§7 — EL.tickMob only calls Mount.travelRidden when RIDDEN AND SADDLED');
{
  const realTravelRidden = Mnt.travelRidden;
  let called = 0;
  Mnt.travelRidden = function (e) { called++; e.pitch = 999; realTravelRidden.call(Mnt, e, { yaw: e.yaw, pitch: 0, forwardSpeed: 0, sidewaysSpeed: 0 }); };

  const e = mkHorse(); e.x = 0; e.y = PLAT_Y + 1; e.z = 0; e.onGround = true; e.rider = 'player'; e.saddled = false;
  called = 0;
  EL.tickMob(e);
  ok(called === 0, 'ridden but UNSADDLED: EL.tickMob does not call Mount.travelRidden');

  const e2 = mkHorse(); e2.x = 0; e2.y = PLAT_Y + 1; e2.z = 0; e2.onGround = true; e2.rider = 'player'; e2.saddled = true; e2.tamed = true;   // untamed => HorseBondWithPlayerGoal throws the rider 1 tick in 50
  called = 0;
  EL.tickMob(e2);
  okAv(called === 1, 'ridden AND saddled: EL.tickMob calls Mount.travelRidden exactly once');

  Mnt.travelRidden = realTravelRidden;
}

// ── §8. Mount.menu — the equip slots and the container, off the shared Menu primitives ───────
say('\n§8 — Mount.menu (saddle slot, armour slot, the attribute bonus)');
{
  const Inv = M.Inventory;
  const e = mkHorse(); e.tamed = true;
  const inventory = Inv.create();
  const m = Mnt.menu(e, inventory);
  ok(!!m && m.slots.length === 2 + 27 + 9, 'the menu has 2 mount slots + 27 backpack + 9 hotbar');

  const saddleStack = Inv.stack('saddle', 1);
  const dirtStack = Inv.stack('dirt', 1);
  ok(m.slots[0].placeFn(saddleStack) === true, 'slot 0 accepts a saddle stack');
  ok(m.slots[0].placeFn(dirtStack) === false, 'slot 0 refuses a non-saddle stack');

  const goldArmor = Inv.stack('golden_horse_armor', 1);
  ok(m.slots[1].placeFn(goldArmor) === true, 'slot 1 accepts golden_horse_armor');
  ok(m.slots[1].placeFn(dirtStack) === false, 'slot 1 refuses a non-armour stack');

  M.Menu.slotSet(m.slots[1], goldArmor);
  ok(e.armorItem === 'golden_horse_armor' && e.armorBonus === 7, 'placing golden_horse_armor sets the jar\'s own bonus (7)');
  M.Menu.slotSet(m.slots[1], null);
  okAv(e.armorItem === null && e.armorBonus === 0, 'clearing the slot clears the bonus back to zero');

  M.Menu.slotSet(m.slots[0], saddleStack);
  ok(e.saddled === true, 'placing a saddle in slot 0 sets e.saddled through the menu, not just Mount.saddle');
}

// ── §9. Use.entityUse — the live dispatch: feed, saddle, mount, and NOT Breed's generic love ──
say('\n§9 — Use.entityUse dispatches a horse to Mount.interact, never to Breed.interact');
{
  const Inv = M.Inventory, Use = M.Use;
  const P = () => ({ instabuild: false, crouching: false });

  // wheat must NOT instant-love a horse the way it would a cow (Breed.SPECIAL.horse's own gap)
  const e = mkHorse(); e.tamed = true; e.growAge = 0; e.temper = 0; e.health = 10; e.maxHealth = 20;
  const wheat = Inv.stack('wheat', 5);
  ok(Use.entityUse(P(), e, wheat) === true, 'right-clicking wheat on a horse is handled');
  ok(!Br.isInLove(e), 'and it did NOT start love mode the way Breed.interact would have (Mount owns horse food)');
  ok(wheat.n === 4, 'the wheat stack was decremented by exactly one');
  ok(e.health === 12 && e.temper === 3, 'and receiveFood\'s own heal+temper ran');

  // saddle
  const wild = mkHorse(); wild.tamed = false;
  const saddle1 = Inv.stack('saddle', 1);
  ok(Use.entityUse(P(), wild, saddle1) === true, 'right-clicking a saddle on an untamed horse is handled');
  ok(!wild.saddled, 'but it does not equip (untamed — SaddleItem.useOnEntity PASSes, canBeSaddled() needs isTame())');
  ok(saddle1.n === 1, 'and the saddle is NOT spent — the angry branch returns success without touching the stack');

  const tame = mkHorse(); tame.tamed = true;
  const saddle2 = Inv.stack('saddle', 1);
  ok(Use.entityUse(P(), tame, saddle2) === true && tame.saddled === true, 'a saddle on a TAME horse equips directly, no screen needed');
  ok(saddle2.n === 0, 'and the saddle stack is spent');

  // empty-hand mount
  const rideable = mkHorse(); rideable.tamed = false;
  ok(Use.entityUse(P(), rideable, null) === true, 'empty-hand right-click on a horse is handled');
  ok(rideable.rider === 'player', 'and it mounted the player, untamed or not');
}

// ── §10. Tame.OWED no longer names horse riding as unbuilt ────────────────────────────────────
say('\n§10 — Tame.OWED');
{
  const stillNamesRiding = M.Tame.OWED.some((s) => /riding \(horses/i.test(s));
  ok(!stillNamesRiding, 'Tame.OWED no longer says "riding (horses, G25)" is unbuilt');
}

// ── §11. the live player riding: camera/position follow, and input -> travelRidden ───────────
say('\n§11 — P.tickMounted: camera-follow position and real rider input reaching Mount.travelRidden');
{
  const P = M.Player;
  const e = mkHorse(10, 20); e.tamed = true; e.saddled = true; e.onGround = true;
  e.jumpStrength = 0; e.angry = false;
  P.x = 0; P.y = 0; P.z = 0; P.yaw = 0.4; P.pitch = 0.2; P.WIDTH = 0.6;
  P.mountVehicle(e);
  ok(P.vehicle === e, 'P.mountVehicle seats the player on the horse');

  // (a) camera/position follow — `Entity.getMountedHeightOffset()`: horse height (1.6) * 0.75
  P.tickMounted({ fwd: 0, strafe: 0, jump: false, sneak: false });
  ok(P.x === e.x && P.z === e.z, 'P.x/P.z snap to the mount this tick (10_gfx.js reads P.ex/ey/ez from these)');
  ok(near(P.y, e.y + 1.2), `P.y is the mount's Y plus 1.6*0.75=1.2 (got offset ${(P.y - e.y).toFixed(4)})`);
  // anti-vacuity: move the horse and re-tick — the follow must track it, not freeze at spawn
  e.x = 37; e.y = 70; e.z = -5;
  P.tickMounted({ fwd: 0, strafe: 0, jump: false, sneak: false });
  okAv(P.x === 37 && near(P.y, 71.2) && P.z === -5, 'moving the mount and re-ticking moves the camera/position with it');

  // (b) forward/strafe/yaw/pitch input actually reaches Mount.travelRidden through e.riderInput
  P.yaw = 1.1; P.pitch = -0.3;
  P.tickMounted({ fwd: 1, strafe: -1, jump: false, sneak: false });
  // `P.tickMounted`'s WHOLE contract for the mount's own movement is writing `e.riderInput` —
  // the mount's own tick (`07i_entitylist.js`'s existing, untouched `Mount.travelRidden(e)`
  // call site, §7) is what actually consumes it. Prove the WRITE directly, then prove the
  // no-arg call site really reads it by calling the real function the same way that site does.
  ok(!!e.riderInput, 'P.tickMounted wrote e.riderInput');
  ok(e.riderInput.forwardSpeed === 1 && e.riderInput.sidewaysSpeed === -1, 'exactly this tick\'s fwd/strafe');
  ok(e.riderInput.yaw === 1.1 && e.riderInput.pitch === -0.3, 'and the player\'s own yaw/pitch');
  e.pitch = 0; e.yaw = 0;
  Mnt.travelRidden(e);   // no second argument — exactly 07i_entitylist.js's own call site
  okAv(e.yaw === 1.1 && near(e.pitch, -0.15), 'travelRidden(e) with no rider arg picks up e.riderInput and moves the horse\'s own yaw/pitch to match');
  // anti-vacuity, other direction: a horse the player never rode has no riderInput at all --
  // travelRidden(e) must fall back to `{}`, not silently reuse another mount's stale input.
  const unridden = mkHorse(99, 99);
  const beforeYaw = unridden.yaw;
  Mnt.travelRidden(unridden);
  okAv(unridden.yaw === beforeYaw, 'an entity with no e.riderInput at all gets travelRidden\'s own {} default (yaw untouched)');

  P.vehicle = null;
}

// ── §12a. setJumpStrength rears the horse (HorseBaseEntity.setJumpStrength .decomp 865) ──────
{
  const e = mkHorse(0, 0); e.tamed = true; e.saddled = true; e.jumping = false; e.angry = false; e.angryTicks = 0;
  Mnt.setJumpStrength(e, 50);
  okAv(e.jumping === true && e.angry === true && e.angryTicks === 1, 'setJumpStrength(e,50) sets jumping, angry and angryTicks=1');
  const f = mkHorse(0, 0); f.tamed = true; f.saddled = true; f.jumping = false; f.angry = false;
  Mnt.setJumpStrength(f, -5);
  okAv(f.jumping === false && !f.angry, 'a negative charge leaves jumping/angry alone');
}

// ── §12. the jump-charge state machine — ClientPlayerEntity.tickMovement's own curve ─────────
say('\n§12 — jump-charge: the charge curve, the release -> Mount.setJumpStrength, and the HUD field');
{
  const P = M.Player;
  const e = mkHorse(0, 0); e.tamed = true; e.saddled = true; e.onGround = true; e.jumpStrength = 0;
  P.mountVehicle(e);

  // hold jump for 5 ticks — tick 1 is the PRESS edge (field_3938 reset to 0, strength 0), so
  // only ticks 2..5 actually charge: field_3938 1,2,3,4 -> strength 0.1,0.2,0.3,0.4.
  for (let i = 0; i < 5; i++) P.tickMounted({ fwd: 0, strafe: 0, jump: true, sneak: false });
  ok(near(P.mountJumpStrength, 0.4), `5 ticks held (1 press + 4 charging) -> mountJumpStrength 0.4 (got ${P.mountJumpStrength.toFixed(3)})`);

  // release: e.jumpStrength (the HORSE's own charge, 0.4..1.0) is set from floor(strength*100)
  // = floor(0.4*100) = 40 -> Mount.setJumpStrength's own 0.4 + 0.4*40/90 curve.
  P.tickMounted({ fwd: 0, strafe: 0, jump: false, sneak: false });
  const expectHorse = 0.4 + 0.4 * 40 / 90;
  ok(near(e.jumpStrength, expectHorse, 1e-6), `releasing at 0.4 calls Mount.setJumpStrength(40) onto the horse (got ${e.jumpStrength.toFixed(4)}, want ${expectHorse.toFixed(4)})`);
  // ⚠ NOT AN OFF-BY-ONE: `mountJumpStrength` (the HUD field) does NOT clear on the release tick
  // itself — `field_3938` only starts counting UP from -10 the tick AFTER release, and the field
  // clears when it reaches 0 ten ticks later (.decomp, `ClientPlayerEntity.tickMovement`, read
  // in full — the decay guard runs BEFORE the press/release branch each tick, off the field's
  // value at the START of that tick, which is still positive on the release tick itself).
  ok(P.mountJumpStrength === 0.4, 'the HUD field stays at its last charge through the release tick itself, not reset early');
  for (let i = 0; i < 9; i++) P.tickMounted({ fwd: 0, strafe: 0, jump: false, sneak: false });
  ok(P.mountJumpStrength === 0.4, 'still holding at 0.4 nine ticks after release (field_3938 has not reached 0 yet)');
  P.tickMounted({ fwd: 0, strafe: 0, jump: false, sneak: false });   // the 10th tick after release
  okAv(P.mountJumpStrength === 0, 'and clears to 0 exactly on the 10th tick after release, matching field_3938 counting -10..0');

  // anti-vacuity: NEVER holding jump at all must never charge anything
  const e2 = mkHorse(5, 5); e2.tamed = true; e2.saddled = true; e2.onGround = true; e2.jumpStrength = 0;
  P.mountVehicle(e2);
  for (let i = 0; i < 5; i++) P.tickMounted({ fwd: 0, strafe: 0, jump: false, sneak: false });
  okAv(P.mountJumpStrength === 0 && e2.jumpStrength === 0, 'never pressing jump leaves both charge fields at 0');

  // an UNSADDLED mount can never charge a jump (JumpingMount.canJump() === isSaddled())
  const e3 = mkHorse(9, 9); e3.tamed = true; e3.saddled = false; e3.onGround = true;
  P.mountVehicle(e3);
  for (let i = 0; i < 5; i++) P.tickMounted({ fwd: 0, strafe: 0, jump: true, sneak: false });
  ok(P.mountJumpStrength === 0, 'an unsaddled mount never charges a jump at all');

  P.vehicle = null;
}

// ── §13. sneak dismounts — Entity.getPassengerDismountOffset, off to the side ────────────────
say('\n§13 — P.dismountVehicle: shouldDismount()===isSneaking(), placed off to the side (not inside the horse)');
{
  const P = M.Player;
  const e = mkHorse(0, 0); e.tamed = true; e.saddled = true; e.onGround = true; e.yaw = 0;
  e.x = 0; e.y = PLAT_Y + 1; e.z = 0;
  P.WIDTH = 0.6;
  P.mountVehicle(e);
  ok(P.vehicle === e, 'mounted, precondition');

  P.tickMounted({ fwd: 1, strafe: 1, jump: false, sneak: true });
  ok(P.vehicle === null, 'sneak while mounted dismounts (PlayerEntity.shouldDismount() === isSneaking())');
  ok(e.rider === null, 'and Mount.dismount actually ran (e.rider cleared)');
  const dx = P.x - e.x, dz = P.z - e.z;
  const dist = Math.hypot(dx, dz);
  ok(dist > 0.5, `the dismounted player lands OFF the horse, not on top of it (dist=${dist.toFixed(3)})`);
  ok(near(P.y, e.y), 'a clear flat floor: the real column scan (Mount.findDismountPos) still lands the rider at the mount\'s own Y, same as the open-air case always did');

  // anti-vacuity: the exact offset is Mount.dismountOffset's own formula, not an arbitrary shove
  const w = M.Entities.width('horse');
  const expected = Mnt.dismountOffset(w, 0.6, e.yaw + Math.PI / 2);
  okAv(near(dx, expected.x) && near(dz, expected.z),
    `the dismount offset is EXACTLY Mount.dismountOffset(horseWidth, playerWidth, yaw+90deg) (got dx=${dx.toFixed(4)} dz=${dz.toFixed(4)}, want ${expected.x.toFixed(4)}/${expected.z.toFixed(4)})`);

  // a plain (non-sneak) tick never dismounts
  const e2 = mkHorse(1, 1); e2.tamed = true; e2.saddled = true; e2.onGround = true;
  P.mountVehicle(e2);
  P.tickMounted({ fwd: 0, strafe: 0, jump: false, sneak: false });
  ok(P.vehicle === e2, 'not sneaking: still mounted');
  P.vehicle = null;
}

// ── §13a. #4230 submerged rider is dismounted unless the mount canBeRiddenInWater (skeleton_horse)
{
  const P = M.Player;
  const run = (type, wet) => {
    const e = mkHorse(20, 20); e.type = type; e.tamed = true; e.saddled = true; e.onGround = true;
    P.WIDTH = 0.6; P.mountVehicle(e); P.eyeInWater = wet;
    P.tickMounted({ fwd: 0, strafe: 0, jump: false, sneak: false });
    const still = P.vehicle === e; P.eyeInWater = false; P.vehicle = null; e.rider = null; return still;
  };
  ok(run('horse', true) === false, '#4230 eyes underwater on a horse -> dismounted');
  ok(run('skeleton_horse', true) === true, '#4230 eyes underwater on a skeleton_horse -> stays');
  okAv(run('horse', false) === true, 'anti-vacuity: dry rider on a horse stays mounted');
}

// ── §13b. the REAL dismount column scan — Dismounting.canDismountInBlock/getDismountHeight ───
say('\n§13b — Mount.findDismountPos/locateSafeDismountingPos: the real per-pose column walk (QUEUE 0.2 G18e remainder)');
{
  const P = M.Player;
  const w = M.Entities.width('horse'), h = M.Entities.height('horse');

  // (a) the main-arm side's dismount cell is BLOCKED (a stone block right at the mount's own Y)
  // but the cell one block above it is open floor+headroom -- the scan must climb to find it,
  // not just take (or refuse) the first cell it tries.
  {
    const e = mkHorse(10, 10); e.tamed = true; e.saddled = true; e.yaw = 0; e.y = PLAT_Y + 1;
    const off = Mnt.dismountOffset(w, 0.6, e.yaw + Math.PI / 2);
    const fx = Math.floor(e.x + off.x), fz = Math.floor(e.z + off.z);
    M.World.setBlock(fx, PLAT_Y + 1, fz, STONE);   // occupies the naive "same Y as the mount" cell
    P.WIDTH = 0.6;
    P.mountVehicle(e);
    P.tickMounted({ fwd: 0, strafe: 0, jump: false, sneak: true });
    ok(P.vehicle === null, 'dismounted despite the blocked cell');
    ok(near(P.y, PLAT_Y + 2) && !M.Physics.solidAt(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z)),
      `climbed exactly one cell to the first open, floored, headroom-clear spot (P.y=${P.y}, want ${PLAT_Y + 2})`);
    M.World.setBlock(fx, PLAT_Y + 1, fz, 0);   // clean up for the next sub-test
  }

  // (b) BOTH sides fully solid, floor to ceiling -- the jar's own final fallback: land ON the
  // mount's own position rather than crashing or teleporting somewhere unrelated.
  {
    const e = mkHorse(20, 20); e.tamed = true; e.saddled = true; e.yaw = 0; e.y = PLAT_Y + 1;
    const offR = Mnt.dismountOffset(w, 0.6, e.yaw + Math.PI / 2);
    const offL = Mnt.dismountOffset(w, 0.6, e.yaw - Math.PI / 2);
    const cols = [
      [Math.floor(e.x + offR.x), Math.floor(e.z + offR.z)],
      [Math.floor(e.x + offL.x), Math.floor(e.z + offL.z)]
    ];
    const top = Math.ceil(e.y + h + 0.75) + 1;
    for (const [cx, cz] of cols) for (let y = PLAT_Y + 1; y <= top; y++) M.World.setBlock(cx, y, cz, STONE);
    P.WIDTH = 0.6;
    P.mountVehicle(e);
    P.tickMounted({ fwd: 0, strafe: 0, jump: false, sneak: true });
    ok(P.vehicle === null, 'still dismounts (never gets stuck riding forever)');
    okAv(near(P.x, e.x) && near(P.y, e.y) && near(P.z, e.z),
      `both sides sealed solid: falls back to the mount's OWN position (Dismounting's jar-final fallback), got (${P.x.toFixed(2)},${P.y.toFixed(2)},${P.z.toFixed(2)}) want (${e.x},${e.y},${e.z})`);
    for (const [cx, cz] of cols) for (let y = PLAT_Y + 1; y <= top; y++) M.World.setBlock(cx, y, cz, 0);
  }

  // (c) direct unit test of Mount.locateSafeDismountingPos, both directions: a floored empty
  // cell with headroom passes, the SAME cell with no floor beneath it (floating) is refused.
  M.World.setBlock(30, PLAT_Y, 30, STONE);
  const e3 = mkHorse(30, 30); e3.y = PLAT_Y + 1;
  const good = Mnt.locateSafeDismountingPos(e3, { x: 0, z: 0 }, M.Physics);
  ok(good && near(good.y, PLAT_Y + 1), 'locateSafeDismountingPos: the mount\'s own floored column is a valid dismount cell');
  const e4 = mkHorse(31, 31); e4.y = PLAT_Y + 20;   // high in open air over an UNFLOORED column, nothing solid below within range
  const bad = Mnt.locateSafeDismountingPos(e4, { x: 0, z: 0 }, M.Physics);
  okAv(bad === null, 'and the exact same probe returns null with no floor in range (not a false positive)');
}

// ── §14. horse armour actually reduces damage — the join into Combat's own hurt() ────────────
say('\n§14 — Combat.hurt reads e.armorBonus (HorseEntity\'s GENERIC_ARMOR modifier), CombatRules verbatim');
{
  const Cb = M.Combat;
  ok(!!Cb && !!Cb.hurt, 'Combat.hurt exists');
  const bare = mkHorse(0, 0); bare.tamed = true; bare.health = 20; bare.maxHealth = 20;
  bare.armorBonus = 0; bare.invulnerableTime = 0; bare.lastHurt = 0;
  Cb.hurt(bare, 10, undefined, true);
  ok(near(bare.health, 10), 'no armour bonus: 10 raw damage lands in full');

  const armoured = mkHorse(1, 1); armoured.tamed = true; armoured.health = 20; armoured.maxHealth = 20;
  Mnt.equipArmor(armoured, 'diamond_horse_armor');
  ok(armoured.armorBonus === 11, 'diamond_horse_armor stores bonus 11 (Items.java\'s own HorseArmorItem(11))');
  armoured.invulnerableTime = 0; armoured.lastHurt = 0;
  Cb.hurt(armoured, 10, undefined, true);
  const expectDealt = M.Survival.afterArmor(10, 11, 0);
  okAv(near(armoured.health, 20 - expectDealt) && armoured.health > 10,
    `armour=11 reduces the SAME 10 damage to CombatRules.getDamageAfterAbsorb's own number (health=${armoured.health.toFixed(3)}, expected ${(20 - expectDealt).toFixed(3)})`);

  // anti-vacuity direction 2: clearing the armour again must restore full damage
  Mnt.equipArmor(armoured, null);
  ok(armoured.armorBonus === 0, 'equipArmor(null) clears the bonus back to 0');
  armoured.invulnerableTime = 0; armoured.lastHurt = 0; armoured.health = 20;
  Cb.hurt(armoured, 10, undefined, true);
  ok(near(armoured.health, 10), 'and with the bonus cleared, the same 10 damage lands in full again');
}


// ── §15. per-spawn attribute rolls — HorseEntity.initAttributes (QUEUE 0.2 G18e remainder) ───
say('\n§15 — Mount.rollAttributes: the per-spawn roll, off HorseBaseEntity/HorseEntity\'s own three getChildXBonus() methods');
{
  // (a) a FIXED sequence of "random" draws pins the formula to an exact number — not just a
  // bounds sweep. `nextInt(n)` here is `Math.floor(rand()*n)` (this codebase's own convention,
  // see 07k_goals.js's CROSSBOW rolls); a rand() sequence of [0.5, 0.5, 0.5] against nextInt(8)/
  // nextInt(9) is floor(4)=4 and floor(4.5)=4, so childHealthBonus(seq) === 15+4+4 === 23 exactly.
  const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  ok(near(Mnt.childHealthBonus(seq([0.5, 0.5])), 23), 'childHealthBonus: 15 + floor(0.5*8) + floor(0.5*9) = 15+4+4 = 23');
  ok(near(Mnt.childJumpStrengthBonus(seq([0.5, 0.5, 0.5])), 0.4 + 0.1 + 0.1 + 0.1, 1e-6), 'childJumpStrengthBonus: 0.4 + 3*(0.5*0.2)');
  ok(near(Mnt.childMovementSpeedBonus(seq([0.5, 0.5, 0.5])), (0.45 + 3 * (0.5 * 0.3)) * 0.25, 1e-6), 'childMovementSpeedBonus: (0.45 + 3*(0.5*0.3)) * 0.25');

  // (b) Mnt.rollAttributes wires the three onto the entity, overwrites maxHealth/health, and the
  // SAME fixed sequence run through initAttributes()'s real call order (health, speed, jump —
  // HorseEntity.initAttributes.decomp's own field order) reproduces an exact combination.
  const e = mkHorse();
  const seq2 = seq([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  const hpBefore = e.health;
  Mnt.rollAttributes(e, seq2);
  ok(near(e.maxHealthAttr, 23), 'rollAttributes: maxHealthAttr matches the pinned childHealthBonus draw');
  // initAttributes re-rolls the max_health BASE only; Health keeps the constructor's value (the real
  // server's /summon reads Health 53 over a 15..30 max — mobrefattrcheck's golden, cloud focused-planck).
  ok(near(e.maxHealth, 23) && e.health === hpBefore, 'rollAttributes overwrites maxHealth and leaves health as spawned');
  { const f = mkHorse(); delete f.health; Mnt.rollAttributes(f, seq([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
    ok(f.health === M.Entities.attrsOf('horse').hp && f.health > f.maxHealth,
      'rollAttributes on a health-less horse takes the createBaseHorseAttributes table health, above the rolled max'); }

  // (c) bounds — every roll is inside HorseBaseEntity's own formula range, across many draws
  // with the REAL rng (Math.random), both ends: health in [15,30], jump in [0.4,1.0], speed in
  // [0.1125, 0.3375] (= [0.45,1.35] * 0.25).
  let minH = Infinity, maxH = -Infinity, minJ = Infinity, maxJ = -Infinity, minS = Infinity, maxS = -Infinity;
  for (let i = 0; i < 2000; i++) {
    const eh = { }; Mnt.rollAttributes(eh, Math.random);
    minH = Math.min(minH, eh.maxHealthAttr); maxH = Math.max(maxH, eh.maxHealthAttr);
    minJ = Math.min(minJ, eh.jumpStrengthAttr); maxJ = Math.max(maxJ, eh.jumpStrengthAttr);
    minS = Math.min(minS, eh.movementSpeedAttr); maxS = Math.max(maxS, eh.movementSpeedAttr);
  }
  ok(minH >= 15 && maxH < 31, `maxHealthAttr stays in HorseBaseEntity's own [15,31) range over 2000 rolls (got [${minH},${maxH}])`);
  ok(minJ >= 0.4 && maxJ <= 1.0 + 1e-9, `jumpStrengthAttr stays in [0.4,1.0] over 2000 rolls (got [${minJ.toFixed(3)},${maxJ.toFixed(3)}])`);
  ok(minS >= 0.1125 - 1e-9 && maxS <= 0.3375 + 1e-9, `movementSpeedAttr stays in [0.1125,0.3375] over 2000 rolls (got [${minS.toFixed(4)},${maxS.toFixed(4)}])`);

  // anti-vacuity, both directions: the roll actually READS the rng (two different fixed
  // sequences give two different, non-overlapping results), and a horse spawned through the
  // REAL EL.spawn('horse', ...) path (mkHorse) actually got a rolled attribute at all — not the
  // flat table default `Ent.attrsOf('horse').hp` `07i_entitylist.js`'s own generic health init
  // set moments earlier (this is the exact bug `Mount.OWED` used to name: `EL.DEFAULTS.horse`
  // was never wired to `Mount.rollAttributes` at all before this session).
  const lo = {}; Mnt.rollAttributes(lo, seq([0, 0, 0, 0, 0, 0, 0]));
  const hi = {}; Mnt.rollAttributes(hi, seq([0.999999, 0.999999, 0.999999, 0.999999, 0.999999, 0.999999, 0.999999]));
  okAv(lo.maxHealthAttr !== hi.maxHealthAttr && lo.jumpStrengthAttr !== hi.jumpStrengthAttr && lo.movementSpeedAttr !== hi.movementSpeedAttr,
    'two different rand sequences roll two DIFFERENT sets of attributes (the formula reads rand, not a constant)');
  const spawned = mkHorse();
  okAv(spawned.maxHealthAttr !== undefined && spawned.jumpStrengthAttr !== undefined && spawned.movementSpeedAttr !== undefined,
    'EL.spawn(\'horse\', ...) itself rolls attributes through EL.DEFAULTS.horse -- not left unset until Mount.menu opens');
}

// ── §16. offspring averaging — HorseBaseEntity.setChildAttributes (Breed.CHILD.horse) ────────
say('\n§16 — Breed.CHILD.horse: setChildAttributes\' three-way average, and Breed.canBreed(\'horse\') now true');
{
  const Br = M.Breed;
  const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

  // (a) canBreed flips both directions: horse now real (this unit closed it). donkey/mule
  // closed loop/donkey-s96 (donkeycheck.mjs's own §6 exercises them), llama closed
  // loop/llama-s97 (llamacheck.mjs's own suite) — only trader_llama (no wandering-trader
  // escort/despawn substrate exists) stays refused.
  ok(Br.canBreed('horse') === true, 'Breed.canBreed(\'horse\') is now true (Breed.SPECIAL.horse closed, this unit)');
  okAv(Br.canBreed('llama') === true,
    'llama flipped too (loop/llama-s97 — Breed.SPECIAL.llama removed, Breed.CHILD.llama built)');

  // (b) a fixed rand sequence pins setChildAttributes' own average to an exact number: both
  // parents at a known xAttr, bonus pinned by the sequence, then /3.0 -- HorseBaseEntity.
  // setChildAttributes' own arithmetic, verbatim.
  const a = { maxHealthAttr: 18, jumpStrengthAttr: 0.5, movementSpeedAttr: 0.2 };
  const b = { maxHealthAttr: 24, jumpStrengthAttr: 0.7, movementSpeedAttr: 0.3 };
  const child = {};
  Br.CHILD.horse(child, a, b, seq([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
  const expectHealth = (18 + 24 + Mnt.childHealthBonus(seq([0.5, 0.5]))) / 3;
  ok(near(child.maxHealthAttr, expectHealth), `child maxHealthAttr = (18+24+bonus)/3 (got ${child.maxHealthAttr}, want ${expectHealth})`);
  ok(near(child.maxHealth, child.maxHealthAttr) && near(child.health, child.maxHealth), 'child maxHealth/health both follow the averaged attribute');
  const expectJump = (0.5 + 0.7 + Mnt.childJumpStrengthBonus(seq([0.5, 0.5, 0.5]))) / 3;
  ok(near(child.jumpStrengthAttr, expectJump), 'child jumpStrengthAttr is the same three-way average');
  const expectSpeed = (0.2 + 0.3 + Mnt.childMovementSpeedBonus(seq([0.5, 0.5, 0.5]))) / 3;
  ok(near(child.movementSpeedAttr, expectSpeed), 'child movementSpeedAttr is the same three-way average');

  // (c) a parent with no roll at all (pre-this-session save / hand-built fixture) falls back to
  // the flat vanilla defaults rather than reading `undefined` into the average.
  const bare = { maxHealth: 30 };   // no *Attr fields at all
  const rolled = { maxHealthAttr: 30, jumpStrengthAttr: 1.0, movementSpeedAttr: 0.3375 };
  const child2 = {};
  Br.CHILD.horse(child2, bare, rolled, () => 0);   // rand=0 minimises the bonus term
  const wantHealth2 = (30 /* bare.maxHealth fallback */ + 30 + Mnt.childHealthBonus(() => 0)) / 3;
  ok(near(child2.maxHealthAttr, wantHealth2), 'an unrolled parent falls back to its own e.maxHealth, not undefined/NaN');
  const wantJump2 = (Mnt.JUMP_STRENGTH_ATTR + 1.0 + Mnt.childJumpStrengthBonus(() => 0)) / 3;
  ok(near(child2.jumpStrengthAttr, wantJump2), 'an unrolled parent\'s jump falls back to the flat JUMP_STRENGTH_ATTR default');

  // anti-vacuity, both directions: swapping in a DIFFERENT pair of parents changes the child's
  // result (the average actually reads ITS OWN parents, not a fixed pair), and the generic
  // path's own child spawn (EL.spawn inside Breed.breed) gets OVERWRITTEN by this averaging
  // rather than left at its own independent initAttributes() roll.
  const child3 = {};
  Br.CHILD.horse(child3, { maxHealthAttr: 15 }, { maxHealthAttr: 15 }, seq([0.5, 0.5]));
  okAv(!near(child3.maxHealthAttr, child.maxHealthAttr), 'a different parent pair produces a different averaged child (not a constant)');

  const p1 = mkHorse(0, 0); p1.tamed = true; p1.growAge = 0; Br.setInLove(p1, null);
  p1.maxHealthAttr = 20; p1.jumpStrengthAttr = 0.6; p1.movementSpeedAttr = 0.25;
  const p2 = mkHorse(0.1, 0); p2.tamed = true; p2.growAge = 0; Br.setInLove(p2, null);
  p2.maxHealthAttr = 26; p2.jumpStrengthAttr = 0.8; p2.movementSpeedAttr = 0.3;
  const foal = Br.breed(p1, p2, { random: Math.random });
  ok(!!foal, 'Breed.breed actually produces a horse foal now (canBreed(\'horse\') is true)');
  ok(Br.isBaby(foal), 'the foal is born a baby (AgeableMob.setBaby, same generic path as wolf/cat)');
  okAv(foal.maxHealthAttr !== undefined && foal.maxHealthAttr !== 15, // 15 is childHealthBonus's own floor, and EL.DEFAULTS' own fresh roll would coincidentally hit it only 1/72 of the time
    `Breed.breed's foal carries Breed.CHILD.horse's averaged attributes, not just EL.spawn's own independent roll (got maxHealthAttr=${foal.maxHealthAttr})`);
}

// ── §17. the horse screen — Gui.HORSE vs HorseScreenHandler/.decomp, and the open dispatch ────
say('\n§17 — Gui.HORSE: the real panel/slot geometry, vs .decomp\'s own literals, and the open/close wiring');
{
  const G = M.Gui;
  ok(!!G && !!G.HORSE, 'Gui.HORSE is defined');
  ok(G.HORSE.w === 176 && G.HORSE.h === 166, 'panel is 176x166 (HandledScreen\'s own unoverridden default)');
  // HorseScreenHandler (.decomp): addSlot(new Slot(inv,0,8,18)) / (inv,1,8,36) / player main
  // (8+i*18, 102+row*18-18 = 84+row*18, D-550) / hotbar (8+i*18, 142) -- transcribed literal for literal.
  ok(G.HORSE.saddle[0] === 8 && G.HORSE.saddle[1] === 18, 'saddle slot at (8,18) — HorseScreenHandler\'s own Slot literal');
  ok(G.HORSE.armour[0] === 8 && G.HORSE.armour[1] === 36, 'armour slot at (8,36) — HorseScreenHandler\'s own Slot literal');
  ok(G.HORSE.main[0] === 8 && G.HORSE.main[1] === 84, 'player main band starts at (8,84) — HorseScreenHandler\'s own `102 + row*18 - 18`, row 0 (D-550)');
  ok(G.HORSE.hotbar[0] === 8 && G.HORSE.hotbar[1] === 142, 'hotbar at (8,142) — same footer every survival screen here shares');
  ok(G.HORSE.title.x === 8 && G.HORSE.title.y === 6, 'title at (8,6) — HandledScreen\'s own unoverridden default');

  // horseSlotXY/-At: the 38-slot table (2 equip + 27 backpack + 9 hotbar — Mount.menu's own
  // count, §8 above), both ends and one in the middle, plus the inverse hit-test both directions.
  ok(near(G.horseSlotXY(0)[0], 8) && near(G.horseSlotXY(0)[1], 18), 'slot 0 (saddle) at (8,18)');
  ok(near(G.horseSlotXY(1)[0], 8) && near(G.horseSlotXY(1)[1], 36), 'slot 1 (armour) at (8,36)');
  ok(near(G.horseSlotXY(2)[0], 8) && near(G.horseSlotXY(2)[1], 84), 'slot 2 (first backpack cell) at (8,84)');
  ok(near(G.horseSlotXY(10)[0], 8 + 8 * 18) && near(G.horseSlotXY(10)[1], 84), 'slot 10 (last of backpack row 0) at (8+8*18,84)');
  ok(near(G.horseSlotXY(28)[0], 8 + 8 * 18) && near(G.horseSlotXY(28)[1], 84 + 2 * 18), 'slot 28 (last backpack cell) at (8+8*18, 84+2*18)');
  ok(near(G.horseSlotXY(29)[0], 8) && near(G.horseSlotXY(29)[1], 142), 'slot 29 (first hotbar cell) at (8,142)');
  ok(near(G.horseSlotXY(37)[0], 8 + 8 * 18) && near(G.horseSlotXY(37)[1], 142), 'slot 37 (last hotbar cell) at (8+8*18,142)');
  ok(G.horseSlotAt(9, 19) === 0, 'a point inside slot 0\'s 16x16 box hits slot 0');
  ok(G.horseSlotAt(9, 37) === 1, 'a point inside slot 1\'s box hits slot 1');
  okAv(G.horseSlotAt(9, 19.5 + 16) === -1, 'a point one pixel below slot 0\'s box (still above slot 1) hits nothing — proves the box is bounded, not a half-plane');

  // (guicheck-style, headless — this file loads 15b_gui.js the same way guicheck.mjs does, no
  // DOM/canvas needed) the horse.png SHEET itself: present, the vanilla 256x256 size every other
  // GUI atlas entry this project ships uses, and the two equip-slot ICON rects this file names
  // (`saddleIcon`/`armourIcon`) land on PAINTED pixels (alpha=255) rather than the sheet's own
  // transparent padding — the same "a rectangle is checked against the artwork, not trusted"
  // rule guicheck.mjs's own header states.
  const blob = inflateRawSync(readFileSync(join(ASSETS, 'gui.bin')));
  const hlen = blob.readUInt32LE(0);
  const head = JSON.parse(blob.slice(4, 4 + hlen).toString('utf8'));
  const base = 4 + hlen;
  const sheetMeta = head.sheets.find((x) => x.n === 'horse');
  ok(!!sheetMeta, 'gui.bin carries a \'horse\' sheet (tools/build-gui.mjs\'s own SHEETS entry, this unit)');
  ok(sheetMeta.w === 256 && sheetMeta.h === 256, 'horse.png is the vanilla 256x256 GUI-sheet padding, same as merchant/inventory');
  const px = blob.slice(base + sheetMeta.o, base + sheetMeta.o + sheetMeta.len);
  const alphaAt = (x, y) => px[(y * sheetMeta.w + x) * 4 + 3];
  const si = G.HORSE.saddleIcon, ai = G.HORSE.armourIcon;
  ok(alphaAt(si.u + (si.w >> 1), si.v + (si.h >> 1)) === 255, 'saddleIcon rect (u,v) lands on an opaque pixel, not the sheet\'s padding');
  ok(alphaAt(ai.u + (ai.w >> 1), ai.v + (ai.h >> 1)) === 255, 'armourIcon rect (u,v) lands on an opaque pixel too');
  okAv(alphaAt(255, 255) === 0, 'anti-vacuity: the sheet\'s own bottom-right CORNER is transparent padding — proves alpha=255 above is a real hit, not "everything reads opaque"');

  // open/close dispatch: Mnt.interact's own `opened: true` (the signal 15_hud.js's H.openHorse
  // now answers, wired this unit in 14l_use.js — a two-line hook, not this file's own module,
  // see the session summary) fires on sneak+tame and on horse-armour-in-hand+tame, both
  // directions against "just mounts instead".
  const Use = M.Use;
  const tame = mkHorse(); tame.tamed = true;
  const sneakRes = Mnt.interact(tame, '', { crouching: true });
  ok(sneakRes && sneakRes.opened === true && !sneakRes.mounted, 'sneak-use on a tame horse reports opened:true, not mounted');
  const armourRes = Mnt.interact(mkHorse(), 'golden_horse_armor', { crouching: false });
  ok(armourRes === null || armourRes.consumed === false, 'horse armour on an UNTAMED horse never opens (refuses instead)');
  const tame2 = mkHorse(); tame2.tamed = true;
  const armourRes2 = Mnt.interact(tame2, 'golden_horse_armor', { crouching: false });
  ok(armourRes2 && armourRes2.opened === true, 'horse armour in hand on a TAME horse also reports opened:true');
  okAv(Mnt.interact(mkHorse(), '', { crouching: false }).mounted === true, 'an EMPTY hand, NOT sneaking, on an untamed horse still mounts (opened:true is the sneak/armour-only branch, not the default)');
}

// ── §18. colour/marking VARIANTS — HorseColor x HorseMarking, rolled on spawn, inherited ─────
say('\n§18 — Mount.rollVariant/rollChildVariant: HorseEntity.initialize/createChild\'s OTHER half (QUEUE 0.2 G18e remainder)');
{
  const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

  // (a) the bit layout, both directions: encode then decode round-trips every corner, and two
  // different (color,marking) pairs never collide onto the same packed int.
  ok(Mnt.encodeVariant(0, 0) === 0, 'encodeVariant(0,0) === 0');
  ok(Mnt.encodeVariant(6, 4) === (6 | (4 << 8)), 'encodeVariant packs color low byte / marking next byte, HorseEntity.setVariant\'s own shift verbatim');
  const probe = { variant: Mnt.encodeVariant(5, 3) };
  ok(Mnt.horseColor(probe) === 5 && Mnt.horseMarking(probe) === 3, 'horseColor/horseMarking read back exactly what was packed');
  okAv(Mnt.encodeVariant(2, 1) !== Mnt.encodeVariant(1, 2), 'anti-vacuity: swapping color and marking produces a DIFFERENT packed int, not the same one');

  // (b) rollVariant: a fixed rand sequence pins an exact (color,marking) pair — nextInt(7) then
  // nextInt(5), this file's own floor(rand()*n) convention, HorseEntity.initialize verbatim.
  const pinned = Mnt.rollVariant(seq([2 / 7 + 0.01, 3 / 5 + 0.01]));
  ok(Mnt.horseColor({ variant: pinned }) === 2, 'rollVariant: color = floor(rand()*7), pinned to index 2');
  ok(Mnt.horseMarking({ variant: pinned }) === 3, 'rollVariant: marking = floor(rand()*5), pinned to index 3');
  // bounds, over many real-rng draws: every roll stays inside the enum's own [0,N) range, both ends
  let minC = Infinity, maxC = -Infinity, minM = Infinity, maxM = -Infinity;
  for (let i = 0; i < 2000; i++) {
    const v = Mnt.rollVariant(Math.random);
    const c = Mnt.horseColor({ variant: v }), m = Mnt.horseMarking({ variant: v });
    minC = Math.min(minC, c); maxC = Math.max(maxC, c); minM = Math.min(minM, m); maxM = Math.max(maxM, m);
  }
  ok(minC === 0 && maxC === 6, `colour stays inside HorseColor's own [0,6] over 2000 rolls (got [${minC},${maxC}])`);
  ok(minM === 0 && maxM === 4, `marking stays inside HorseMarking's own [0,4] over 2000 rolls (got [${minM},${maxM}])`);
  okAv(Mnt.rollVariant(() => 0) !== Mnt.rollVariant(() => 0.999999), 'two different rand sequences roll two DIFFERENT variants (reads rand, not a constant)');

  // (c) wired live: EL.spawn('horse', ...) itself rolls a variant (EL.DEFAULTS.horse's new hook,
  // 07i_entitylist.js) — not left undefined until something else sets it.
  const spawned = mkHorse();
  okAv(spawned.variant !== undefined, 'EL.spawn(\'horse\', ...) itself rolled e.variant through EL.DEFAULTS.horse');

  // (d) inheritance — HorseEntity.createChild's own 9-roll colour / 5-roll marking three-way
  // split (<4/<8/else, <2/<4/else), pinned exactly by a fixed sequence.
  const a = { variant: Mnt.encodeVariant(1, 0) };   // parent A: colour 1, marking 0
  const b = { variant: Mnt.encodeVariant(4, 2) };   // parent B: colour 4, marking 2
  const childLow = Mnt.rollChildVariant(a, b, seq([0.1, 0.1]));    // colourRoll<4 -> A, markRoll<2 -> A
  ok(Mnt.horseColor({ variant: childLow }) === 1 && Mnt.horseMarking({ variant: childLow }) === 0, 'low rolls (< 4/9, < 2/5): child takes PARENT A\'s colour and marking');
  const childMid = Mnt.rollChildVariant(a, b, seq([5 / 9 + 0.01, 3 / 5 + 0.01]));   // 4<=roll<8 -> B, 2<=roll<4 -> B
  ok(Mnt.horseColor({ variant: childMid }) === 4 && Mnt.horseMarking({ variant: childMid }) === 2, 'mid rolls (4-7/9, 2-3/5): child takes PARENT B\'s colour and marking');
  const childRand = Mnt.rollChildVariant(a, b, seq([8.5 / 9, 3 / 7 + 0.01, 4.5 / 5, 1 / 5 + 0.01]));   // roll>=8 -> fresh colour draw, roll>=4 -> fresh marking draw
  ok(Mnt.horseColor({ variant: childRand }) === 3 && Mnt.horseMarking({ variant: childRand }) === 1, 'high rolls (>= 8/9, >= 4/5): child gets a FRESH uniform roll, neither parent\'s');
  okAv(childLow !== childMid, 'anti-vacuity: a different rand sequence against the SAME parents produces a different child variant');

  // (e) wired live: a bred horse foal carries Breed.CHILD.horse's OWN roll, overwriting whatever
  // EL.spawn's own independent EL.DEFAULTS.horse roll already gave the freshly-created child.
  const p1 = mkHorse(40, 40); p1.tamed = true; p1.growAge = 0; Br.setInLove(p1, null); p1.variant = Mnt.encodeVariant(0, 0);
  const p2 = mkHorse(40.1, 40); p2.tamed = true; p2.growAge = 0; Br.setInLove(p2, null); p2.variant = Mnt.encodeVariant(6, 4);
  const foal2 = Br.breed(p1, p2, { random: Math.random });
  ok(!!foal2 && foal2.variant !== undefined, 'Breed.breed\'s foal carries a real e.variant (not undefined)');
  ok(Mnt.horseColor(foal2) >= 0 && Mnt.horseColor(foal2) <= 6 && Mnt.horseMarking(foal2) >= 0 && Mnt.horseMarking(foal2) <= 4,
    'and both halves of the foal\'s variant stay inside their own enum ranges (Breed.CHILD.horse\'s own roll, not left at EL.spawn\'s independent one)');
}

// donkey / mule (#4531): AbstractDonkeyEntity.getMountedHeightOffset = super - 0.25
for (const t of ['donkey', 'mule']) {
  ok(Math.abs(Mnt.mountedHeightOffset(EL.spawn(t, 60, PLAT_Y + 1, 60)) - (M.Entities.height(t) * 0.75 - 0.25)) < 1e-9, '#4531 ' + t + ' rider offset = height*0.75 - 0.25');
}

// skeleton_horse / zombie_horse (#856): tame -> saddle opens the screen/mount ok; untamed -> PASS, no anger
{
  for (const t of ['skeleton_horse', 'zombie_horse']) {
    const h = EL.spawn(t, 60, PLAT_Y + 1, 60);
    ok(Mnt.isMountable(h), t + ' is Mnt-mountable');
    h.tamed = false;
    ok(Mnt.interact(h, '', {}) === null && !h.rider && !h.angry && !h.angryTicks, t + ' untamed: PASS, no mount, no angry');
    ok(Mnt.interact(h, Mnt.SADDLE_ITEM, {}) === null && !h.saddled, t + ' untamed + saddle: PASS');
    h.tamed = true;
    const rs = Mnt.interact(h, Mnt.SADDLE_ITEM, {});
    ok(rs && rs.opened && !h.saddled, t + ' tame + saddle item opens the inventory');
    ok(Mnt.trySaddleItem(h) && h.saddled, t + ' tame saddle item saddles (useOnEntity)');
    const rm = Mnt.interact(h, '', {});
    ok(rm && rm.mounted && h.rider === 'player', t + ' tame empty hand mounts');
    if (t === 'skeleton_horse') {
      const hh = M.Entities.height(t) * 0.75;
      ok(Math.abs(Mnt.mountedHeightOffset(h) - (hh - 0.1875)) < 1e-9, '#4228 skeleton_horse rider offset = height*0.75 - 0.1875');
      ok(Math.abs(Mnt.mountedHeightOffset(EL.spawn('horse', 70, PLAT_Y + 1, 60)) - M.Entities.height('horse') * 0.75) < 1e-9, '#4228 plain horse keeps height*0.75');
    }
    const h2 = EL.spawn(t, 62, PLAT_Y + 1, 60); h2.tamed = true;
    const rc = Mnt.interact(h2, '', { crouching: true });
    ok(rc && rc.opened && !h2.rider, t + ' tame sneak opens inventory');
    // tamed baby -> super.interactMob (feeding), not a bare refusal
    const hb = EL.spawn(t, 66, PLAT_Y + 1, 60); hb.tamed = true; Br.setBaby(hb, true);
    const rb = Mnt.interact(hb, 'wheat', {});
    ok(rb && rb.consumed && !rb.mounted, t + ' tame baby + wheat runs the base feed path');
    const hr = EL.spawn(t, 68, PLAT_Y + 1, 60); hr.tamed = true; Mnt.mount(hr);
    const rr = Mnt.interact(hr, 'wheat', {});
    ok(rr && !rr.mounted && !rr.opened, t + ' ridden: base path, no second mount');
    // anti-vacuity: with the undead branch bypassed the untamed horse would be mounted
    const h3 = EL.spawn(t, 64, PLAT_Y + 1, 60); h3.tamed = false;
    Mnt.mount(h3);
    okAv(h3.rider === 'player', 'anti-vacuity: an untamed ' + t + ' is mounted when the PASS gate is skipped');
  }
}

// #3578: HorseBaseEntity.getHurtSound (1/3) / getAmbientSound (1/10, !immobile) call updateAnger
{
  const MVo = M.MobVoice, N = 3000;
  const rate = (role, pre) => { let n = 0; for (let i = 0; i < N; i++) { const h = EL.spawn('mule', 64, PLAT_Y + 1, 60); if (pre) pre(h); MVo.pick(h, role); if (h.angry) n++; } return n / N; };
  const hr = rate('hurt'), ar = rate('ambient');
  ok(Math.abs(hr - 1 / 3) < 0.05, '#3578 mule hurt sets angry ~1/3 (got ' + hr + ')');
  ok(Math.abs(ar - 0.1) < 0.03, '#3578 mule ambient sets angry ~1/10 (got ' + ar + ')');
  ok(rate('ambient', h => { h.eatingGrass = true; }) === 0, '#3578 immobile mule ambient never rolls updateAnger');
  ok(rate('death') === 0, '#3578 death sound never angers');
  okAv(hr > 0.2, 'anti-vacuity: hurt rate is nonzero (' + hr + ')');
  okAv(rate('hurt', h => { h.type = 'cow'; }) === 0, 'anti-vacuity: non-horse hurt never angers');
}

// #4522: updateAnger restarts the angry timer even when already angry
{
  const h = EL.spawn('donkey', 64, PLAT_Y + 1, 60); h.angry = true; h.angryTicks = 15; M.Mount.updateAnger(h);
  ok(h.angryTicks === 1, '#4522 updateAnger on an angry donkey resets angryTicks to 1 (got ' + h.angryTicks + ')');
  okAv(h.angry === true, 'anti-vacuity: donkey stays angry');
}

const __dirname_mc = new URL('.', import.meta.url).pathname;
// #3576: playAngrySound plays entity.<type>.angry once (only when not already angry)
{
  const mst = {};
  for (const l of readFileSync(join(__dirname_mc, 'golden/mob-sounds-1.18.2.tsv'), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); mst[c[0]] = c.slice(2); }
  M.DATA = Object.assign({}, M.DATA, { mobSounds: mst });
  const played = []; M.Sound = { play: (ev) => { played.push(ev); return true; } };
  for (const t of ['horse', 'donkey', 'mule']) {
    const h = EL.spawn(t, 66, PLAT_Y + 1, 60); played.length = 0;
    Mnt.playAngrySound(h); Mnt.playAngrySound(h);
    ok(played.length === 1 && played[0] === 'entity.' + t + '.angry', t + ' playAngrySound emits entity.' + t + '.angry once: ' + played);
  }
  const h = EL.spawn('mule', 68, PLAT_Y + 1, 60); played.length = 0; const pa = M.MobVoice.playAngry; M.MobVoice.playAngry = () => false;
  Mnt.playAngrySound(h); M.MobVoice.playAngry = pa;
  okAv(played.length === 0, 'anti-vacuity: without MobVoice.playAngry the mule is silent');
}
// #5254: jump / armour / chest sounds, logged at the Sound.play seam
{
  const log = []; M.Sound = { play: (ev, o) => { log.push([ev, o.volume, o.pitch]); return true; } };
  const h = EL.spawn('horse', 70, PLAT_Y + 1, 60); h.saddled = true; log.length = 0;
  Mnt.startJumping(h);
  ok(log.length === 1 && log[0][0] === 'entity.horse.jump' && log[0][1] === 0.4 && log[0][2] === 1, 'startJumping logs entity.horse.jump 0.4/1.0: ' + JSON.stringify(log));
  h.ticksAlive = 30; log.length = 0; Mnt.equipArmor(h, 'iron_horse_armor');
  ok(log.length === 1 && log[0][0] === 'entity.horse.armor' && log[0][1] === 0.5 && log[0][2] === 1, 'equipping iron_horse_armor logs entity.horse.armor 0.5/1.0: ' + JSON.stringify(log));
  log.length = 0; Mnt.equipArmor(h, 'iron_horse_armor'); Mnt.equipArmor(h, null);
  ok(log.length === 0, 'same armour again / removal is silent');
  const d = EL.spawn('donkey', 72, PLAT_Y + 1, 60); log.length = 0; Mnt.addChest(d);
  ok(log.length === 1 && log[0][0] === 'entity.donkey.chest' && log[0][1] === 1, 'chest on a donkey logs entity.donkey.chest 1.0: ' + JSON.stringify(log));
  const b = EL.spawn('horse', 74, PLAT_Y + 1, 60); b.ticksAlive = 30; log.length = 0; b.silent = true; Mnt.equipArmor(b, 'iron_horse_armor');
  okAv(log.length === 0, 'anti-vacuity: a silent horse logs no armour sound');
  const y = EL.spawn('horse', 76, PLAT_Y + 1, 60); y.ticksAlive = 5; log.length = 0; Mnt.equipArmor(y, 'iron_horse_armor');
  okAv(log.length === 0, 'anti-vacuity: age <= 20 logs no armour sound');
}

// #3934: rider swings back while the horse rears (HorseBaseEntity.updatePassengerPosition)
{
  const h = EL.spawn('horse', 70, PLAT_Y + 1, 60); h.yBodyRot = 0.6; h.lastAngryAnim = 1;
  const o = Mnt.riderOffset(h);
  ok(Math.abs(o.x - 0.7 * Math.sin(0.6)) < 1e-9 && Math.abs(o.z + 0.7 * Math.cos(0.6)) < 1e-9 && Math.abs(o.y - 0.15) < 1e-9, '#3934 rider offset at angryAnim=1: ' + JSON.stringify(o));
  h.lastAngryAnim = 0; const z = Mnt.riderOffset(h);
  okAv(z.x === 0 && z.y === 0 && z.z === 0, 'anti-vacuity: no rearing, no offset');
  okAv(Math.abs(o.y) > 0.1, 'anti-vacuity: rearing offset is nonzero');
}

// #4104: a spawn group shares one HorseData colour and rolls the 5% baby for members after the first
{
  const Br = M.Breed || globalThis.NS?.Breed;
  const spawnPack = (n, share) => { const pd = {}; const out = [];
    for (let i = 0; i < n; i++) out.push(EL.spawn('horse', 72 + i, PLAT_Y + 1, 60, { spawnIdx: i, packData: share ? pd : {} })); return out; };
  let mixed = 0, babies = 0, members = 0, firstBaby = 0;
  for (let k = 0; k < 60; k++) {
    const pk = spawnPack(6, true);
    if (new Set(pk.map(h => Mnt.horseColor(h))).size > 1) mixed++;
    if (Br && Br.isBaby(pk[0])) firstBaby++;
    for (let i = 1; i < pk.length; i++) { members++; if (Br && Br.isBaby(pk[i])) babies++; }
    pk.forEach(h => h.removed = true);
  }
  ok(mixed === 0, '#4104 every pack shares one colour, mixed packs: ' + mixed);
  ok(firstBaby === 0, '#4104 first member is never a pack-roll baby');
  ok(babies > 0 && babies < members * 0.2, '#4104 ~5% of non-first members are foals: ' + babies + '/' + members);
  const unshared = []; for (let k = 0; k < 30; k++) for (const h of spawnPack(6, false)) unshared.push(Mnt.horseColor(h));
  okAv(new Set(unshared).size > 1 && true, 'anti-vacuity: without a shared packData colours do vary');
}

console.log(`\n${pass} assertions passed, ${breaks} anti-vacuity break${breaks === 1 ? '' : 's'} proven catchable, ${fails.length} failed`);
console.log(`   ${pass} assertions · ${breaks} breaks caught · ${fails.length} failures`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('mountcheck: PASS');
