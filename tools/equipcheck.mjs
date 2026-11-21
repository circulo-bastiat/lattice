#!/usr/bin/env node
// equipcheck.mjs — QUEUE 0.2 (G18 mobs remainder, D-517): MOB EQUIPMENT SLOTS. Proves
// `NS.Equip` (src/07y_equip.js) — the mainhand/offhand/head/chest/legs/feet store, the fixed
// skeleton/vindicator/pillager WEAPON (`.decomp` `initEquipment` overrides), the base
// difficulty-scaled ARMOUR ROLL every `MobEntity` inherits (`.decomp` MobEntity.java:871-906),
// drop chances (`MobEntity.dropEquipment`), and the daylight-burn HELMET branch
// (`ZombieEntity.tickMovement:227-241`) — against LIVE `EL.spawn`'d mobs run through the real
// `EL.DEFAULTS` hook (D-517's own wiring in 07i_entitylist.js) and the real `Cb.tickDaylightBurn`
// (14j_combat.js), not a rewritten copy of either.
//
//   node tools/equipcheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('equipcheck — QUEUE 0.2 G18 mobs remainder: MOB EQUIPMENT SLOTS');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07h_entities.js', '09b_sky.js',
          '14b_physics.js', '07y_equip.js', '07i_entitylist.js', '07l_spawn.js', '14i_hand.js',
          '14j_combat.js', '14d_survival.js']
});
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init();
M.EntityList.init();
M.Equip.init();
M.Hand.init();
M.Combat.init();

const Eq = M.Equip, IT = M.Items, EL = M.EntityList, Cb = M.Combat, Diff = M.Diff, CH = M.CH, W = M.World, Ent = M.Entities;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');

ok(M.Entities.ready, 'entity table loaded');
ok(Eq.ready, 'Equip module reports ready');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 60, z, STONE);
}

say('\n1. every armour tier name and the three fixed weapons resolve to a real item');
{
  const slots = ['HEAD', 'CHEST', 'LEGS', 'FEET'];
  let allResolve = true;
  for (const s of slots) for (const name of Eq.ARMOR_TABLE[s]) {
    if (!(IT.of(name) >= 0)) { allResolve = false; say('   missing item: ' + name); }
  }
  ok(allResolve, 'all 20 ARMOR_TABLE item names resolve through NS.Items.of');
  ok(IT.of('bow') >= 0 && IT.of('iron_axe') >= 0 && IT.of('crossbow') >= 0, 'bow/iron_axe/crossbow resolve');
  okAv(Eq.stackOf('totally_bogus_item_xyz') === null, 'Eq.stackOf refuses an unknown item name — the guard is real, not a pass-through');
}
say(`   ${pass} ok`);

say('\n2. storage: getEquipped/setEquipped round-trip, independent per slot');
{
  const e = { type: 'zombie' };
  ok(Eq.getEquipped(e, IT.HEAD) === null, 'an unequipped slot reads null');
  const st = Eq.stackOf('iron_helmet');
  Eq.setEquipped(e, IT.HEAD, st);
  ok(Eq.getEquipped(e, IT.HEAD) === st, 'HEAD now holds the stack just set');
  ok(Eq.getEquipped(e, IT.CHEST) === null, 'CHEST is untouched by the HEAD write — slots are independent');
  Eq.setEquipped(e, IT.HEAD, null);
  ok(Eq.getEquipped(e, IT.HEAD) === null, 'clearing a slot reads back null again');
}
say(`   ${pass} ok`);

say('\n3. the fixed weapon: skeleton/vindicator/pillager, LIVE through EL.spawn -> EL.DEFAULTS -> Eq.initMob');
{
  freshWorld();
  Diff.set('peaceful');   // gate the armour roll off so only the weapon is under test here
  const sk = EL.spawn('skeleton', 0.5, 61, 0.5);
  const vi = EL.spawn('vindicator', 2.5, 61, 0.5);
  const pi = EL.spawn('pillager', 4.5, 61, 0.5);
  const zo = EL.spawn('zombie', 6.5, 61, 0.5);
  ok(!!sk && !!vi && !!pi && !!zo, 'all four spawn');
  ok(sk && IT.nameOf(Eq.getEquipped(sk, IT.MAINHAND).i) === 'bow', 'a live skeleton is holding a bow');
  ok(vi && IT.nameOf(Eq.getEquipped(vi, IT.MAINHAND).i) === 'iron_axe', 'a live vindicator is holding an iron_axe');
  ok(pi && IT.nameOf(Eq.getEquipped(pi, IT.MAINHAND).i) === 'crossbow', 'a live pillager is holding a crossbow');
  okAv(zo && (m => m === null || ['iron_sword', 'iron_shovel'].includes(IT.nameOf(m.i)))(Eq.getEquipped(zo, IT.MAINHAND)), 'a live zombie gets NO mainhand weapon (ZombieEntity.initEquipment has none) — the table does not over-grant');

  // anti-vacuity, the other direction: initWeapon must never CLOBBER a slot that already holds
  // something (vanilla's own `if (!$$1.isEmpty()) return;`-shaped early-out inside equipStack's
  // caller) — re-running it on the same skeleton with a planted fake stack must not overwrite it.
  const fake = Eq.stackOf('diamond_sword');
  Eq.setEquipped(sk, IT.MAINHAND, fake);
  Eq.initWeapon(sk);
  okAv(Eq.getEquipped(sk, IT.MAINHAND) === fake, 'initWeapon refuses to overwrite an already-equipped mainhand — re-running spawn twice cannot duplicate/replace gear');
}
say(`   ${pass} ok`);

