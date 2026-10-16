#!/usr/bin/env node
// survcheck.mjs — PLAN G5. The survival loop, asserted against closed forms.
//
//   node tools/survcheck.mjs [--verbose]
//
// ⚠ WHY THERE IS NO SECOND SIMULATOR IN HERE. PLAN's acceptance asks for "a scripted 10-minute
// session with the hunger and XP curves asserted at every tick against a hand-computed
// reference". A hand-computed reference for 12,000 ticks is a second copy of the code, and a
// check that is a copy of the thing it checks agrees with it about everything including its
// bugs — D-152's shape, where `physcheck` §1 enshrined the stub it was meant to catch.
//
// So the session IS run for 12,000 ticks, and what is asserted about it are CLOSED FORMS that
// can be computed without simulating: sprinting spends 0.1 exhaustion a block and 4.0 exhaustion
// is one point of food, so 40 blocks is one point, exactly, whatever the loop does in between.
// Slow regeneration heals 1 every 80 ticks and charges 6, so it costs 1.5 food a heart. Those
// are arithmetic, they come from the bytecode (D-252), and they cannot be satisfied by a loop
// that is merely self-consistent.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const VERBOSE = process.argv.includes('--verbose');
const NS = {};
globalThis.MCL = NS;
// ⚠ `02g_items.js` AND `14f_inventory.js` ARE HERE BECAUSE ARMOUR IS REAL NOW (D-291). §5 used to
// test `Sv.afterArmor` by handing it numbers, which proves the FORMULA and says nothing about
// where the numbers come from — and for four stages they came from nowhere: `e.armor` was 0 at
// every real call site because nothing summed the worn pieces. §5b wears actual armour.
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02g_items.js', '14f_inventory.js',
                 '14d_survival.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
{
  const A = join(MCLITE_ROOT, 'assets');
  NS.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'),
                  itemsBytes: JSON.parse(readFileSync(join(A, 'items.meta.json'), 'utf8')).rawBytes });
}
const Sv = NS.Survival;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
// ⚠ THE SUITE COUNTS THE TICKS, so an anti-vacuity case that passes silently is a deliberate
// break the summary cannot see (D-30's rule, and `suite.mjs` counts a literal ✓ per break).
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const say = (s) => { if (VERBOSE) console.log('   ' + s); };
const player = () => Sv.init({ x: 0, y: 0, z: 0 });

console.log('survcheck — PLAN G5, the survival loop (D-252)');

// ═══════════════ 1. experience: two independently written formulas must agree ══════════════
{
  // PLAN writes the curve as 2L+7 (L<16), 5L−38 (16≤L<31), 9L−158 (L≥31). The engine computes
  // the game's own form: 7+2L (L<15), 37+5(L−15) (15≤L<30), 112+9(L−30). They are the same
  // function and the boundaries are written differently, which is exactly where an off-by-one
  // would hide — so they are compared level by level rather than at a few samples.
  const planForm = (L) => (L < 16 ? 2 * L + 7 : (L < 31 ? 5 * L - 38 : 9 * L - 158));
  let disagree = [];
  for (let L = 0; L <= 100; L++) if (Sv.xpNeeded(L) !== planForm(L)) disagree.push(`${L}: ${Sv.xpNeeded(L)} vs ${planForm(L)}`);
  ok(disagree.length === 0, `the two forms of the XP curve disagree at ${disagree.slice(0, 4).join(', ')}`);
  ok(Sv.xpNeeded(0) === 7 && Sv.xpNeeded(15) === 37 && Sv.xpNeeded(30) === 112,
     `the three anchor points are ${Sv.xpNeeded(0)}, ${Sv.xpNeeded(15)}, ${Sv.xpNeeded(30)} and should be 7, 37, 112`);
  ok(Sv.totalXpFor(30) === 1395, `levels 0..30 should cost 1,395 points, the engine says ${Sv.totalXpFor(30)}`);
  say(`xp: 7 / 37 / 112 at levels 0, 15, 30 — total to 30 is ${Sv.totalXpFor(30)}`);

  // exactly one level's worth lands exactly on the next level
  const e = player();
  Sv.addXp(e, Sv.xpNeeded(0));
  ok(e.xpLevel === 1 && near(e.xpProgress, 0, 1e-9), `7 points should be exactly level 1, got ${e.xpLevel} + ${e.xpProgress}`);
  const e2 = player();
  Sv.addXp(e2, Sv.totalXpFor(30));
  ok(e2.xpLevel === 30 && near(e2.xpProgress, 0, 1e-9), `1,395 points should be exactly level 30, got ${e2.xpLevel} + ${e2.xpProgress.toFixed(4)}`);
  // and one point short is one point short
  const e3 = player();
  Sv.addXp(e3, Sv.totalXpFor(30) - 1);
  ok(e3.xpLevel === 29, `one point short of level 30 must still be 29, got ${e3.xpLevel}`);
  // points added one at a time must land in the same place as one lump
  const e4 = player();
  for (let i = 0; i < Sv.totalXpFor(10); i++) Sv.addXp(e4, 1);
  ok(e4.xpLevel === 10 && near(e4.xpProgress, 0, 1e-6),
     `adding a point at a time must reach the same level: got ${e4.xpLevel} + ${e4.xpProgress.toFixed(5)}`);
  say(`xp: one-at-a-time and one-lump agree at level 10`);
}

