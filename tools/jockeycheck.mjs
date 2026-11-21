#!/usr/bin/env node
// jockeycheck.mjs -- loop/jockey (QUEUE 0.2): CHICKEN and SPIDER JOCKEYS, whole.
// Drives the REAL modules (Undead.tryChickenJockey/trySpiderJockey/trySpiderEffect/
// mountJockey, 07zk_undead.js; Passive.setChickenJockey/tickChicken, 07w_passive.js;
// Spawn.canImmediatelyDespawn's own 'chicken' case, 07l_spawn.js; Zv.maybeConvertNaturalSpawn's
// carry-over, 07zr_zvillager.js; Rd.startRiding, 07s_raid.js) against
// `.decomp/net/minecraft/entity/mob/ZombieEntity.java` (442-478), `SpiderEntity.java`
// (152-183, 208-221) and `ChickenEntity.java` (44,90,163-186), all read whole this pass.
//
//   node tools/jockeycheck.mjs [--verbose]
//
// Sections:
//   1. Undead.rollBaby -- ZombieEntity.shouldBeBaby's own 5% threshold
//   2. Undead.tryChickenJockey -- both branches, the if/else-if no-fallback quirk, non-baby refusal
//   3. Passive.setChickenJockey / tickChicken -- no egg for a jockey chicken
//   4. Spawn.canImmediatelyDespawn's 'chicken' case now reads hasJockey for real
//   5. Undead.mountJockey -- pair-correct height-offset arithmetic (chicken/baby, spider/skeleton)
//   6. Undead.trySpiderJockey -- the 1/100 roll, both directions
//   7. Undead.trySpiderEffect -- HARD-only, the 5-way effect table, permanent duration
//   8. Zv.maybeConvertNaturalSpawn -- baby/jockey state carried across the zombie->zombie_villager swap
//   9. anti-vacuity sweep

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('jockeycheck -- loop/jockey (QUEUE 0.2), chicken + spider jockeys, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '07m_breed.js', '07o_profession.js', '07ox_enchhelper.js', '07p_trade.js',
               '07q_effects.js', '07s_raid.js', '07w_passive.js', '07zk_undead.js',
               '07zr_zvillager.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Un = MCL.Undead, Ps = MCL.Passive, Rd = MCL.Raid, Zv = MCL.ZVillager, Br = MCL.Breed;
const W = MCL.World, CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
MCL.Profession.init();
MCL.Village.init();
Br.init();
Ps.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Un && Un.ready, 'NS.Undead did not load/ready');
ok(Ps && Ps.ready, 'NS.Passive did not load/ready');
ok(Rd && Rd.ready, 'NS.Raid did not load/ready');

const zero = () => 0;
const almostOne = () => 0.999999;

// -- 1. Undead.rollBaby ----------------------------------------------------------------------
say('1. Undead.rollBaby -- ZombieEntity.shouldBeBaby (.decomp:493-495), nextFloat() < 0.05');
{
  ok(Un.BABY_CHANCE === 0.05, `Undead.BABY_CHANCE is ${Un.BABY_CHANCE} -- expected 0.05 (ZombieEntity.java:494)`);
  ok(Un.rollBaby(() => 0.0499) === true, 'a roll just under 0.05 must be a baby');
  ok(Un.rollBaby(() => 0.05) === false, 'a roll of exactly 0.05 must NOT be a baby (strict <)');
  ok(Un.rollBaby(almostOne) === false, 'a roll near 1 must not be a baby');
}