// ── LocalDifficulty itself (07y_equip.js Eq.localDifficulty / clampedLocalDifficulty) ────────
// Referee (infra I6, real 1.18.2 server): at world time 0 the clamped value is 0 on easy/normal
// and 0.125 on hard; the rest follow LocalDifficulty.java's own formula at its end points.
say('\n3b. LocalDifficulty (ServerWorld.getLocalDifficulty inputs: difficulty, day time, moon)');
{
  const cld = (difficulty, time, inhabited) => Eq.clampedLocalDifficulty({ difficulty, time, inhabited });
  ok(cld('easy', 0) === 0 && cld('normal', 0) === 0, `time 0: easy/normal clamp to 0 (raw 0.75/1.5) — got ${cld('easy', 0)}/${cld('normal', 0)}`);
  ok(Math.abs(cld('hard', 0) - 0.125) < 1e-6, `time 0 hard: raw 3*0.75 = 2.25 -> 0.125 (referee) — got ${cld('hard', 0)}`);
  ok(Eq.localDifficulty({ difficulty: 'peaceful', time: 5e6 }) === 0, 'peaceful is 0 whatever the clock');
  // day 64 (time 1,536,000) is a full moon (phase 0): g = 0.25, moon term min(0.25, g) = 0.25 -> normal raw 2*1.25 = 2.5
  ok(Math.abs(Eq.localDifficulty({ difficulty: 'normal', time: 1536000 }) - 2.5) < 1e-5, 'normal, day 64 full moon: raw 2.5');
  ok(Math.abs(cld('hard', 1536000) - 0.875) < 1e-5, `hard, day 64 full moon: raw 3.75 -> 0.875 — got ${cld('hard', 1536000)}`);
  // new moon (phase 4: day 68) adds nothing
  ok(Math.abs(Eq.localDifficulty({ difficulty: 'normal', time: 68 * 24000 }) - 2.0) < 1e-5, 'normal, new moon after the ramp: raw 2.0');
  ok(cld('hard', 1536000, 3600000) === 1, 'hard, maxed inhabited time: raw 6.75 -> clamps to 1');
  okAv(cld('normal', 0) !== 1.0, 'anti-vacuity: the old flat table (normal = 1.0) is not what time 0 gives');
}
// The roll tables below are tested at a PINNED multiplier of 1.0 (0 on peaceful), so they test
// the tables, not the clock — §3b above owns the clock.
Eq.today = () => new Date(2026, 5, 15);   // pinned: the real clock made every roll check fail on 31 Oct (Halloween head)
const realCLD = Eq.clampedLocalDifficulty;
Eq.clampedLocalDifficulty = () => (Diff.get() === 'peaceful' ? 0 : 1.0);

// ── s130: which types roll armour, and the zombie's own weapon roll (referee findings 9/11/12) ──
say('\n3c. initEquipment overrides: no-super types, zombie iron sword/shovel, fixed weapons');
{
  Diff.set('normal');
  const lucky = () => 0;          // every gate passes
  for (const t of ['pillager', 'vindicator', 'drowned']) {
    const e = { type: t, equip: [] };
    if (t === 'drowned') Eq.initDrowned(e, lucky); else Eq.initMob(e, lucky);
    const armour = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD].filter((s) => Eq.getEquipped(e, s));
    ok(armour.length === 0, `${t}: initEquipment never calls super — no armour even when every roll passes (got ${armour.length})`);
  }
  const z = { type: 'zombie', equip: [] };
  Eq.initMob(z, lucky);
  ok(!!Eq.getEquipped(z, IT.FEET), 'zombie still takes super\'s armour roll (feet always first)');
  ok(Eq.getEquipped(z, IT.MAINHAND) && IT.nameOf(Eq.getEquipped(z, IT.MAINHAND).i) === 'iron_sword', 'zombie: nextFloat<0.01 then nextInt(3)==0 -> iron_sword');
  const seq = (a) => { let i = 0; return () => (i < a.length ? a[i++] : 0.99); };
  const z2 = { type: 'zombie', equip: [] };
  Eq.rollZombieWeapon(z2, seq([0.005, 0.5]));
  ok(Eq.getEquipped(z2, IT.MAINHAND) && IT.nameOf(Eq.getEquipped(z2, IT.MAINHAND).i) === 'iron_shovel', 'nextInt(3) != 0 -> iron_shovel');
  const z3 = { type: 'zombie', equip: [] };
  Eq.rollZombieWeapon(z3, seq([0.02, 0]));
  okAv(!Eq.getEquipped(z3, IT.MAINHAND), 'anti-vacuity: 0.02 misses the normal-difficulty 1% gate');
  Diff.set('hard');
  const z4 = { type: 'zombie', equip: [] };
  Eq.rollZombieWeapon(z4, seq([0.02, 0]));
  ok(!!Eq.getEquipped(z4, IT.MAINHAND), '…and passes the hard 5% gate');
  Diff.set('normal');
  const pz = { type: 'drowned', equip: [] };
  ok(!Eq.ZOMBIE_WEAPON.drowned && !Eq.ZOMBIE_WEAPON.zombified_piglin, 'drowned/zombified_piglin override initEquipment — no zombie weapon roll');
  for (const [t, w] of [['wither_skeleton', 'stone_sword'], ['vex', 'iron_sword'], ['illusioner', 'bow'], ['zombified_piglin', 'golden_sword']]) {
    const e = { type: t, equip: [] };
    Eq.initWeapon(e);
    ok(Eq.getEquipped(e, IT.MAINHAND) && IT.nameOf(Eq.getEquipped(e, IT.MAINHAND).i) === w, `${t} holds a ${w}`);
  }
  const v = { type: 'vex', equip: [] }; Eq.initMob(v, lucky);
  ok(Eq.dropChance(v, IT.MAINHAND) === 0, "the vex's sword never drops (setEquipmentDropChance 0)");
}