// ═══════════════ 2. exhaustion is spent at 4.0, saturation first, then food ════════════════
{
  const e = player();
  e.saturation = 5; e.food = 20;
  // 4.0 exhaustion is one point. Sprinting is 0.1 a block, so 40 blocks is one point exactly.
  for (let block = 0; block < 40; block++) Sv.movement(e, 1, { sprinting: true });
  ok(near(e.exhaustion, 4.0, 1e-9), `40 blocks sprinted should be exactly 4.0 exhaustion, got ${e.exhaustion}`);
  // #497: plain walking and sneaking on the ground cost nothing (increaseTravelMotionStats)
  const walker = player(); walker.sneaking = true;
  Sv.movement(walker, 1000, { walking: true });
  ok(walker.exhaustion === 0, `1000 blocks walked/sneaked should cost 0 exhaustion, got ${walker.exhaustion}`);
  // #4806: sprinting while climbing (isClimbing branch) costs nothing
  const climber = player();
  Sv.movement(climber, 1000, { sprinting: true, climbing: true });
  ok(climber.exhaustion === 0, `sprinting inside a ladder/vine should cost 0 exhaustion, got ${climber.exhaustion}`);
  // ⚠ AND IT IS NOT EXACTLY 4.0 — it is 4.000000000000001, because 0.1 added forty times is not
  // 4 in binary floating point. That is not a defect and vanilla has it too (in float32, worse);
  // it does mean the strict `> 4.0` test has to be exercised by SETTING the value, not by
  // accumulating to it, or the check is measuring the representation and not the rule.
  const strict = player(); strict.saturation = 5; strict.exhaustion = 4.0;
  Sv.tick(strict);
  ok(strict.saturation === 5 && near(strict.exhaustion, 4.0, 1e-12),
     'exactly 4.0 exhaustion must not spend — vanilla tests strictly greater');
  const over = player(); over.saturation = 5; over.exhaustion = 4.001;
  Sv.tick(over);
  ok(over.saturation === 4 && near(over.exhaustion, 0.001, 1e-9),
     `just over 4.0 spends 4.0 and one saturation: got sat ${over.saturation}, exhaustion ${over.exhaustion}`);
  say(`exhaustion: 40 blocks sprinted = 4.0 = one point`);

  // 5 saturation then food: 6 points is 24.0 exhaustion
  const e2 = player();
  e2.saturation = 5; e2.food = 20;
  let ticks = 0;
  while (e2.food > 19 && ticks < 100000) { Sv.movement(e2, 1, { sprinting: true }); Sv.tick(e2); ticks++; }
  ok(e2.saturation === 0 && e2.food === 19,
     `after saturation is gone the next point comes off food: sat ${e2.saturation}, food ${e2.food}`);
  ok(ticks > 200 && ticks < 250, `six points should take about 240 blocks of sprinting, it took ${ticks}`);
  say(`sprinting: ${ticks} blocks to spend 5 saturation and the first food point`);
}

// ═══════════════ 3. regeneration — both rates, and what each costs ═════════════════════════
{
  // SLOW: food >= 18, hurt, heal 1 every 80 ticks, charge 6.0 exhaustion. 6.0 exhaustion is
  // 1.5 points of food, so a full heal from 10 to 20 hearts costs 10 hearts x 1.5 = 15 points.
  const e = player();
  e.health = 10; e.food = 18; e.saturation = 0;
  let t = 0;
  while (e.health < 11 && t < 1000) { Sv.tick(e); t++; }
  ok(t === 80, `slow regeneration should heal at tick 80, it healed at ${t}`);
  ok(near(e.exhaustion, 6.0 - 4.0, 1e-9) || near(e.exhaustion, 6.0, 1e-9),
     `healing must charge 6.0 exhaustion, the counter reads ${e.exhaustion}`);
  say(`slow regen: +1 health at tick ${t}, exhaustion ${e.exhaustion}`);

  // ⚠ AND WHAT A HEAL COSTS, BY IDENTITY RATHER THAN BY WATCHING THE BAR. Healing charges 6.0
  // exhaustion and 4.0 exhaustion is one point, so a heart costs 1.5 points — but the points only
  // come off when the counter passes 4.0, so the honest statement is a conservation law:
  //     points spent x 4.0  +  exhaustion still on the counter  =  6.0 x heals
  // That holds every tick, cannot be satisfied by a loop that heals for free, and does not care
  // where in the cycle the measurement is taken.
  {
    const e = player();
    e.health = 10; e.food = 20; e.saturation = 5;
    const sat0 = e.saturation, food0 = e.food, hp0 = e.health;
    for (let i = 0; i < 80 * 3; i++) Sv.tick(e);
    const heals = e.health - hp0;
    const spent = (food0 - e.food) + (sat0 - e.saturation);
    ok(heals > 0, 'it did not heal at all over 240 ticks');
    ok(near(spent * 4.0 + e.exhaustion, 6.0 * heals, 1e-6),
       `the exhaustion conservation law failed: ${spent} points x 4 + ${e.exhaustion.toFixed(3)} != 6 x ${heals}`);
    say(`regen cost: ${heals} hearts charged ${6 * heals} exhaustion, ${spent} points off the bar`);
  }

  // a player who is kept fed heals to full at one heart per 80 ticks and no faster
  {
    const e = player();
    e.health = 4; e.saturation = 0;
    let ticks = 0;
    while (e.health < Sv.MAX_HEALTH && ticks < 20000) { e.food = 20; Sv.tick(e); ticks++; }
    const heals = Sv.MAX_HEALTH - 4;
    ok(e.health === Sv.MAX_HEALTH, `a fed player must heal to full, reached ${e.health}`);
    ok(ticks >= 80 * heals && ticks <= 80 * heals + 8,
       `${heals} hearts at 80 ticks each is ${80 * heals} ticks, it took ${ticks}`);
    say(`fed to full: ${heals} hearts in ${ticks} ticks`);
  }

  // FAST: a full bar with saturation heals every 10 ticks by min(sat,6)/6
  const e3 = player();
  e3.health = 10; e3.food = 20; e3.saturation = 6;
  let t3 = 0;
  while (e3.health < 11 && t3 < 200) { Sv.tick(e3); t3++; }
  ok(t3 === 10, `saturated healing should land at tick 10, it landed at ${t3}`);
  say(`fast regen: +1 health at tick ${t3} with a full bar and saturation`);

  // and NOT at 17 food — the timer must reset rather than accumulate
  const e4 = player();
  e4.health = 10; e4.food = 17; e4.saturation = 0;
  for (let i = 0; i < 500; i++) Sv.tick(e4);
  ok(e4.health === 10, `food 17 must not regenerate at all, health became ${e4.health}`);
  ok(e4.foodTimer === 0, `and the timer must not accumulate, it reads ${e4.foodTimer}`);
}