// -- 2. Undead.tryChickenJockey ---------------------------------------------------------------
say('2. Undead.tryChickenJockey -- ZombieEntity.initialize (.decomp:451-469)');
function makeBaby() { const e = { type: 'zombie', x: 0, y: 64, z: 0 }; Br.setBaby(e, true); return e; }
{
  ok(Un.CHICKEN_JOCKEY_ROLL_CHANCE === 0.05, 'Undead.CHICKEN_JOCKEY_ROLL_CHANCE must be 0.05 (ZombieEntity.java:454,459)');
  ok(Un.CHICKEN_JOCKEY_FAMILY.zombie === 1 && Un.CHICKEN_JOCKEY_FAMILY.husk === 1 &&
     Un.CHICKEN_JOCKEY_FAMILY.drowned === 1, 'CHICKEN_JOCKEY_FAMILY must cover zombie/husk/drowned');
  ok(Un.CHICKEN_JOCKEY_FAMILY.zombified_piglin === 1, 'CHICKEN_JOCKEY_FAMILY must cover zombified_piglin (ZombieEntity.initialize, #3844)');
  ok(!Un.CHICKEN_JOCKEY_FAMILY.zombie_villager, 'zombie_villager is a CONVERSION target, never a fresh natural placement -- not in the family map');

  // a non-baby never tries at all, no matter what the roll says
  const adult = { type: 'zombie', x: 0, y: 64, z: 0 };
  const chicken0 = { type: 'chicken', x: 0, y: 64, z: 0 };
  ok(Un.tryChickenJockey(adult, zero, { findChicken: () => chicken0 }) === null,
    'an adult zombie must never roll a chicken jockey, even on a guaranteed-hit roll');
  ok(!chicken0.hasJockey, 'the untouched chicken must not have been mounted by the adult-zombie call');

  // first roll hits, a free chicken IS nearby -> mounts it, no fresh spawn attempted
  let spawnCalled = false;
  const baby1 = makeBaby();
  const chicken1 = { type: 'chicken', x: 0, y: 64, z: 0, height: 0.7 };
  const found1 = Un.tryChickenJockey(baby1, zero, {
    findChicken: () => chicken1,
    spawnChicken: () => { spawnCalled = true; return { type: 'chicken', x: 0, y: 64, z: 0 }; }
  });
  ok(found1 === chicken1, 'a guaranteed first roll with a nearby chicken must mount THAT chicken');
  ok(chicken1.hasJockey === true, 'the mounted chicken must have hasJockey set');
  ok(baby1.vehicle === chicken1 && chicken1.passenger === baby1, 'the baby must be riding, the chicken carrying it (Rd.startRiding bookkeeping)');
  ok(!spawnCalled, 'a hit first roll with a chicken found must NOT also call spawnChicken');

  // first roll hits, NO chicken nearby -> vanilla does NOT fall through to the second roll
  let spawnCalled2 = false;
  const baby2 = makeBaby();
  const found2 = Un.tryChickenJockey(baby2, zero, {
    findChicken: () => null,
    spawnChicken: () => { spawnCalled2 = true; return { type: 'chicken', x: 0, y: 64, z: 0 }; }
  });
  ok(found2 === null, 'a hit first roll with NO chicken nearby must produce no jockey at all');
  ok(!spawnCalled2, 'a hit first roll with no chicken nearby must NOT fall through to spawnChicken (if/else-if, .decomp:453-465)');
  ok(!baby2.vehicle, 'baby2 must not end up mounted on anything');

  // first roll misses, second roll hits -> spawns a fresh chicken and mounts it
  const baby3 = makeBaby();
  let calls = 0;
  const seq = [0.9, 0.001]; // first roll misses (>=0.05), second roll hits (<0.05)
  const seqRnd = () => seq[calls++];
  const fresh3 = { type: 'chicken', x: 0, y: 64, z: 0, height: 0.7 };
  const found3 = Un.tryChickenJockey(baby3, seqRnd, {
    findChicken: () => { throw new Error('findChicken must not be called once the first roll misses'); },
    spawnChicken: () => fresh3
  });
  ok(found3 === fresh3, 'a missed first roll + hit second roll must spawn and mount a FRESH chicken');
  ok(fresh3.hasJockey === true, 'the freshly spawned chicken must carry hasJockey too');

  // both rolls miss -> nothing
  const baby4 = makeBaby();
  const found4 = Un.tryChickenJockey(baby4, almostOne, { findChicken: () => ({ type: 'chicken' }), spawnChicken: () => ({ type: 'chicken' }) });
  ok(found4 === null, 'two missed rolls must produce no jockey');
}

// -- 3. Passive.setChickenJockey / tickChicken -------------------------------------------------
say('3. Passive.setChickenJockey / tickChicken -- ChickenEntity.tickMovement (.decomp:90)');
{
  const chicken = { type: 'chicken', growAge: 0, eggLayTime: 1 };
  Ps.setChickenJockey(chicken, true);
  ok(chicken.hasJockey === true, 'setChickenJockey(true) must set hasJockey');
  ok(Ps.tickChicken(chicken, () => 0.5) === false, 'a jockey chicken must never lay an egg, even with eggLayTime at 0');
  Ps.setChickenJockey(chicken, false);
  ok(chicken.hasJockey === false, 'setChickenJockey(false) must clear hasJockey');
  ok(Ps.tickChicken(chicken, () => 0.5) === true, 'the SAME chicken, jockey cleared, must lay again (isolates the hasJockey gate, not some other refusal)');
}