say('\n4. the base armour roll (MobEntity.initEquipment, .decomp:871-906): gate, tier table, per-slot break chance');
{
  // deterministic nextFloat() source off a fixed queue, so the same three vanilla rolls this
  // file's own header cites are pinned rather than trusted.
  function rndFrom(seq) {
    let i = 0;
    return () => (i < seq.length ? seq[i++] : 0.99);
  }

  Diff.set('normal');   // clampedLocalDifficulty() -> 1.0, so the 0.15 gate is exactly 0.15
  // gate PASS (r<0.15), nextInt(2)=0 (r*2<1), all three +1.095 rolls miss (>=0.095) -> tier 0
  // (leather), and every one of the four break rolls (legs/chest/head) stays under 0.25 so
  // nothing stops the loop -> all four slots filled.
  {
    const e = { type: 'zombie' };
    const r = rndFrom([0.10, 0.40,  0.5, 0.5, 0.5,  0.9, 0.9, 0.9]);
    Eq.rollArmor(e, r);
    ok(IT.nameOf(Eq.getEquipped(e, IT.FEET).i) === 'leather_boots', 'feet: leather (tier 0), always attempted first');
    ok(IT.nameOf(Eq.getEquipped(e, IT.LEGS).i) === 'leather_leggings', 'legs: leather too — the break roll (0.0 < 0.25) never fired');
    ok(IT.nameOf(Eq.getEquipped(e, IT.CHEST).i) === 'leather_chestplate', 'chest: leather');
    ok(IT.nameOf(Eq.getEquipped(e, IT.HEAD).i) === 'leather_helmet', 'head: leather — a full leather set from one roll');
  }
  // same gate pass, but ONE +1.095 roll hits -> tier 1 (golden, not chainmail — D-266's own
  // out-of-jar order, the common wrong guess this file's header names explicitly).
  {
    const e = { type: 'zombie' };
    const r = rndFrom([0.10, 0.40,  0.05, 0.5, 0.5,  0.9, 0.9, 0.9]);
    Eq.rollArmor(e, r);
    ok(IT.nameOf(Eq.getEquipped(e, IT.HEAD).i) === 'golden_helmet', 'one tier-up roll lands on GOLDEN, not chainmail — the .decomp order, not alphabetical/value order');
  }
  // the break roll DOES fire at legs (second armour slot): feet equips, legs/chest/head do not.
  {
    const e = { type: 'zombie' };
    const r = rndFrom([0.10, 0.40,  0.5, 0.5, 0.5,  0.10]);   // 0.10 < 0.25 breakChance -> stop
    Eq.rollArmor(e, r);
    ok(!!Eq.getEquipped(e, IT.FEET), 'feet still equips (the break roll never applies to the FIRST armour slot)');
    ok(!Eq.getEquipped(e, IT.LEGS) && !Eq.getEquipped(e, IT.CHEST) && !Eq.getEquipped(e, IT.HEAD), 'legs/chest/head all stay empty once the break roll fires');
  }
  // the entry gate itself: peaceful -> clampedLocalDifficulty()=0 -> 0.15*0=0, so `r()<0` can
  // NEVER pass, no matter how lucky every later roll would have been.
  {
    Diff.set('peaceful');
    const e = { type: 'zombie' };
    Eq.rollArmor(e, rndFrom([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    okAv(!Eq.getEquipped(e, IT.FEET) && !Eq.getEquipped(e, IT.HEAD), 'peaceful refuses the whole roll even with every later roll maximally lucky — the gate is really the FIRST check');
    Diff.set('normal');
    const e2 = { type: 'zombie' };
    Eq.rollArmor(e2, rndFrom([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    okAv(!!Eq.getEquipped(e2, IT.FEET), 'normal difficulty with the SAME lucky sequence does equip — proves the peaceful refusal above was the gate, not a bug swallowing every roll');
  }
  // rollArmor never touches a slot a spawn-time weapon already claimed, and never overwrites an
  // already-armoured slot either.
  {
    const e = { type: 'zombie' };
    const worn = Eq.stackOf('diamond_helmet');
    Eq.setEquipped(e, IT.HEAD, worn);
    Eq.rollArmor(e, rndFrom([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    okAv(Eq.getEquipped(e, IT.HEAD) === worn, 'a pre-equipped head slot survives a maximally lucky armour roll unchanged — rollArmor does not clobber');
  }
}
say(`   ${pass} ok`);

say('\n5. drop chances (MobEntity.dropEquipment): only a player kill drops gear, and the roll gates it both ways');
{
  const IT2 = IT;
  const e = { type: 'skeleton', equip: [] };
  Eq.setEquipped(e, IT2.MAINHAND, Eq.stackOf('bow'));
  Eq.setEquipped(e, IT2.HEAD, Eq.stackOf('iron_helmet'));
  const dropped = Eq.dropEquipment(e, () => 0, true);   // r()=0 < any positive dropChance
  ok(dropped.length === 2 && dropped.some(d => d.item === 'bow') && dropped.some(d => d.item === 'iron_helmet'),
     'a guaranteed roll (r()=0) drops both equipped pieces on a player kill');
  ok(Eq.getEquipped(e, IT2.MAINHAND) === null && Eq.getEquipped(e, IT2.HEAD) === null, 'and clears both slots');

  const e2 = { type: 'skeleton', equip: [] };
  Eq.setEquipped(e2, IT2.MAINHAND, Eq.stackOf('bow'));
  okAv(Eq.dropEquipment(e2, () => 0, false).length === 0, 'the SAME guaranteed roll drops NOTHING when killedByPlayer is false — the flag really gates it');
  okAv(!!Eq.getEquipped(e2, IT2.MAINHAND), 'and the bow is still equipped after the refused drop');

  const e3 = { type: 'skeleton', equip: [] };
  Eq.setEquipped(e3, IT2.MAINHAND, Eq.stackOf('bow'));
  okAv(Eq.dropEquipment(e3, () => 0.99, true).length === 0, 'a maximally UNLUCKY roll (r()=0.99, above the 0.085 default chance) drops nothing even on a player kill');
}
say(`   ${pass} ok`);

say('\n5b. #5565 dropEquipment wear + enchant tag: 200 seeded kills, iron_helmet, dropChance 0.085');
{
  let s = 12345; const rs = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const max = IT.durability[IT.of('iron_helmet')];
  const ench = [{ id: 'protection', lvl: 3 }];
  let drops = 0, lo = max, hi = 0, tagKept = true, zero = 0, skipWear = 0;
  for (let k = 0; k < 200; k++) {
    const e = { type: 'zombie', equip: [] };
    const st = Eq.stackOf('iron_helmet'); st.t = { Enchantments: ench };
    Eq.setEquipped(e, IT.HEAD, st); Eq.setDropChance(e, IT.HEAD, 0.085);
    const out = Eq.dropEquipment(e, rs, true, 0);
    for (const d of out) {
      drops++; lo = Math.min(lo, d.d); hi = Math.max(hi, d.d);
      if (d.d === 0) zero++;
      if (!d.tag || d.tag.Enchantments !== ench) tagKept = false;
      if (d.d === 0) skipWear++;
    }
  }
  ok(drops > 0, `some of 200 kills dropped the helmet (${drops})`);
  okAv(zero === 0 && skipWear === 0, 'never undamaged (wear applied)');
  okAv(hi <= max && lo >= 1 && lo >= 0, `damage within jar range (${lo}..${hi} of ${max})`);
  okAv(tagKept, 'enchantment tag kept on every dropped stack');
  okAv(drops === 0 || hi > max / 2, 'distribution is skewed toward near-broken (jar: max - nextInt(1+nextInt(max-3)))');
}
say(`   ${pass} ok`);

say('\n6. Eq.damageEquipped: durability spend, and the break-and-clear at max');
{
  const e = { type: 'zombie', equip: [] };
  const st = Eq.stackOf('leather_helmet');   // durability 55
  Eq.setEquipped(e, IT.HEAD, st);
  ok(!Eq.damageEquipped(e, IT.HEAD, 54, () => 0), 'damaging to 54/55 does not break it');
  ok(!!Eq.getEquipped(e, IT.HEAD) && Eq.getEquipped(e, IT.HEAD).d === 54, 'the stack itself carries the accumulated damage');
  ok(Eq.damageEquipped(e, IT.HEAD, 1, () => 0) === true, 'the next point of damage (55/55) breaks it — returns true');
  okAv(Eq.getEquipped(e, IT.HEAD) === null, 'and the slot is cleared — a broken helmet is gone, not just flagged');

  const e2 = { type: 'zombie', equip: [] };
  Eq.setEquipped(e2, IT.HEAD, Eq.stackOf('leather_helmet'));
  okAv(!Eq.damageEquipped(e2, IT.HEAD, 1, () => 0) && !!Eq.getEquipped(e2, IT.HEAD), 'one point of damage alone (1/55) does NOT break it — contrast with the 55-point case above');
}
say(`   ${pass} ok`);

say('\n7. D-517: the daylight-burn HELMET branch, LIVE through Cb.tickDaylightBurn (14j_combat.js)');
{
  const S = M.Sky, W2 = M.World;
  const lucky = () => 0;
  const savedDay = S.dayTime, savedW = S.weather;
  S.weather = S.newWeather();
  S.dayTime = 6000;   // noon
  // stub full open sky (packLight(15,0)) at the test cell -- this section is testing the HELMET
  // branch of Cb.tickDaylightBurn, not W.getLight/lighting propagation (spawncheck's own §10
  // already proves the brightness/darkness read against real Sky state); a synthetic platform
  // with no lighting pass would read light 0 here and refuse before the branch under test ever
  // runs.
  const savedGetLight = W2.getLight;
  W2.getLight = () => (15 << 4);
  const savedSeesSky = W2.canSeeSky;
  W2.canSeeSky = () => true;
  const mk = (type) => ({ type, x: 0.5, y: 61, z: 0.5, height: 1.95, maxHealth: 20, health: 20, remainingFireTicks: 0, equip: [] });

  const bare = mk('zombie');
  ok(Cb.tickDaylightBurn(bare, lucky) === true && bare.remainingFireTicks === 160, 'no helmet: still catches fire for 8s exactly as spawncheck already proves (no regression)');

  const helmeted = mk('zombie');
  Eq.setEquipped(helmeted, IT.HEAD, Eq.stackOf('iron_helmet'));   // durability 165
  ok(Cb.tickDaylightBurn(helmeted, lucky) === true && helmeted.remainingFireTicks === 0, 'WITH an iron helmet: the sun still "gets" it (returns true) but it does NOT ignite');
  ok(Eq.getEquipped(helmeted, IT.HEAD).d === 0 || Eq.getEquipped(helmeted, IT.HEAD).d === 1, 'the helmet took 0 or 1 damage instead (random.nextInt(2))');

  // anti-vacuity: run it enough times to actually break a helmet, and prove the mob burns again
  // the FIRST tick it has none.
  const wearing = mk('zombie');
  Eq.setEquipped(wearing, IT.HEAD, Eq.stackOf('leather_helmet'));   // durability 55
  let brokeAt = -1;
  // Cb.tickDaylightBurn calls rnd() TWICE when a helmet is worn: once inside
  // Cb.isAffectedByDaylight (the "did the sun even get it" roll -- must stay LUCKY, near 0, or
  // the tick refuses before the helmet branch runs at all) and once for the helmet's own
  // random.nextInt(2) damage amount (pinned to 1, so it breaks in exactly 55 ticks).
  let call = 0;
  const alt = () => ((++call % 2 === 1) ? 0 : 0.5);   // odd: lucky (isAffectedByDaylight); even: floor(0.5*2)=1 (nextInt(2))
  for (let i = 1; i <= 60 && brokeAt < 0; i++) {
    Cb.tickDaylightBurn(wearing, alt);
    if (!Eq.getEquipped(wearing, IT.HEAD)) brokeAt = i;
  }
  okAv(brokeAt === 55, `the helmet breaks on exactly the 55th burn tick (got tick ${brokeAt}) — durability is really spent, not a flag`);
  okAv(wearing.remainingFireTicks === 0, 'still not on fire on the tick it breaks (vanilla: the SAME tick still cancels the burn)');
  Cb.tickDaylightBurn(wearing, lucky);
  okAv(wearing.remainingFireTicks === 160, 'the very next tick, helmet gone, the zombie burns — proves the branch really falls through once the gear is gone');

  // #755: PhantomEntity.tickMovement has NO helmet branch -- a helmeted phantom burns, helmet untouched
  const ph = mk('phantom');
  Eq.setEquipped(ph, IT.HEAD, Eq.stackOf('iron_helmet'));
  okAv(Cb.tickDaylightBurn(ph, lucky) === true && ph.remainingFireTicks === 160, 'phantom WITH a helmet in daylight is set on fire (no helmet branch, PhantomEntity.tickMovement)');
  okAv(Eq.getEquipped(ph, IT.HEAD).d === 0 || !Eq.getEquipped(ph, IT.HEAD).d, 'the phantom\'s helmet is undamaged');

  S.dayTime = savedDay; S.weather = savedW;
  W2.getLight = savedGetLight; W2.canSeeSky = savedSeesSky;
}
say(`   ${pass} ok`);

say('\n8. Eq.armorOf + Cb.hurt: a MOB\'S OWN worn armour actually reduces damage (14j_combat.js)');
{
  EL.clear();
  freshWorld();
  Diff.set('normal');
  const bareArmor = Eq.armorOf({ type: 'zombie' });
  ok(bareArmor.armor === 2 && bareArmor.toughness === 0 && bareArmor.protection === 0,
     'a bare zombie (no equip table at all) already carries its OWN generic.armor base of 2 (ZombieEntity.createZombieAttributes)');
  ok(Eq.armorOf({ type: 'skeleton' }).armor === 0, 'a bare skeleton has NO base armour (HostileEntity never adds field_23724)');

  const chest = Eq.stackOf('iron_chestplate');
  const wornArmor = Eq.armorOf({ type: 'zombie', equip: [] });
  const e = { type: 'zombie', equip: [] };
  Eq.setEquipped(e, IT.CHEST, chest);
  const withChest = Eq.armorOf(e);
  ok(withChest.armor === 2 + IT.defenseOf(chest.i),
     'wearing an iron chestplate adds its OWN defenseOf on top of the 2 base — the exact number D-291 already reads for the player');

  // LIVE through Cb.hurt: an armoured zombie takes strictly less than a bare one from the same hit.
  const bare = EL.spawn('zombie', 0.5, 61, 0.5);
  bare.maxHealth = 20; bare.health = 20;
  const armored = EL.spawn('zombie', 2.5, 61, 0.5);
  armored.maxHealth = 20; armored.health = 20;
  Eq.setEquipped(armored, IT.CHEST, Eq.stackOf('iron_chestplate'));
  Eq.setEquipped(armored, IT.HEAD, Eq.stackOf('iron_helmet'));
  Eq.setEquipped(armored, IT.LEGS, Eq.stackOf('iron_leggings'));
  Eq.setEquipped(armored, IT.FEET, Eq.stackOf('iron_boots'));
  Cb.hurt(bare, 6, 0, true);
  Cb.hurt(armored, 6, 0, true);
  ok(bare.health < 20, 'the bare zombie (base armour 2 only) still takes some damage');
  okAv(armored.health > bare.health, 'the fully-armoured zombie (base 2 + four iron pieces) takes LESS damage than the bare one — Cb.hurt really reads Eq.armorOf now');

  // anti-vacuity, the other direction: zero out the base-armour table and prove the SAME hit on
  // the SAME gear now lands harder (isolates the base-armour contribution from the equipped one).
  const savedBase = Eq.MOB_BASE_ARMOR.zombie;
  Eq.MOB_BASE_ARMOR.zombie = 0;
  const armored2 = { type: 'zombie', equip: [], invulnerableTime: 0, lastHurt: 0, health: 20, maxHealth: 20 };
  Eq.setEquipped(armored2, IT.CHEST, Eq.stackOf('iron_chestplate'));
  Eq.setEquipped(armored2, IT.HEAD, Eq.stackOf('iron_helmet'));
  Eq.setEquipped(armored2, IT.LEGS, Eq.stackOf('iron_leggings'));
  Eq.setEquipped(armored2, IT.FEET, Eq.stackOf('iron_boots'));
  Cb.hurt(armored2, 6, 0, true);
  Eq.MOB_BASE_ARMOR.zombie = savedBase;
  okAv(armored2.health < armored.health, 'dropping ONLY the 2-point base armour (gear unchanged) lets MORE damage through than the same gear with the base intact — the base and the gear both really feed the same formula');

  // the Protection enchant: a rolled/planted `protection` NBT entry lowers damage further, on
  // top of the plain defense/toughness absorb, via Eq.protectionReduce (DamageUtil.getInflictedDamage).
  const protE = { type: 'zombie', equip: [], invulnerableTime: 0, lastHurt: 0, health: 20, maxHealth: 20 };
  const protChest = Eq.stackOf('iron_chestplate');
  protChest.t = { Enchantments: [{ id: 'minecraft:protection', lvl: 4 }] };
  Eq.setEquipped(protE, IT.CHEST, protChest);
  const protInfo = Eq.armorOf(protE);
  ok(protInfo.protection === 4, 'Eq.armorOf reads the protection level straight off the stack\'s own NBT');
  const plainE = { type: 'zombie', equip: [], invulnerableTime: 0, lastHurt: 0, health: 20, maxHealth: 20 };
  Eq.setEquipped(plainE, IT.CHEST, Eq.stackOf('iron_chestplate'));   // identical piece, no enchant
  Cb.hurt(protE, 10, 0, true);
  Cb.hurt(plainE, 10, 0, true);
  okAv(protE.health > plainE.health, 'the SAME chestplate with Protection IV rolled takes less damage than the unenchanted one');

  // anti-vacuity: Eq.protectionReduce itself, isolated and clamped.
  ok(Eq.protectionReduce(25, 4) === 25 * (1 - 4 / 25), 'protectionReduce matches DamageUtil.getInflictedDamage exactly at amount=4');
  ok(Eq.protectionReduce(25, 999) === Eq.protectionReduce(25, 20), 'the amount clamps at 20, same as the real formula\'s own MathHelper.clamp');
}
say(`   ${pass} ok`);

say('\n8g. Ent.attrsOf\'s new armor column: a mob\'s OWN base generic.armor attribute (D-336 gap named on Wi.OWED)');
{
  ok(Ent.attrsOf('wither').armor === 4, 'wither carries armor 4 (WitherEntity.createWitherAttributes, .decomp:502-509)');
  ok(Ent.attrsOf('zombie').armor === 0, 'the general attrsOf table itself owes zombie nothing -- its confirmed 2 lives in Eq.MOB_BASE_ARMOR, a separate, non-overlapping table');
  ok(Ent.attrsOf('skeleton').armor === 0, 'a type this unit did not confirm reads the registry default of 0, never a guess');
  ok(Ent.attrsOf('magma_cube').armor === 0, 'magma cube static table stays 0; its size*3 armor is per-instance (e.armorBase, Sl.setSize, #1003)');

  // LIVE through Cb.hurt: a wither (NO equipment at all -- Eq.armorOf's equip-slot path never
  // fires for it) still takes strictly less damage than an otherwise-identical, genuinely
  // 0-base-armor mob (a bare skeleton -- confirmed 0 above, and NOT in Eq.MOB_BASE_ARMOR either,
  // unlike zombie/husk/drowned), because Cb.hurt now adds Ent.attrsOf(e.type).armor into the SAME
  // armorTotal Eq.armorOf's equipment path feeds -- proving the two paths ADD, not replace.
  EL.clear(); freshWorld();
  const wither = EL.spawn('wither', 0.5, 61, 0.5);
  wither.maxHealth = wither.health = 300;
  ok(!wither.equip, 'a bare EL.spawn(\'wither\') carries no equipment table at all -- Eq.armorOf\'s worn-armour path is a structural no-op for it');
  Cb.hurt(wither, 20, 0, true);
  const witherHealthAfter = wither.health;
  ok(Math.abs(witherHealthAfter - (300 - 20 * (1 - Math.max(4 * 0.2, 4 - 20 / 2) / 25))) < 1e-4, // health is float32 now (as vanilla)
     'the wither\'s post-hit health matches Sv.afterArmor(20, 4, 0) exactly -- the real DamageUtil.getDamageLeft formula, not an approximation: ' + witherHealthAfter);

  const skel = EL.spawn('skeleton', 3.5, 61, 0.5);
  skel.maxHealth = skel.health = 300;
  Cb.hurt(skel, 20, 0, true);
  ok(skel.health === 300 - 20, 'a genuinely 0-base-armor mob (skeleton, no attrsOf armor and no Eq.MOB_BASE_ARMOR entry) takes the FULL 20 with no reduction at all -- Sv.afterArmor\'s own armor===0 short-circuit');
  okAv(witherHealthAfter > skel.health, 'the SAME 20-damage hit on the SAME max health leaves the wither (base armor 4) with strictly MORE health than the true 0-armor control -- Cb.hurt really adds Ent.attrsOf\'s armor column now');

  // anti-vacuity, the other direction: zero out Ent.ARMOR.wither/Ent.attrs.wither.armor and prove
  // the SAME hit on the SAME (still-unequipped) wither now lands EXACTLY as hard as the true
  // 0-armor control -- isolating this unit's own contribution from every other thing Cb.hurt does
  // to a fresh wither (nothing else in the pipeline can reconvergently mask this one being zeroed).
  const savedWitherArmor = Ent.ARMOR.wither;
  Ent.ARMOR.wither = 0;
  Ent.attrs.wither.armor = 0;
  EL.clear(); freshWorld();
  const wither2 = EL.spawn('wither', 0.5, 61, 0.5);
  wither2.maxHealth = wither2.health = 300;
  Cb.hurt(wither2, 20, 0, true);
  Ent.ARMOR.wither = savedWitherArmor;
  Ent.attrs.wither.armor = savedWitherArmor;
  okAv(wither2.health === 300 - 20, 'with the base-armor entry zeroed, the SAME hit on the SAME (still bare) wither now takes the FULL 20, same as the true 0-armor control -- this unit\'s own number, and nothing else, produced the earlier reduction');
}
say(`   ${pass} ok`);

say('\n9. Eq.rollEnchants + Eq.updateEnchantments: MobEntity.enchantMainHandItem/enchantEquipment (.decomp:958-990)');
{
  function rndFrom(seq) {
    let i = 0;
    return () => (i < seq.length ? seq[i++] : 0.99);
  }

  say('   9a. D-670: bow/crossbow enchantability is 1 (RangedWeaponItem.java:31), swords draw WEAPON, axes never do');
  {
    const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    const seen = (item, n) => { const r = seeded(item.length * 7919), ids = new Set(); for (let i = 0; i < n; i++) for (const x of Eq.rollEnchants(item, null, 5 + (i % 18), r)) ids.add(x.id); return ids; };
    const bow = seen('bow', 2000), xb = seen('crossbow', 2000), axe = seen('iron_axe', 4000), sw = seen('iron_sword', 2000);
    ok(bow.has('power') && [...bow].every((id) => ['power', 'punch', 'flame', 'infinity', 'unbreaking'].includes(id)), 'a bow rolls power (and only bow/breakable enchants): ' + [...bow]);
    ok(xb.has('quick_charge') || xb.has('piercing'), 'a crossbow rolls quick_charge/piercing: ' + [...xb]);
    ok(sw.has('sharpness') && sw.has('smite'), 'an iron_sword draws the WEAPON pool (sharpness, smite): ' + [...sw]);
    okAv(!axe.has('sharpness') && !axe.has('smite') && !axe.has('bane_of_arthropods'), 'anti-vacuity: an AXE never draws a WEAPON-target enchant (getPossibleEntries asks the target, not isAcceptableItem): ' + [...axe]);
    ok(axe.has('efficiency'), 'an axe draws efficiency');
  }

  say('   9b. a fully pinned iron_axe roll (enchantability 14) — hand-verified against the .decomp min/max-power windows');
  {
    const seq = [0, 0, 0.5, 0.5, 0, 0, 0, 0.5];
    const rolled = Eq.rollEnchants('iron_axe', 'AXE', 14, rndFrom(seq));
    ok(rolled.length === 2, `exactly two enchantments land on this pinned sequence (got ${rolled.length})`);
    ok(rolled[0] && rolled[0].id === 'efficiency', `first pick is efficiency II (got ${rolled[0] && rolled[0].id}/${rolled[0] && rolled[0].lvl})`);
    ok(rolled[1] && rolled[1].id !== 'efficiency', `second pick is NOT efficiency again — removeConflicts drops the just-picked id even with a null group (Enchantment.canAccept's own "this != other") (got ${rolled[1] && rolled[1].id})`);
  }

  say('   9c. Eq.applyEnchants writes the SAME NBT shape Cb.enchantList already reads');
  {
    const st = Eq.stackOf('iron_axe');
    Eq.applyEnchants(st, [{ id: 'sharpness', lvl: 3 }]);
    ok(Cb.enchantLevel(st, 'sharpness') === 3, 'Cb.enchantLevel (14j_combat.js) reads back the level Eq.applyEnchants just wrote');
    okAv(Cb.enchantLevel(st, 'smite') === 0, 'and reads 0 for an enchant that was never written — not a stub that always answers 3');
  }

  say('   9d. the mob-level gates: enchantMainHandItem 0.25*difficulty, enchantEquipment 0.5*difficulty per slot');
  {
    Diff.set('normal');   // clampedLocalDifficulty() = 1.0
    const e = { type: 'vindicator', equip: [] };
    Eq.setEquipped(e, IT.MAINHAND, Eq.stackOf('iron_axe'));
    // a maximally-lucky rnd (always 0): passes the 0.25 gate, rolls level=5+floor(1*0)=5, then
    // rollEnchants consumes the rest of the same lucky source.
    Eq.enchantMainHandItem(e, Eq.clampedLocalDifficulty(), () => 0);
    const axe = Eq.getEquipped(e, IT.MAINHAND);
    okAv(!!(axe.t && axe.t.Enchantments && axe.t.Enchantments.length), 'a maximally-lucky roll DOES enchant the mainhand axe');

    const e2 = { type: 'vindicator', equip: [] };
    Eq.setEquipped(e2, IT.MAINHAND, Eq.stackOf('iron_axe'));
    Eq.enchantMainHandItem(e2, Eq.clampedLocalDifficulty(), () => 0.99);
    okAv(!(Eq.getEquipped(e2, IT.MAINHAND).t && Eq.getEquipped(e2, IT.MAINHAND).t.Enchantments), 'a maximally-UNLUCKY roll (r()=0.99, above the 0.25 gate) enchants nothing');

    Diff.set('peaceful');   // clampedLocalDifficulty() = 0 -> 0.25*0 = 0, the gate can never pass
    const e3 = { type: 'vindicator', equip: [] };
    Eq.setEquipped(e3, IT.MAINHAND, Eq.stackOf('iron_axe'));
    Eq.enchantMainHandItem(e3, Eq.clampedLocalDifficulty(), () => 0);
    okAv(!(Eq.getEquipped(e3, IT.MAINHAND).t && Eq.getEquipped(e3, IT.MAINHAND).t.Enchantments), 'peaceful refuses the whole roll even with a maximally-lucky rnd — same shape as rollArmor\'s own gate');
    Diff.set('normal');

    const e4 = { type: 'zombie', equip: [] };
    Eq.setEquipped(e4, IT.HEAD, Eq.stackOf('iron_helmet'));
    Eq.enchantEquipment(e4, IT.HEAD, 'HEAD', Eq.clampedLocalDifficulty(), () => 0);
    okAv(!!(Eq.getEquipped(e4, IT.HEAD).t && Eq.getEquipped(e4, IT.HEAD).t.Enchantments), 'enchantEquipment (0.5*difficulty gate) DOES enchant a worn helmet on a maximally-lucky roll');
    const e5 = { type: 'zombie', equip: [] };   // no HEAD equipped at all
    Eq.enchantEquipment(e5, IT.HEAD, 'HEAD', Eq.clampedLocalDifficulty(), () => 0);
    okAv(Eq.getEquipped(e5, IT.HEAD) === null, 'and refuses outright when the slot is empty — nothing to enchant, no crash');
  }

  say('   9e. LIVE through EL.spawn -> Eq.initMob -> Eq.updateEnchantments: rolled gear can carry real NBT combat already reads');
  {
    Diff.set('normal');
    EL.clear();
    freshWorld();
    let sawEnchant = false;
    for (let i = 0; i < 40 && !sawEnchant; i++) {
      const vi = EL.spawn('vindicator', i + 0.5, 61, 0.5);
      const axe = vi && Eq.getEquipped(vi, IT.MAINHAND);
      if (axe && axe.t && axe.t.Enchantments && axe.t.Enchantments.length) sawEnchant = true;
    }
    okAv(sawEnchant, 'across 40 live vindicator spawns at least one rolls an enchanted iron_axe through the real Eq.initMob -> Eq.updateEnchantments spawn hook (D-517\'s own wiring)');
  }
}
say('   9f. #669 Halloween head roll (ZombieEntity/AbstractSkeletonEntity.initialize)');
{
  Diff.set('normal');
  const realToday = Eq.today;
  const seq = (...v) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };
  const head = (type, date, rnd) => {
    Eq.today = () => date;
    const e = { type, equip: [] };
    Eq.halloweenHead(e, rnd);
    return e;
  };
  const oct31 = new Date(2026, 9, 31), oct30 = new Date(2026, 9, 30), nov30 = new Date(2026, 10, 30);
  const z = head('zombie', oct31, seq(0.1, 0.5));
  okAv(Eq.getEquipped(z, IT.HEAD) && IT.nameOf(Eq.getEquipped(z, IT.HEAD).i) === 'carved_pumpkin', '31 Oct, roll 0.1<0.25, second roll 0.5 -> carved_pumpkin');
  okAv(Eq.dropChance(z, IT.HEAD) === 0, 'pumpkin head drop chance is 0');
  const j = head('skeleton', oct31, seq(0.1, 0.05));
  okAv(Eq.getEquipped(j, IT.HEAD) && IT.nameOf(Eq.getEquipped(j, IT.HEAD).i) === 'jack_o_lantern', 'skeleton, second roll 0.05<0.1 -> jack_o_lantern');
  okAv(!Eq.getEquipped(head('zombie', oct31, seq(0.5, 0.5)), IT.HEAD), 'first roll 0.5 >= 0.25 -> no pumpkin');
  okAv(!Eq.getEquipped(head('zombie', oct30, seq(0, 0)), IT.HEAD), '30 Oct -> never');
  okAv(!Eq.getEquipped(head('zombie', nov30, seq(0, 0)), IT.HEAD), '30 Nov -> never');
  okAv(!Eq.getEquipped(head('vindicator', oct31, seq(0, 0)), IT.HEAD), 'vindicator is not in the zombie/skeleton family');
  Eq.today = () => oct31;
  const pre = { type: 'zombie', equip: [] };
  Eq.setEquipped(pre, IT.HEAD, Eq.stackOf('iron_helmet'));
  Eq.halloweenHead(pre, seq(0, 0));
  okAv(IT.nameOf(Eq.getEquipped(pre, IT.HEAD).i) === 'iron_helmet', 'an existing helmet is kept');
  freshWorld(); EL.clear();
  let n = 0;
  for (let i = 0; i < 40; i++) { const m = EL.spawn('zombie', i + 0.5, 61, 0.5); if (m && Eq.getEquipped(m, IT.HEAD) && /pumpkin|jack_o/.test(IT.nameOf(Eq.getEquipped(m, IT.HEAD).i))) n++; }
  okAv(n > 0, 'live EL.spawn on 31 Oct: some of 40 zombies wear a pumpkin (' + n + ')');
  Eq.today = realToday;
}
{ // #993 DrownedEntity.prefersNewEquipment (.decomp:163-171)
  const dr = { type: 'drowned' }, zb = { type: 'zombie' };
  const tri = (d) => { const t = Eq.stackOf('trident'); t.d = d; return t; };
  okAv(Eq.prefersNewEquipment(tri(0), Eq.stackOf('iron_sword'), dr) === true, 'drowned swaps sword -> trident');
  okAv(Eq.prefersNewEquipment(tri(0), Eq.stackOf('iron_sword'), zb) === false, 'non-drowned refuses trident over sword');
  okAv(Eq.prefersNewEquipment(Eq.stackOf('iron_sword'), Eq.stackOf('nautilus_shell'), dr) === false, 'drowned never replaces nautilus_shell');
  okAv(Eq.prefersNewEquipment(tri(5), tri(10), dr) === true, 'drowned: less-damaged trident preferred');
  okAv(Eq.prefersNewEquipment(tri(10), tri(5), dr) === false, 'drowned: more-damaged trident refused');
  okAv(Eq.prefersNewEquipment(Eq.stackOf('iron_sword'), tri(0), dr) === false, 'drowned keeps trident over sword');
}
{ // #8162 drowned trident spawn-time enchants: MobEntity.updateEnchantments through NS.EnchHelper's trident pool
  Diff.set('hard');
  const MAXL = { loyalty: 3, impaling: 5, riptide: 3, channeling: 1, unbreaking: 3 };
  const draw = () => {
    const seen = {}; let bad = 0, tri = 0, ench = 0;
    let s = 12345;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 4000; i++) {
      const e = { type: 'drowned', equip: [] };
      const st = Eq.stackOf('trident');
      Eq.setEquipped(e, IT.MAINHAND, st);
      Eq.updateEnchantments(e, rng);
      tri++;
      const l = ((st.t && st.t.Enchantments) || []).map((x) => ({ id: x.id.replace('minecraft:', ''), lvl: x.lvl }));
      if (l.length) ench++;
      const ids = l.map((x) => x.id);
      for (const x of l) { seen[x.id] = 1; if (!(x.id in MAXL) || x.lvl < 1 || x.lvl > MAXL[x.id]) bad++; }
      if (new Set(ids).size !== ids.length) bad++;
      if (ids.includes('riptide') && (ids.includes('loyalty') || ids.includes('channeling'))) bad++;
    }
    return { seen, bad, ench };
  };
  const g = draw();
  ok(g.bad === 0, `drowned trident enchants violate pool/level/riptide exclusion (${g.bad})`);
  okAv(g.ench > 100, `drowned tridents get enchanted at hard (${g.ench}/4000)`);
  okAv(['loyalty', 'impaling', 'riptide', 'channeling', 'unbreaking'].every((k) => g.seen[k]), 'every trident enchant is drawn: ' + Object.keys(g.seen).join(','));
  const realCC = M.EnchHelper.canCombine;
  M.EnchHelper.canCombine = (a, b) => a !== b;     // break: drop the riptide exclusion
  const br = draw();
  M.EnchHelper.canCombine = realCC;
  okAv(br.bad > 0, 'break: without the riptide/loyalty/channeling exclusion the oracle fails (' + br.bad + ')');
  Diff.set('normal');
}
say(`   ${pass} ok`);


console.log('\n=================== equipcheck ===================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('====================================================');
if (fails.length) {
  console.log('\nFAIL');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('equipcheck: PASS');