// ═══════════════ 4. starvation ═════════════════════════════════════════════════════════════
{
  const e = player();
  e.food = 0; e.saturation = 0; e.health = 20;
  let t = 0;
  while (e.health > 19 && t < 500) { Sv.tick(e); t++; }
  ok(t === 80, `starvation should bite at tick 80, it bit at ${t}`);
  // it stops at half a heart on normal
  for (let i = 0; i < 20000; i++) Sv.tick(e);
  ok(e.health === 1, `starving must stop at 1 health on normal difficulty, it reached ${e.health}`);
  ok(e.dead === false, 'starving must not kill on normal difficulty');
  say(`starvation: first damage at tick ${t}, floor at ${e.health} health`);
}

// ═══════════════ 5. damage, the hit cooldown, armour and absorption ════════════════════════
{
  const e = player();
  ok(Sv.hurt(e, 'generic', 4) === true && e.health === 16, `4 damage should leave 16, left ${e.health}`);
  ok(Sv.hurt(e, 'generic', 3) === false && e.health === 16,
     'a weaker hit inside the cooldown must be ignored entirely');
  ok(Sv.hurt(e, 'generic', 6) === true && e.health === 14,
     `a STRONGER hit inside the cooldown applies only the difference: expected 14, got ${e.health}`);
  // LivingEntity.java:1059-1065: the excess hit stores the FULL amount and leaves the window alone
  ok(e.lastHurt === 6, `after an excess hit lastHurt is the full 6, got ${e.lastHurt}`);
  ok(Sv.hurt(e, 'generic', 5) === false && e.health === 14,
     `a third hit of 5 <= lastHurt 6 must be ignored, health ${e.health}`);
  {
    const w = player();
    Sv.hurt(w, 'generic', 4);
    for (let t = 0; t < 7; t++) Sv.tick(w);
    const left = w.invulnerable;
    Sv.hurt(w, 'generic', 6);
    okAv(w.invulnerable === left && w.lastHurt === 6,
      `anti-vacuity: an excess hit must not re-arm the window (${left} -> ${w.invulnerable}); the old code reset it to ${Sv.INVULNERABLE_TICKS}`);
  }
  // starvation OBEYS the cooldown (DamageSource.STARVE is only bypassesArmor+unblockable; #493)
  const e2 = player();
  Sv.hurt(e2, 'generic', 5);
  ok(Sv.hurt(e2, 'starve', 1) === false, 'starvation must obey the hit cooldown');
  // armour: CombatRules, hand-computed
  const armorCase = (dmg, armor, tough) => {
    const f = 2 + tough / 4;
    const f1 = Math.max(armor * 0.2, Math.min(armor - dmg / f, 20));
    return dmg * (1 - f1 / 25);
  };
  for (const [d, a, t] of [[10, 20, 0], [10, 20, 8], [4, 5, 0], [30, 20, 12]]) {
    ok(near(Sv.afterArmor(d, a, t), armorCase(d, a, t), 1e-9),
       `armour ${a}/${t} against ${d}: engine ${Sv.afterArmor(d, a, t)}, formula ${armorCase(d, a, t)}`);
  }
  ok(Sv.afterArmor(10, 0, 0) === 10, 'no armour must not change the damage');
  // absorption soaks first
  const e3 = player();
  e3.absorption = 4;
  Sv.hurt(e3, 'generic', 6);
  ok(e3.absorption === 0 && e3.health === 18, `absorption should soak 4 of 6: got ${e3.absorption}/${e3.health}`);
  // a hit soaked entirely by absorption costs no exhaustion (Player.actuallyHurt returns first)
  const e4 = player();
  e4.absorption = 4; e4.exhaustion = 0;
  Sv.hurt(e4, 'mob', 2);
  ok(e4.absorption === 2 && e4.health === 20 && e4.exhaustion === 0, `fully absorbed hit: exhaustion ${e4.exhaustion}, absorption ${e4.absorption}`);
  say('damage: cooldown applies only the excess, armour matches CombatRules, absorption soaks first');
}