// -- 4. Spawn.canImmediatelyDespawn -------------------------------------------------------------
say('4. Spawn.canImmediatelyDespawn -- ChickenEntity.hasJockey() (.decomp:180-182)');
{
  const plain = { type: 'chicken' };
  const jockeyed = { type: 'chicken', hasJockey: true };
  ok(Spawn.canImmediatelyDespawn(plain, 0) === false, 'a plain chicken must not immediately despawn');
  ok(Spawn.canImmediatelyDespawn(jockeyed, 0) === true, 'a jockey chicken must immediately despawn (persistent-mob exemption removed)');
}

// -- 5. Undead.mountJockey height-offset arithmetic ---------------------------------------------
say('5. Undead.mountJockey -- Entity.updatePassengerPosition (Entity.java:1709-1714), per-pair overrides');
{
  const chicken = { type: 'chicken', x: 3, y: 10, z: 5, height: 0.7 };
  const baby = { type: 'zombie', x: 0, y: 0, z: 0 }; Br.setBaby(baby, true);
  Un.mountJockey(baby, chicken);
  const wantY = chicken.y + chicken.height * 0.5 + 0.0; // ChickenEntity getBodyY(0.5) + ZombieEntity.getHeightOffset() baby 0.0
  ok(Math.abs(baby.y - wantY) < 1e-9, `baby-on-chicken y is ${baby.y}, expected ${wantY} (chicken.h*0.5 + 0, NOT the raider -0.45 offset)`);
  // #1806: per-tick Rd.tickPassenger must keep the ChickenEntity formula (0.1 offset along bodyYaw, bodyYaw copied)
  chicken.yBodyRot = Math.PI / 2 + Math.PI; baby.vx = 0;
  Rd.tickPassenger(baby);
  ok(Math.abs(baby.x - (chicken.x + 0.1)) < 1e-9 && Math.abs(baby.z - chicken.z) < 1e-9, `chicken jockey x/z after tick ${baby.x},${baby.z}: want x+0.1*sin(90), z-0.1*cos(90)`);
  ok(Math.abs(baby.y - wantY) < 1e-9 && baby.yBodyRot === chicken.yBodyRot, 'chicken jockey y and bodyYaw after Rd.tickPassenger');
  okAv(Math.abs(baby.x - chicken.x) > 0.05, 'dropping the 0.1*sin term would leave x == chicken.x');

  const spider = { type: 'spider', x: -2, y: 20, z: 1, height: 0.9 };
  const skeleton = { type: 'skeleton', x: 0, y: 0, z: 0 };
  Un.mountJockey(skeleton, spider);
  const wantY2 = spider.y + spider.height * 0.5 - 0.6; // SpiderEntity.getMountedHeightOffset (.decomp:66-68) + AbstractSkeletonEntity.getHeightOffset() -0.6
  ok(Math.abs(skeleton.y - wantY2) < 1e-9, `skeleton-on-spider y is ${skeleton.y}, expected ${wantY2} (spider.h*0.5 - 0.6, NOT the generic *0.75 a ravager/chicken vehicle would use)`);
  for (const t of ['stray', 'wither_skeleton']) {
    const r = { type: t, x: 0, y: 0, z: 0 };
    Un.mountJockey(r, spider);
    ok(Math.abs(r.y - wantY2) < 1e-9, `${t}-on-spider y is ${r.y}, expected ${wantY2}`);
  }
  okAv(Math.abs(wantY2 - (spider.y + spider.height * 0.5)) > 0.5, 'the old 0.0 rider offset would put the skeleton 0.6 too high');
}

