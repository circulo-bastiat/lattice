#!/usr/bin/env node
// handcheck.mjs — PLAN G10. The swing, the attack cooldown, and the ten crack stages.
//
//   node tools/handcheck.mjs [--quiet]
//
// ⚠ THIS FILE EXISTS BECAUSE THE HAND IS ALL EDGE CASES AND NONE OF THEM IS VISIBLE IN A
// SCREENSHOT. A swing is six ticks; whether a second click during one starts a new swing, whether
// the counter starts at -1 or 0, and whether the crack stage clamps at 9 or 10 are four separate
// decisions, each wrong in a way that looks like "the animation feels slightly off" and that no
// rendering test can name. They are arithmetic, so they are tested as arithmetic.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ASSETS = join(ROOT, 'assets');
const QUIET = process.argv.includes('--quiet');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };

const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02g_items.js', '14f_inventory.js', '07q_effects.js', '14i_hand.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
NS.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rd('items.meta.json').rawBytes });
const H = NS.Hand, Inv = NS.Inventory;
// ⚠ D-271 IS PAID (D-335): the attribute table is read from the SAME golden file `gen-data`
// inlines, rather than from a copy typed here. A check that carries its own copy of a table is
// the thing D-305 is about.
{
  const tsv = readFileSync(join(ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8');
  const table = {};
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  H.bindAttrs(table);
}
const player = {};
// #296 — the REAL effect-store shape (07q_effects.js): `amplifier` is level − 1.
const fx = (name, amp) => ({ effects: { [name]: NS.Effects.instance(name, 200, amp) } });

console.log('handcheck — PLAN G10, the hand (D-270, D-271, D-272)');

// ═══════════ 1. the swing is six ticks ════════════════════════════════════════════════════
say('\n1. the swing');
H.reset();
ok(H.swingDuration(player) === 6, 'a swing is six ticks');
ok(H.swingDuration(fx('haste', 0)) === 5, 'haste I makes it five');
ok(H.swingDuration(fx('haste', 1)) === 4, 'haste II makes it four');
ok(H.swingDuration(fx('conduit_power', 0)) === 5, 'conduit power counts as haste I (#533)');
{ const both = { effects: { haste: NS.Effects.instance('haste', 200, 0), conduit_power: NS.Effects.instance('conduit_power', 200, 1) } };
  ok(H.swingDuration(both) === 4, 'the larger of haste and conduit amplifier wins'); }
{ const cf = { effects: { conduit_power: NS.Effects.instance('conduit_power', 200, 0), mining_fatigue: NS.Effects.instance('mining_fatigue', 200, 1) } };
  ok(H.swingDuration(cf) === 5, 'conduit beats fatigue'); }
// ⚠ THE TWO ARE NOT SYMMETRIC: fatigue adds (1 + amplifier) * 2, haste subtracts (1 + amplifier).
ok(H.swingDuration(fx('mining_fatigue', 0)) === 8, 'mining fatigue I makes it EIGHT, not seven');
ok(H.swingDuration(fx('mining_fatigue', 1)) === 10, 'and fatigue II makes it ten');
ok(H.swingDuration(fx('conduit_power', 1)) === 4, 'conduit power II swings like haste II (StatusEffectUtil.hasHaste)');

H.reset();
ok(H.swing(player, 0) === true, 'the first click starts a swing');
// ⚠ swingTime IS -1 UNTIL THE FIRST TICK. Starting at 0 drops the first frame of every swing.
ok(H.swingTime === -1, 'and swingTime starts at -1, not 0');
ok(H.swinging === true, 'and the hand is swinging');
const seen = [];
// ⚠ the RAW values, not rounded ones: rounding to four places here made the 5/6 assertion fail
// against a 1e-6 tolerance, which is a test measuring its own display format rather than the code.
for (let t = 0; t < 8; t++) { H.tickSwing(player); seen.push(H.attackAnim); }
say('   attackAnim over eight ticks: ' + seen.map((v) => v.toFixed(4)).join(' '));
ok(seen[0] === 0, 'the first tick draws the swing at 0/6');
ok(Math.abs(seen[5] - 5 / 6) < 1e-6, 'the sixth tick draws it at 5/6');
ok(seen[6] === 0 && seen[7] === 0, 'and it is over by the seventh');
ok(H.swinging === false, 'the hand has stopped swinging');

// ⚠ THE HALFWAY RULE: a second click before the halfway point is SWALLOWED.
H.reset();
H.swing(player, 0);
H.tickSwing(player);           // swingTime 0
ok(H.swing(player, 0) === false, 'a click one tick into a swing does NOT restart it');
H.tickSwing(player); H.tickSwing(player);   // swingTime 2
ok(H.swingTime === 2, 'the swing is two ticks in');
ok(H.swing(player, 0) === false, 'and two ticks in is still too early (duration/2 is 3)');
H.tickSwing(player);
ok(H.swingTime === 3, 'the swing is three ticks in');
ok(H.swing(player, 0) === true, 'at the halfway point the next click DOES restart it');
ok(H.swingTime === -1, 'and the restart sets swingTime back to -1');

// ═══════════ 2. the attack cooldown ═══════════════════════════════════════════════════════
say('\n2. the attack cooldown');
H.reset();
const bare = Inv.EMPTY;
ok(H.attackSpeedFor(bare) === 4.0, 'a bare hand swings at the base attack speed of 4.0');
ok(Math.abs(H.attackStrengthDelay(bare) - 5) < 1e-9, 'which is a five-tick cooldown');
ok(H.attackStrengthScale(bare) === 0, 'and the scale is 0 the moment you swing');
for (let i = 0; i < 3; i++) H.tickAttackStrength();
ok(Math.abs(H.attackStrengthScale(bare) - 0.6) < 1e-9, 'three ticks later it is 0.6');
for (let i = 0; i < 5; i++) H.tickAttackStrength();
ok(H.attackStrengthScale(bare) === 1, 'and it clamps at 1, it does not keep climbing');
H.resetAttackStrength();
ok(H.attackStrengthScale(bare) === 0, 'swinging resets it');
ok(H.attackStrengthScale(bare, 0.5) === 0.1, 'and the partial tick interpolates it');

// ═══════════ 1b. the swing COUNTER, which is what a check outside the loop can see ════════
// ⚠⚠ A SWING IS SIX TICKS AND NOTHING OUTSIDE THE PAGE CAN SEE IT (D-339). A headless browser
// draws about four frames a second with the loop catching up twenty ticks a frame, so by the time
// `inputcheck` can look, a correct swing is already over — D-321's lesson in a new costume. A
// COUNTER survives. ⚠ It must be monotonic, which means `H.reset()` must NOT clear it: a counter
// that the thing under test can zero is not evidence.
say('\n1b. the swing counter');
{
  H.reset();
  const n0 = H.swings;
  H.swing(player, 0);
  ok(H.swings === n0 + 1, `a swing that STARTS increments the counter (${n0} -> ${H.swings})`);
  // ⚠ AND A SWING THAT IS SWALLOWED MUST NOT. The halfway-restart rule refuses a second swing in
  // the first half of the first, and a counter that ticked anyway would report swings nobody saw.
  H.tickSwing(player);
  const n1 = H.swings;
  const took = H.swing(player, 0);
  ok(took === false && H.swings === n1,
     `a swing swallowed by the halfway rule does not count (${n1} -> ${H.swings})`);
  // ...and once past halfway it does
  for (let i = 0; i < 4; i++) H.tickSwing(player);
  const n2 = H.swings;
  ok(H.swing(player, 0) === true && H.swings === n2 + 1, 'past halfway a new swing counts again');
  const n3 = H.swings;
  H.reset();
  ok(H.swings === n3,
     `H.reset() must NOT clear the counter (${n3} -> ${H.swings}) — a counter the subject can ` +
     'zero is not evidence');
}

// ═══════════ 2b. the per-item attributes — D-271, PAID (D-335) ═══════════════════════════
// ⚠⚠ THIS SECTION USED TO ASSERT THE ABSENCE OF ITS OWN SUBJECT. For fourteen sessions
// `H.attackSpeedTable` was null, so the check printed "NOT BOUND" and asserted that a diamond
// sword reported the BASE speed — the honest way to carry a debt, and also fourteen sessions in
// which a sword and a feather were the same weapon. The table is bound now and the branch that
// tolerated its absence is DELETED (D-139), not left behind an `if`.
say('\n2b. the per-item attack attributes');
{
  ok(H.attrCount === 30, `the attribute table has ${H.attrCount} rows; the jar's tool roster is 30`);
  const s = (n) => Inv.stack(n, 1);
  const spd = (n) => H.attackSpeedFor(s(n)), dmg = (n) => H.attackDamageFor(s(n));
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(near(spd('diamond_sword'), 1.6), `a diamond sword swings at ${spd('diamond_sword')}; vanilla is 1.6`);
  ok(near(H.attackStrengthDelay(s('diamond_sword')), 12.5),
     `which is a ${H.attackStrengthDelay(s('diamond_sword'))}-tick cooldown; vanilla is 12.5`);
  ok(near(dmg('diamond_sword'), 7), `a diamond sword hits for ${dmg('diamond_sword')}; vanilla is 7`);
  ok(near(dmg('netherite_sword'), 8) && near(dmg('wooden_sword'), 4),
     'netherite and wooden swords are 8 and 4');
  ok(near(dmg('diamond_axe'), 9) && near(spd('diamond_axe'), 1.0),
     `a diamond axe is ${dmg('diamond_axe')} at ${spd('diamond_axe')}/s; vanilla is 9 at 1.0`);
  ok(near(dmg('diamond_hoe'), 1) && near(spd('diamond_hoe'), 4),
     'a diamond hoe is 1 damage at the base 4.0 — the fastest weapon in the game and the worst');
  // ⚠ AN EMPTY HAND AND AN UNLISTED ITEM ARE THE SAME THING, AND THAT IS THE POINT OF AN
  // EXCEPTION TABLE. Most of the 1,100 items carry no modifier at all.
  ok(near(spd(''), 4.0) || near(H.attackSpeedFor(Inv.EMPTY), 4.0), 'an empty hand swings at 4.0');
  ok(near(H.attackDamageFor(Inv.EMPTY), 1.0), 'and hits for 1.0');
  ok(near(spd('feather'), 4.0) && near(dmg('feather'), 1.0),
     'a feather is not in the table, so it is a bare hand');
  ok(near(spd('stone_sword'), 1.6) && near(dmg('stone_sword'), 5),
     'a stone sword is 5 damage at 1.6/s');
  // and the cooldown really is three times longer with a sword than with a fist
  const bareDelay = H.attackStrengthDelay(Inv.EMPTY), swordDelay = H.attackStrengthDelay(s('diamond_sword'));
  say(`   cooldown ........ empty hand ${bareDelay} ticks, diamond sword ${swordDelay} ticks`);
  ok(swordDelay > bareDelay * 2,
     `a sword's cooldown (${swordDelay}) must be much longer than a fist's (${bareDelay})`);
}

// ═══════════ 3. the ten crack stages ══════════════════════════════════════════════════════
say('\n3. the breaking overlay');
ok(H.STAGES === 10, 'there are ten crack stages');
ok(H.stageFor(0) === -1, 'no progress is no stage at all');
ok(H.stageFor(-1) === -1, 'and neither is negative progress');
ok(H.stageFor(0.05) === 0, '5% is stage 0');
ok(H.stageFor(0.15) === 1, '15% is stage 1');
ok(H.stageFor(0.95) === 9, '95% is stage 9');
// ⚠ THE CLAMP IS AT 9. Progress reaches exactly 1.0 on the tick the block breaks, and `10` would
// index past the last texture for one frame — a flash of nothing at the end of every block.
ok(H.stageFor(1.0) === 9, 'and 100% is still stage 9, not 10');
ok(H.stageFor(1.5) === 9, 'and so is anything past it');
const tiles = [];
for (let i = 0; i < 10; i++) tiles.push(H.stageTile(i));
ok(tiles.every((t, i) => t === 'block/destroy_stage_' + i),
  'each stage names its own tile, BARE like every other atlas key (D-280)');
ok(tiles.every((t) => t.indexOf('minecraft:') < 0),
  'and none of them carries the redundant "minecraft:" prefix that tilecheck refuses');
ok(H.stageTile(-1) === null && H.stageTile(10) === null, 'and out-of-range stages name nothing');

// the atlas really has them (D-270) — the model walk cannot reach these, they are forced by name
const idx = rd('atlas-index.json');
const have = Object.keys(idx.index || idx).filter((n) => n.indexOf('destroy_stage') >= 0);
ok(have.length === 10, `the atlas carries ${have.length} destroy-stage tiles, expected 10`);
for (let i = 0; i < 10; i++) {
  ok(have.indexOf('block/destroy_stage_' + i) >= 0, `destroy_stage_${i} is in the atlas`);
}

// the overlay only rebuilds when it changes
H.reset();
ok(H.tickBreaking(42, 0.05) === true, 'starting to break a block changes the overlay');
ok(H.tickBreaking(42, 0.06) === false, 'more progress inside the same stage does NOT');
ok(H.tickBreaking(42, 0.15) === true, 'crossing into the next stage does');
ok(H.tickBreaking(43, 0.15) === true, 'and so does moving to a different block at the same stage');
ok(H.stopBreaking() === true, 'letting go clears it');
ok(H.crackStage === -1 && H.crackKey === -1, 'and nothing is being broken');
ok(H.stopBreaking() === false, 'letting go twice changes nothing the second time');

// ═══════════ 4. hit particles — D-272's declared cadence is DELETED (D-659) ═══════════════
// Vanilla spawns one `addBlockBreakingParticles` on every tick the swing does
// (MinecraftClient.java:1471-1473) — `Player.act`'s swing loop now does both, and the 4-tick
// stand-in must not come back (rule 5). particlecheck §13 owns the particle itself.
say('\n4. hit particles');
ok(H.tickHitParticles === undefined && H.HIT_PARTICLE_TICKS === undefined && H.hitParticleTimer === undefined,
   'the D-272 four-tick hit-particle cadence is gone (D-659 rides the swing tick)');

// ═══════════ 5. anti-vacuity ══════════════════════════════════════════════════════════════
say('\n5. anti-vacuity: break it, and it must be caught');
{
  // the halfway rule must be load-bearing — an unconditional restart would pass §1's first half
  H.reset(); H.swing(player, 0); H.tickSwing(player);
  const swallowed = H.swing(player, 0) === false;
  okAv(swallowed, 'a mid-swing click really is swallowed, so §1 is not testing an unconditional restart');

  // the -1 must be load-bearing: with 0, the first drawn frame would be 1/6 rather than 0
  H.reset(); H.swing(player, 0);
  const startsAtMinusOne = H.swingTime === -1;
  H.tickSwing(player);
  okAv(startsAtMinusOne && H.attackAnim === 0, 'the -1 start is what puts the first frame at 0/6');

  // the clamp must be load-bearing: without it stageFor(1.0) would be 10
  okAv(H.stageFor(1.0) === 9 && (1.0 * 10 | 0) === 10, 'the clamp is what stops stage 10 existing');

  // haste and fatigue must move the duration in OPPOSITE directions and by different amounts
  const d0 = H.swingDuration({}), dh = H.swingDuration(fx('haste', 0)),
    df = H.swingDuration(fx('mining_fatigue', 0));
  okAv(dh < d0 && df > d0 && (d0 - dh) !== (df - d0),
    'haste and fatigue are asymmetric — a symmetric formula would pass neither');

  // the cooldown must actually depend on the delay
  H.reset();
  const savedAttrs = H.attrs, savedCount = H.attrCount;
  // ⚠ WITH THE TABLE EMPTIED, THE SWORD MUST FALL BACK TO THE BASE — not to 0, not to NaN.
  H.bindAttrs({});
  const fallback = H.attackStrengthDelay({ i: NS.Items.of('diamond_sword'), n: 1, d: 0 });
  const fdmg = H.attackDamageFor({ i: NS.Items.of('diamond_sword'), n: 1, d: 0 });
  H.bindAttrs(savedAttrs);
  okAv(fallback === 5 && fdmg === 1.0,
       'an item missing from the attribute table uses the base 4.0/1.0, not a table miss of 0');
  // ...and with it bound, the sword must NOT be the base — otherwise §2b proves nothing
  okAv(H.attackStrengthDelay({ i: NS.Items.of('diamond_sword'), n: 1, d: 0 }) !== 5 &&
       H.attrCount === savedCount,
       'and with the table bound the sword is no longer the base — §2b is reading the table');

  // the overlay must not report a change when nothing changed
  H.reset(); H.tickBreaking(1, 0.5);
  okAv(H.tickBreaking(1, 0.5) === false, 'the overlay reports no change when nothing changed');
}

console.log('');
console.log('================ handcheck =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log(` attack attributes .. ${H.attrCount} items (D-271, paid in D-335)`);
console.log('===========================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