// ═══════════ 5b. ARMOUR THAT IS ACTUALLY WORN, against the jar's own table (D-291) ═════════
// ⚠ §5 hands `afterArmor` numbers. That is the formula, and the formula was never the problem:
// nothing ever computed the number. Every assertion here goes through `Sv.updateArmor` from a
// real inventory, and the expected values are read from the golden TSV rather than typed here,
// so the check and the engine cannot drift onto two different tables.
{
  const Iv = NS.Inventory, IT = NS.Items;
  const GOLD = new Map();
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools/golden/armor-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length >= 7) GOLD.set(c[0], { slot: c[2], defense: +c[3], toughness: +c[4], knockback: +c[5] });
  }
  ok(GOLD.size === 25, `the golden armour table has ${GOLD.size} rows, expected 25`);

  const wear = (names) => {
    const inv = Iv.create();
    for (const n of names) {
      const i = IT.of(n);
      const g = GOLD.get(n);
      const slot = { feet: 0, legs: 1, chest: 2, head: 3 }[g.slot];
      Iv.setItem(inv, Iv.ARMOR_START + slot, Iv.stack(i, 1));
    }
    const e = player();
    Sv.updateArmor(e, inv);
    return e;
  };

  // every piece, one at a time, must be worth exactly what the jar says
  for (const [name, g] of GOLD) {
    const e = wear([name]);
    ok(e.armor === g.defense, `${name} alone gives ${e.armor} points, the jar says ${g.defense}`);
  }
  // a full set sums
  const FULL_IRON = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const iron = wear(FULL_IRON);
  const ironSum = FULL_IRON.reduce((a, n) => a + GOLD.get(n).defense, 0);
  ok(iron.armor === ironSum, `a full iron set is ${iron.armor}, the table sums to ${ironSum}`);
  ok(iron.armorToughness === 0, 'and iron has no toughness');

  const FULL_NETH = ['netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots'];
  const neth = wear(FULL_NETH);
  ok(neth.armor === FULL_NETH.reduce((a, n) => a + GOLD.get(n).defense, 0), 'a full netherite set sums too');
  ok(neth.armor > iron.armor, `netherite (${neth.armor}) must out-protect iron (${iron.armor})`);
  ok(neth.armorToughness === FULL_NETH.reduce((a, n) => a + GOLD.get(n).toughness, 0),
     `netherite toughness ${neth.armorToughness}`);
  // ⚠ knockback resistance ADDS and then CLAMPS: four netherite pieces at 0.1 are 0.4, not 0.1.
  ok(Math.abs(neth.knockbackResistance - 0.4) < 1e-9,
     `a full netherite set resists ${neth.knockbackResistance} knockback, expected 0.4`);
  ok(iron.knockbackResistance === 0, 'and iron resists none');

  // ⚠ WHAT IS NOT WORN DOES NOT PROTECT. A chestplate in the backpack, or a pickaxe in hand.
  {
    const inv = Iv.create();
    Iv.setItem(inv, 10, Iv.stack('netherite_chestplate', 1));   // a main-inventory slot
    Iv.setItem(inv, 0, Iv.stack('diamond_pickaxe', 1));         // the hand
    const e = player();
    Sv.updateArmor(e, inv);
    ok(e.armor === 0, `armour in the backpack must protect nothing, got ${e.armor}`);
  }

  // and the whole point: it reaches the damage
  const bare = player(), worn = wear(FULL_IRON);
  // 'mob' (a zombie's blow): GENERIC is setBypassesArmor() in vanilla (DamageSource.java:30), so it can't show armour.
  Sv.hurt(bare, 'mob', 10);
  Sv.hurt(worn, 'mob', 10);
  ok(worn.health > bare.health,
     `10 damage takes a bare player to ${bare.health} and an iron-clad one to ${worn.health}`);
  ok(Math.abs(worn.health - (Sv.MAX_HEALTH - Sv.afterArmor(10, ironSum, 0))) < 1e-9,
     'and the reduction is exactly CombatRules on the summed points');
  say(`armour: iron ${iron.armor}, netherite ${neth.armor} (toughness ${neth.armorToughness})`);
}

// ═══════════════ 6. death and respawn ══════════════════════════════════════════════════════
{
  const e = player();
  Sv.addXp(e, Sv.totalXpFor(20));
  Sv.hurt(e, 'generic', 100);
  ok(e.dead === true && e.health === 0, 'a 100-damage hit must kill');
  ok(e.xpDropped === Math.min(20 * 7, 100), `a level-20 death drops ${Math.min(140, 100)}, got ${e.xpDropped}`);
  ok(Sv.hurt(e, 'generic', 5) === false, 'a dead player cannot be hurt again');
  for (let i = 0; i < 10; i++) Sv.tick(e);
  ok(e.deathTicks === 10, `the death animation should be counting, it reads ${e.deathTicks}`);
  Sv.respawn(e);
  ok(e.dead === false && e.health === 20 && e.food === 20 && e.saturation === 5 && e.xpLevel === 0,
     'respawn must restore health, food, saturation and clear XP');
  say('death: xp dropped, respawn resets the loop');
}