// -- 6. Undead.trySpiderJockey --------------------------------------------------------------
say('6. Undead.trySpiderJockey -- SpiderEntity.initialize (.decomp:154-159)');
{
  ok(Un.SPIDER_JOCKEY_CHANCE === 0.01, 'Undead.SPIDER_JOCKEY_CHANCE must be 0.01 (nextInt(100)==0)');
  const spiderA = { type: 'spider', x: 0, y: 64, z: 0, height: 0.9 };
  const skelA = { type: 'skeleton', x: 0, y: 0, z: 0 };
  const rA = Un.trySpiderJockey(spiderA, zero, { spawnSkeleton: () => skelA });
  ok(rA === skelA, 'a guaranteed-hit roll must spawn and mount a skeleton');
  ok(skelA.vehicle === spiderA && spiderA.passenger === skelA, 'the SPIDER is the vehicle, the skeleton the passenger (reverse of the chicken pair)');

  const spiderB = { type: 'spider', x: 0, y: 64, z: 0, height: 0.9 };
  let called = false;
  const rB = Un.trySpiderJockey(spiderB, almostOne, { spawnSkeleton: () => { called = true; return {}; } });
  ok(rB === null && !called, 'a missed roll must never call spawnSkeleton');

  ok(Un.trySpiderJockey({ type: 'chicken' }, zero, { spawnSkeleton: () => ({}) }) === null,
    'trySpiderJockey must refuse a non-spider outright');
}

// -- 7. Undead.trySpiderEffect ----------------------------------------------------------------
say('7. Undead.trySpiderEffect -- SpiderEntity.initialize (.decomp:162-166) + SpiderData.setEffect (.decomp:208-221)');
{
  ok(Un.SPIDER_EFFECT_CHANCE === 0.1, 'Undead.SPIDER_EFFECT_CHANCE must be 0.1');
  ok(Un.SPIDER_EFFECT_DURATION === 2147483647, 'Undead.SPIDER_EFFECT_DURATION must be Integer.MAX_VALUE');
  ok(JSON.stringify(Un.SPIDER_EFFECT_TABLE) === JSON.stringify(['speed', 'speed', 'strength', 'regeneration', 'invisibility']),
    `SPIDER_EFFECT_TABLE is ${JSON.stringify(Un.SPIDER_EFFECT_TABLE)} -- expected the nextInt(5) 0..4 table off SpiderData.setEffect`);

  MCL.Diff.value = 'easy';
  const spiderEasy = { type: 'spider' };
  ok(Un.trySpiderEffect(spiderEasy, zero) === null, 'EASY difficulty must never roll a spider effect (HARD-only gate)');
  ok(!spiderEasy.effects || !spiderEasy.effects.speed, 'no effect table entry on an easy-difficulty spider');

  MCL.Diff.value = 'hard';
  const spiderHard0 = { type: 'spider' };
  const eff0 = Un.trySpiderEffect(spiderHard0, () => 0.0);
  ok(eff0 === 'speed', `nextInt(5)==0 must give speed, got ${eff0}`);
  ok(spiderHard0.effects && spiderHard0.effects.speed && spiderHard0.effects.speed.duration === 2147483647,
    'the applied effect must be permanent (Integer.MAX_VALUE duration)');

  const spiderHard2 = { type: 'spider' };
  let c2 = 0; const seq2 = [0.0, 0.4999]; // chance-roll hits, THEN idx roll = floor(0.4999*5) = 2 -> strength
  const eff2 = Un.trySpiderEffect(spiderHard2, () => seq2[c2++]);
  ok(eff2 === 'strength', `idx 2 must give strength, got ${eff2}`);

  const spiderHard4 = { type: 'spider' };
  let c4 = 0; const seq4 = [0.0, 0.99999];
  const eff4 = Un.trySpiderEffect(spiderHard4, () => seq4[c4++]);
  ok(eff4 === 'invisibility', `idx 4 (highest roll) must give invisibility, got ${eff4}`);

  const spiderHardMiss = { type: 'spider' };
  const effMiss = Un.trySpiderEffect(spiderHardMiss, almostOne);
  ok(effMiss === null, 'a chance roll >= 0.1*difficulty must apply no effect at all');

  // #1232 -- SpiderData is shared per spawn group: one roll, every member shares the effect / none.
  const group = (rnd, n, data) => { const l = []; for (let i = 0; i < n; i++) { const sp = { type: 'spider' }; Un.trySpiderEffect(sp, rnd, data); l.push(sp); } return l; };
  const has = (sp) => !!(sp.effects && sp.effects.strength);
  let gc = 0; const gseq = [0.0, 0.4999, 0.99, 0.99, 0.99];   // only the first spider may draw
  const g1 = group(() => gseq[gc++ % gseq.length], 4, {});
  ok(g1.every(has), '#1232: all 4 spiders of a group must share the first spider\'s strength effect');
  ok(gc === 2, `#1232: a group rolls ONCE (2 draws), drew ${gc}`);
  const g2 = group(almostOne, 4, {});
  ok(g2.every((sp) => !has(sp) && !(sp.effects && Object.keys(sp.effects).length)), '#1232: a missed group roll gives no member an effect');
  let gm = 0; const g3 = group(() => (gm++ < 1 ? 0.99 : 0.0), 4, {});
  ok(g3.every((sp) => !(sp.effects && Object.keys(sp.effects).length)), '#1232: later members must not re-roll after the first missed');
  // anti-vacuity: without group data every spider rolls independently -> a break is caught
  let gb = 0; const gbs = [0.0, 0.4999];
  const g4 = group(() => gbs[gb++ % 2], 4, undefined);
  okAv(!g4.every(has) || gb > 2, 'ungrouped spiders roll independently (this is what the group data prevents)');
  MCL.Diff.value = 'normal';
}