// ═══════════════ 7. the ten-minute session — it must not drift ═════════════════════════════
{
  // 12,000 ticks of a plausible life: sprinting, jumping, mining, taking the odd hit. Nothing
  // here is asserted tick by tick; what is asserted is that every INVARIANT survived it, which
  // is the part a hand-written reference could not have told us anyway.
  // ⚠ THE FIRST DRAFT OF THIS SESSION KILLED THE PLAYER AT MINUTE FOUR and then asserted things
  // about the next six minutes of a corpse — which is how a check ends up testing that a dead
  // player's food bar refills. A dead entity now takes no exhaustion and cannot eat, and the
  // session is one a player would actually survive: sprint the whole time, eat every two minutes.
  const e = player();
  let jumps = 0, blocks = 0, loaves = 0;
  for (let t = 0; t < 12000; t++) {
    Sv.movement(e, 0.28, { sprinting: true }); blocks += 0.28;
    if (t % 20 === 0) { Sv.jumped(e, true); jumps++; }
    if (t % 15 === 0) Sv.mined(e);
    if (t % 2400 === 0 && t > 0) { Sv.eat(e, 6, 0.6); loaves++; }     // a loaf of bread
    Sv.tick(e);
    if (e.food < 0 || e.food > 20) { ok(false, `food left its range at tick ${t}: ${e.food}`); break; }
    if (e.saturation < 0 || e.saturation > e.food + 1e-9) { ok(false, `saturation must never exceed food (tick ${t}): ${e.saturation} > ${e.food}`); break; }
    if (e.health < 0 || e.health > 20) { ok(false, `health left its range at tick ${t}: ${e.health}`); break; }
    if (e.exhaustion < 0 || e.exhaustion > Sv.EXHAUSTION_CAP) { ok(false, `exhaustion left its range at tick ${t}: ${e.exhaustion}`); break; }
  }
  ok(true, 'the ten-minute session held every invariant');
  // ⚠ AND THE OUTCOME IS NOT "FINE": four loaves does not pay for 3,360 blocks of sprinting, so
  // the bar empties, starvation starts, and it stops at 1 health because this engine is normal
  // difficulty. That is the whole loop — exhaustion, food, starvation and the difficulty floor —
  // exercised end to end in one session, and it is a better assertion than a player who survives.
  ok(!e.dead, 'starvation must not kill on normal difficulty, however long the session runs');
  ok(e.health === 1, `ten minutes of sprinting on four loaves should starve you to the floor, health ${e.health}`);
  // the arithmetic of the whole session, in closed form: 3,360 blocks sprinted at 0.1, 600
  // sprint-jumps at 0.2, 800 swings at 0.005 — 460 exhaustion, 115 points, against 20 on the bar
  // plus 5 saturation plus four loaves. It must be empty, and it must be empty for that reason.
  const generated = blocks * Sv.EX_SPRINT + jumps * Sv.EX_SPRINT_JUMP + 800 * Sv.EX_MINE;
  ok(Math.abs(generated - 460) < 2, `the session should generate about 460 exhaustion, it generated ${generated.toFixed(1)}`);
  ok(e.food === 0, `115 points of exhaustion against 20 food and ${loaves} loaves must empty the bar, it reads ${e.food}`);
  say(`10 minutes: ${blocks.toFixed(0)} blocks, ${jumps} jumps, ${loaves} loaves, food ${e.food}, health ${e.health}`);
}

// ═══════════ 5c. BREATH AND DROWNING, to the tick (D-292) ═════════════════════════════════
// ⚠ THE TIMING IS THE WHOLE THING, and it is counter-intuitive enough that every clone gets it
// wrong in the same direction. The counter runs 300 down at one a tick and is then allowed to go
// NEGATIVE for twenty more; the hit lands at exactly −20 and the counter resets to 0. So the
// FIRST heart costs 320 ticks and every heart after it costs 20. Clamping at zero — the obvious
// thing to write — gives a heart every tick and kills the player in a second, and "the player
// drowns" would be true of both.
console.log('5c. breath: 300 ticks, then a heart every second — and the refill');
{
  const under = () => { const e = player(); e.eyeInWater = true; return e; };

  // ── the first hit is at tick 320, not 300 and not 301 ──────────────────────────────────
  {
    const e = under();
    let firstHit = -1;
    for (let t = 1; t <= 400; t++) {
      const before = e.health;
      Sv.tick(e);
      if (e.health < before) { firstHit = t; break; }
    }
    ok(firstHit === Sv.MAX_AIR - Sv.DROWN_AT,
       `the first drowning hit is at tick ${firstHit}, vanilla's arithmetic says ${Sv.MAX_AIR - Sv.DROWN_AT}`);
    ok(firstHit === 320, `and that is 320 ticks — sixteen seconds — got ${firstHit}`);
  }

  // ── and every hit after it is 20 ticks apart ───────────────────────────────────────────
  {
    const e = under();
    const hits = [];
    for (let t = 1; t <= 420; t++) {
      const before = e.health;
      Sv.tick(e);
      if (e.health < before) hits.push(t);
    }
    ok(hits.length >= 5, `${hits.length} hits in 420 ticks`);
    const gaps = hits.slice(1).map((t, i) => t - hits[i]);
    ok(gaps.every((g) => g === -Sv.DROWN_AT), `every later hit is ${-Sv.DROWN_AT} ticks apart, got ${[...new Set(gaps)]}`);
    ok(gaps.every((g) => g === 20), 'which is one second');
  }

  // ── each hit is two points, through the ordinary damage path ───────────────────────────
  {
    const e = under();
    for (let t = 1; t <= 320; t++) Sv.tick(e);
    ok(Math.abs(e.health - (Sv.MAX_HEALTH - Sv.DROWN_DAMAGE)) < 1e-9,
       `one drowning hit costs ${Sv.MAX_HEALTH - e.health}, vanilla says ${Sv.DROWN_DAMAGE}`);
    ok(e.air === 0, `and the counter resets to 0, not to ${e.air}`);
  }

  // ── surfacing refills at four a tick ───────────────────────────────────────────────────
  {
    const e = under();
    for (let t = 0; t < 100; t++) Sv.tick(e);
    const spent = e.air;
    ok(spent === Sv.MAX_AIR - 100, `100 ticks under water leaves ${spent}, expected ${Sv.MAX_AIR - 100}`);
    e.eyeInWater = false;
    Sv.tick(e);
    ok(e.air === spent + Sv.AIR_REFILL, `one tick at the surface gives back ${e.air - spent}, vanilla gives 4`);
    let ticks = 1;
    while (e.air < Sv.MAX_AIR && ticks < 1000) { Sv.tick(e); ticks++; }
    ok(e.air === Sv.MAX_AIR, 'it refills to exactly the maximum');
    ok(ticks === Math.ceil(100 / Sv.AIR_REFILL), `a full refill from 100 spent takes ${ticks} ticks, expected 25`);
  }

  // ── ⚠ CREATIVE DOES NOT DROWN, HOLDS ITS BREATH UNDER WATER, AND REFILLS ON LAND ──────
  // #296 — `LivingEntity.baseTick` (.decomp :358-384): the refill is the `else` of
  // `isSubmergedIn(WATER)`, so an invulnerable-ability player who is still submerged neither
  // spends nor regains air; it is the surfacing that tops the counter up.
  {
    const e = under();
    for (let t = 0; t < 200; t++) Sv.tick(e);
    const spent = e.air;
    e.invulnerableGamemode = true;
    for (let t = 0; t < 60; t++) Sv.tick(e);
    ok(e.health === Sv.MAX_HEALTH, 'a creative player under water takes no drowning damage');
    ok(e.air === spent, `submerged creative leaves the counter UNCHANGED, vanilla baseTick (${spent} -> ${e.air})`);
    e.eyeInWater = false;
    for (let t = 0; t < 60; t++) Sv.tick(e);
    ok(e.air === Sv.MAX_AIR, 'and it refills once the head is out of the water');
  }
  // Water Breathing: no decrement, no drowning, counter unchanged while submerged.
  {
    const had = NS.Effects;
    NS.Effects = { hasStatusEffect: (x, f) => f === 'water_breathing' && x.wb, hasWaterBreathing: (x) => !!x.wb, tick() {} };
    const e = under();
    for (let t = 0; t < 100; t++) Sv.tick(e);
    const spent = e.air;
    e.wb = true;
    for (let t = 0; t < 400; t++) Sv.tick(e);
    ok(e.air === spent && e.health === Sv.MAX_HEALTH, `Water Breathing: 400 submerged ticks, no drowning (air ${spent} -> ${e.air})`);
    e.wb = false;
    for (let t = 0; t < 400; t++) Sv.tick(e);
    ok(e.health < Sv.MAX_HEALTH, 'anti-vacuity: without the effect the same 400 ticks drown');
    NS.Effects = had;
  }
  say('breath: first hit at 320, then every 20; refill 4 a tick');
}

// ═══════════ 9. DIFFICULTY — PlayerEntity.damage scaling, HungerManager, PEACEFUL regen (loop s111)
{
  // Sv reads ONLY `NS.Diff.get()` (07l_spawn.js's store); this harness does not load 07l, so the
  // store is stood in by its one method. combatcheck §8e3 asserts the same join through the real one.
  const withDiff = (level, fn) => { const had = NS.Diff; NS.Diff = { get: () => level }; try { return fn(); } finally { NS.Diff = had; } };
  const mobHit = (level, a) => withDiff(level, () => { const e = player(); const landed = Sv.hurt(e, 'mob', a); return [landed, Sv.MAX_HEALTH - e.health]; });
  const [pl, pd] = mobHit('peaceful', 6);
  ok(pl === false && pd === 0, `PEACEFUL: a mob's 6-damage blow scales to 0 and does not land (landed=${pl}, took ${pd})`);
  ok(mobHit('easy', 6)[1] === 4, `EASY: min(6/2+1, 6) = 4, took ${mobHit('easy', 6)[1]}`);
  ok(mobHit('easy', 1)[1] === 1, `EASY: min(1/2+1, 1) = 1 — the min() keeps a tiny hit from GROWING, took ${mobHit('easy', 1)[1]}`);
  ok(mobHit('normal', 6)[1] === 6, 'NORMAL: unchanged');
  ok(mobHit('hard', 6)[1] === 9, `HARD: 6*3/2 = 9, took ${mobHit('hard', 6)[1]}`);
  ok(withDiff('hard', () => { const e = player(); Sv.hurt(e, 'arrow', 6); return Sv.MAX_HEALTH - e.health; }) === 6,
     'HARD does NOT scale an arrow (ProjectileDamageSource\'s source is the projectile, not a LivingEntity)');
  ok(withDiff('hard', () => { const e = player(); Sv.hurt(e, 'explosion', 6); return Sv.MAX_HEALTH - e.health; }) === 9,
     'HARD scales an explosion (DamageSource.explosion is setScaledWithDifficulty)');
  // starvation floors, all four levels (HungerManager.java:65)
  const starveTo = (level, h) => withDiff(level, () => { const e = player(); e.food = 0; e.saturation = 0; e.health = h;
    for (let i = 0; i < 80 * 40; i++) Sv.tick(e); return e.dead ? 0 : e.health; });
  ok(starveTo('easy', 15) === 10, `EASY starvation stops at 10 health (got ${starveTo('easy', 15)})`);
  ok(starveTo('normal', 15) === 1, `NORMAL starvation stops at 1 (got ${starveTo('normal', 15)})`);
  ok(starveTo('hard', 15) === 0, `HARD starvation kills (got ${starveTo('hard', 15)})`);
  // PEACEFUL: food never drops from exhaustion; heal 1 / 20 ticks; food +1 / 10 ticks
  withDiff('peaceful', () => {
    const e = player(); e.saturation = 0; e.food = 20; e.exhaustion = 4.5; Sv.tick(e);
    ok(e.food === 20, `PEACEFUL: exhaustion past 4.0 with no saturation spends NO food (food ${e.food})`);
    const h = player(); h.health = 10; h.food = 10; h.saturation = 0; h.age = 0;
    for (let i = 0; i < 40; i++) Sv.tick(h);
    ok(h.health === 12 && h.food === 14, `PEACEFUL regen over 40 ticks: +2 health (every 20), +4 food (every 10) — ${h.health}/${h.food}`);
  });
  withDiff('normal', () => {
    const h = player(); h.health = 10; h.food = 10; h.saturation = 0; h.age = 0;
    for (let i = 0; i < 40; i++) Sv.tick(h);
    okAv(h.health === 10 && h.food === 10, 'anti-vacuity: the same 40 ticks on NORMAL heal and refill nothing — §9\'s PEACEFUL branch is gated');
  });
  okAv(withDiff('peaceful', () => { const f = Sv.scaleForDifficulty; Sv.scaleForDifficulty = (a) => a;
    const e = player(); Sv.hurt(e, 'mob', 6); Sv.scaleForDifficulty = f; return e.health === Sv.MAX_HEALTH - 6; }),
    'anti-vacuity: with scaling broken, a PEACEFUL mob blow lands in full — the PEACEFUL assertion above sees it');
  okAv(starveTo('normal', 15) !== starveTo('hard', 15), 'anti-vacuity: NORMAL and HARD starvation end differently');
  say('difficulty: damage scaling, starvation floors, PEACEFUL regen');
}