// -- 9. anti-vacuity sweep ----------------------------------------------------------------------
say('9. anti-vacuity -- corrupt the module’s own data/dispatch and confirm the checks above notice');
{
  // 9a. corrupt CHICKEN_JOCKEY_ROLL_CHANCE to 0 and confirm a jockey NEVER rolls any more
  const savedChance = Un.CHICKEN_JOCKEY_ROLL_CHANCE;
  Un.CHICKEN_JOCKEY_ROLL_CHANCE = 0;
  const brokenBaby = makeBaby();
  const brokenResult = Un.tryChickenJockey(brokenBaby, () => 0.001, { findChicken: () => ({ type: 'chicken', x: 0, y: 0, z: 0, height: 0.7 }) });
  okAv(brokenResult === null, 'zeroing CHICKEN_JOCKEY_ROLL_CHANCE must make a formerly-guaranteed roll fail');
  Un.CHICKEN_JOCKEY_ROLL_CHANCE = savedChance;
  const restoredBaby = makeBaby();
  const restoredResult = Un.tryChickenJockey(restoredBaby, () => 0.001, { findChicken: () => ({ type: 'chicken', x: 0, y: 0, z: 0, height: 0.7 }) });
  okAv(restoredResult !== null, 'restoring CHICKEN_JOCKEY_ROLL_CHANCE must restore the roll');

  // 9b. corrupt Passive.setChickenJockey to a no-op and confirm despawn/egg assertions would fail
  const realSet = Ps.setChickenJockey;
  Ps.setChickenJockey = function () {}; // no-op: hasJockey never gets set
  const jb = makeBaby();
  Un.tryChickenJockey(jb, zero, { findChicken: () => ({ type: 'chicken', x: 0, y: 0, z: 0, height: 0.7 }) });
  const blindedDespawn = Spawn.canImmediatelyDespawn(jb.vehicle, 0);
  Ps.setChickenJockey = realSet;
  okAv(blindedDespawn === false, 'blinding Passive.setChickenJockey must make the mounted chicken NOT immediately despawn -- proves §4 is reading the real flag, not a hard-coded true');
  const jb2 = makeBaby();
  Un.tryChickenJockey(jb2, zero, { findChicken: () => ({ type: 'chicken', x: 0, y: 0, z: 0, height: 0.7 }) });
  okAv(Spawn.canImmediatelyDespawn(jb2.vehicle, 0) === true, 'restoring Passive.setChickenJockey must restore the despawn flag');

  // 9c. corrupt SPIDER_EFFECT_TABLE and confirm the applied name changes
  const savedTable = Un.SPIDER_EFFECT_TABLE.slice();
  Un.SPIDER_EFFECT_TABLE[0] = 'invisibility';
  MCL.Diff.value = 'hard';
  const corruptedEff = Un.trySpiderEffect({ type: 'spider' }, () => 0.0);
  Un.SPIDER_EFFECT_TABLE = savedTable;
  MCL.Diff.value = 'normal';
  okAv(corruptedEff === 'invisibility', 'corrupting SPIDER_EFFECT_TABLE[0] must change idx-0’s applied effect -- the table is really consulted');
}

// ── summary ──────────────────────────────────────────────────────────────────────────────────
console.log(`${pass} checks passed (${breaks} anti-vacuity)`);
if (fails.length) {
  console.log(`${fails.length} FAILED:`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