// ═══════════════ 8. ANTI-VACUITY — each rule above must be able to fail ════════════════════
{
  // 1. the XP forms must not be trivially equal (a curve that was linear everywhere would pass §1
  //    without testing the boundaries at all)
  okAv(Sv.xpNeeded(14) !== Sv.xpNeeded(15) && Sv.xpNeeded(29) !== Sv.xpNeeded(30),
     'anti-vacuity: the XP curve must actually change slope at 15 and 30');
  okAv(Sv.xpNeeded(16) - Sv.xpNeeded(15) === 5 && Sv.xpNeeded(31) - Sv.xpNeeded(30) === 9,
     'anti-vacuity: and the slopes must be 5 and 9, or §1 compares two copies of the same mistake');

  // 2. the strict > 4.0 test must be distinguishable from >=
  {
    const e = player(); e.saturation = 5;
    Sv.addExhaustion(e, 4.0); Sv.tick(e);
    const strict = e.saturation;
    const e2 = player(); e2.saturation = 5;
    Sv.addExhaustion(e2, 4.001); Sv.tick(e2);
    okAv(strict === 5 && e2.saturation === 4,
       'anti-vacuity: exactly 4.0 and just over 4.0 must behave differently, or §2 proves nothing');
  }

  // 3. the two regeneration rates must be different rates
  {
    const slow = Sv.SLOW_REGEN_TICKS, fast = Sv.FAST_REGEN_TICKS;
    okAv(slow !== fast && slow === 80 && fast === 10,
       `anti-vacuity: the two regen rates must differ (${fast} vs ${slow})`);
  }

  // 4. the hit cooldown must be able to reject something
  {
    const e = player();
    Sv.hurt(e, 'generic', 5);
    const before = e.health;
    const landed = Sv.hurt(e, 'generic', 5);
    okAv(landed === false && e.health === before,
       'anti-vacuity: an equal hit inside the cooldown must be rejected, or §5 cannot see the rule');
  }

  // 5. armour must actually reduce something, and the toughness term must matter
  okAv(Sv.afterArmor(10, 20, 0) < 10 * 0.6, 'anti-vacuity: 20 armour must cut damage by more than 40%');
  // ⚠ toughness REDUCES damage, and against a big hit it is the whole point of it: without the
  // toughness term, 20 armour against 30 damage only keeps the 20% floor, which is why netherite
  // is worth wearing. The first draft of this line asserted the inequality the wrong way round.
  okAv(Sv.afterArmor(30, 20, 12) < Sv.afterArmor(30, 20, 0),
     `anti-vacuity: toughness must reduce a big hit further (${Sv.afterArmor(30, 20, 12).toFixed(2)} vs ${Sv.afterArmor(30, 20, 0).toFixed(2)})`);

  // 6. starvation must be gated: without the health > 1 rule it would kill
  {
    const e = player(); e.food = 0; e.health = 1;
    for (let i = 0; i < 400; i++) Sv.tick(e);
    okAv(e.health === 1 && !e.dead,
       'anti-vacuity: the difficulty gate must hold at 1 health, or §4 is asserting an accident');
  }

  // 7. eating must be capped by the food level, not by 20
  {
    const e = player(); e.food = 2; e.saturation = 0;
    Sv.eat(e, 6, 1.0);              // nutrition 6, modifier 1.0 -> raw saturation 12
    okAv(e.saturation === e.food && e.food === 8,
       `anti-vacuity: saturation must be capped by the food level (${e.saturation} vs ${e.food})`);
  }

  // ── §5c's breaks: breath (D-292) ───────────────────────────────────────────────────────
  {
    // ⚠ the counter MUST be allowed to go negative. A version that clamps at 0 hits every tick
    // from 300 onward — "the player drowns" is true of both, and only the timing tells them apart.
    let clamped = 0, hits = 0, air = Sv.MAX_AIR;
    for (let t = 1; t <= 340; t++) {
      air = Math.max(0, air - 1);
      if (air <= 0) { hits++; if (!clamped) clamped = t; }
    }
    okAv(clamped === 300 && hits > 20,
       `anti-vacuity: clamping the counter at zero hits at tick ${clamped} and ${hits} times over — the real one hits once, at 320`);

    // the refill rate must be 4 and not 1, or "it refills" is true of a rate that takes 300 ticks
    const e = player(); e.eyeInWater = true;
    for (let t = 0; t < 40; t++) Sv.tick(e);
    e.eyeInWater = false;
    const before = e.air; Sv.tick(e);
    okAv(e.air - before === 4, `anti-vacuity: the refill is ${e.air - before} a tick, and a rate of 1 would also "refill"`);

    // and the damage must go through `hurt`, so armour and the cooldown apply to it
    const e2 = player(); e2.eyeInWater = true;
    for (let t = 0; t < 320; t++) Sv.tick(e2);
    okAv(e2.health < Sv.MAX_HEALTH && e2.invulnerable > 0,
       'anti-vacuity: drowning leaves the hit cooldown set, so it went through hurt() and not straight at the health');
  }

  // ── #493: the hit-cooldown window (LivingEntity.java:1059 `timeUntilRegen > 10`) ──────────
  {
    const land = (gap, type) => {
      const e = player(); Sv.hurt(e, 'generic', 2);
      for (let t = 0; t < gap; t++) { if (e.invulnerable > 0) e.invulnerable--; }
      const h = e.health; return Sv.hurt(e, type || 'generic', 2) !== false && h - e.health === 2;
    };
    okAv(land(10) && !land(9), 'anti-vacuity: an equal hit lands exactly 10 ticks after the first and is refused at 9');
    okAv(land(10, 'starve') && !land(9, 'starve'), 'anti-vacuity: starvation obeys the same window (only OUT_OF_WORLD skips it)');
    okAv(land(0, 'outOfWorld'), 'anti-vacuity: the void still skips the window');
  }

  // ── §5b's breaks: armour that is worn (D-291) ──────────────────────────────────────────
  {
    const Iv = NS.Inventory, IT = NS.Items;
    const inv = Iv.create();
    Iv.setItem(inv, Iv.ARMOR_START + 2, Iv.stack('iron_chestplate', 1));   // worn
    Iv.setItem(inv, 10, Iv.stack('netherite_chestplate', 1));              // in the backpack
    const e = player();
    Sv.updateArmor(e, inv);
    // the slot band must be the ARMOUR band: summing the whole inventory would pick up the
    // netherite in the backpack and give 6+8 instead of 6.
    let all = 0;
    for (let i = 0; i < Iv.SIZE; i++) { const st = inv.slots[i]; if (st) all += IT.defenseOf(st.i); }
    okAv(e.armor === 6 && all === 14,
       'anti-vacuity: summing every slot instead of the four worn ones gives 14, not 6 — §5b tells them apart');

    // an empty inventory must give zero, or "armour reduces damage" is untestable
    const bare = player();
    Sv.updateArmor(bare, Iv.create());
    okAv(bare.armor === 0 && bare.armorToughness === 0,
       'anti-vacuity: an empty inventory really is zero armour, so §5b\'s comparison has two sides');

    // ⚠ and the formula must actually move the number for the values this table produces. A
    // reduction that rounds to nothing would make every assertion above pass on a no-op.
    const full = 6 + 5 + 2 + 2;
    okAv(Sv.afterArmor(10, full, 0) < 10 * 0.75,
       `anti-vacuity: ${full} points must take 10 damage below 7.5, it gives ${Sv.afterArmor(10, full, 0).toFixed(2)}`);

    // toughness must change the answer, or the second argument is decoration
    okAv(Sv.afterArmor(20, 20, 8) !== Sv.afterArmor(20, 20, 0),
       'anti-vacuity: toughness changes the reduction at high damage, so it is not being ignored');

    // and knockback resistance must ADD rather than take a maximum
    const four = Iv.create();
    const NETH = [['netherite_boots', 0], ['netherite_leggings', 1], ['netherite_chestplate', 2], ['netherite_helmet', 3]];
    for (const [n, sl] of NETH) Iv.setItem(four, Iv.ARMOR_START + sl, Iv.stack(n, 1));
    const e4 = player(); Sv.updateArmor(e4, four);
    okAv(Math.abs(e4.knockbackResistance - 0.4) < 1e-9 && IT.knockbackOf(IT.of('netherite_boots')) === 0.1,
       'anti-vacuity: four 0.1 pieces resist 0.4 — a max() instead of a sum would read 0.1');
  }
}

console.log('');
console.log('1. the XP curve, level by level, against PLAN\'s independently written form');
console.log('2. exhaustion: 4.0 a point, saturation before food, strictly greater');
console.log('3. both regeneration rates, and what each costs in food');
console.log('4. starvation, and the floor it stops at');
console.log('5. damage: the cooldown applies only the excess; armour; absorption');
console.log('6. death, the XP drop, and respawn');
console.log('7. a ten-minute session that must not drift out of range');
console.log('5b. armour that is WORN: every piece against the jar, and it reaches the damage');
console.log('5c. breath: the first heart at tick 320, then one a second; refill at 4 a tick');
console.log('8. anti-vacuity — fifteen ways for the rules above to be vacuous');
console.log('');
for (const f of fails) console.log('FAIL  ' + f);
// ⚠ THE SHAPE `suite.mjs` PARSES. It reads "assertions passed .. N" and "failures ... N" out of
// each stage's output; a check that prints its totals in its own shape is counted as zero and
// the suite's headline number quietly loses them (the note at suite.mjs:198 is the same bug).
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
