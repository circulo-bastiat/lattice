#!/usr/bin/env node
// kbrefcheck.mjs — infra W (25 Sept 2026): KNOCKBACK vs the real 1.18.2 server (golden: runkb.mjs,
// knockback.json; scenarios: kbscen.mjs). D-685 ("i dont think anything takes knockback") fixed
// `Cb.knockback`/`Cb.baseKnockback`, src/14j_combat.js:277-335 -- this check proves the fix's
// resulting VELOCITY (not health, not a boolean) matches the real server component-for-component.
//
// (A) mob hits player -- `Cb.mobAttack(mob, M.Player)` (src/14j_combat.js:839), the engine's real
// mob-strikes-a-player entry, exactly runmelee.mjs/meleerefcheck.mjs's twin for damage.
// (B) player hits mob -- `Cb.attack(P, mob)` (src/14j_combat.js:718), the engine's real
// player-attacks-entity entry (found by `grep -n 'Cb.attack = function' src/14j_combat.js`).
// Neither velocity is recomputed by hand here (D-331/D-329) -- the field read after the call IS
// the finding.
//
// ⚠ D-327 YAW: engine yaw 0 = north, vanilla yaw 0 = south -- OPPOSITE zero references for the SAME
// physical direction, so the SAME real-world facing is `engineYaw = vanillaYaw + 180deg`.
// runkb.mjs's own real-server geometry (both directions): the mob/target sits at bot.x + OFFSET
// (east); the attacking side is given an explicit vanilla yaw that faces the other side. Mirrored
// here: mob's engine yaw faces west (physical) = vanilla 90deg -> engine -90deg (-PI/2); the
// player's engine yaw faces east (physical) = vanilla -90deg -> engine 90deg (PI/2).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { BOT_ARMOR, BOT_ARMOR_TIERS, ATTACKERS, WEAPONS, TARGETS, OFFSET } from './kbscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'knockback.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'knockback.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('kbrefcheck: SKIP (golden not generated -- run node tools/referee/runkb.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
    '07d_mining.js', '07e_loot.js', '07i_entitylist.js', '07y_equip.js', '07m_breed.js', '07w_passive.js',
    '07q_effects.js', '14d_survival.js', '14j_combat.js', '07zk_undead.js', '07zs_spawner.js', '07zzf_piglin.js',
    '07k_goals.js', '07zf_bat.js', '07zzg_hoglin.js', '07zd_slime.js', '07l_spawn.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'],
  initReg: true,
});
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const w = { get: () => 0, set: () => {}, getLight: () => 0, tickingAt: () => true };
w.getBlock = w.get; w.setBlock = w.set;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = () => null;
M.Physics.solidAt = () => false;
M.EntityList.init(); M.Equip.init(); M.Breed.init(); M.Passive.init();
M.Player.init();
const { EntityList: EL, Items: IT, Equip: Eq, Survival: Sv, Inventory: Iv, Combat: Cb, Gamemode: Gm } = M;
const P = M.Player;
Gm.set(P, Gm.SURVIVAL); // creative is invulnerableGamemode -- same guard meleerefcheck.mjs's header explains

const YAW_MOB_FACES_WEST = -Math.PI / 2;  // vanilla 90deg + 180deg (D-327) -- see file header
// ⚠ NOT simply "vanilla_yaw + 180deg" here -- `Cb.attack`'s own enchant-knockback branch (kdx=sin(y),
// kdz=-cos(y), NO negation) and `Cb.mobAttack`'s (kdx=-sin(y), kdz=cos(y), NEGATED -- that function's
// own header explains why) are opposite conventions BY DESIGN (mirroring vanilla's own asymmetry
// between `PlayerEntity`'s and `MobEntity`'s knockback call sites) -- the D-327 translation that gave
// the correct sign for the MOB's yaw in scenario A does NOT carry over unchanged to the PLAYER's yaw
// here. Verified empirically against the real server's own (kb-enchant, unambiguous) sign: -PI/2 is
// the value that reproduces the real server's "mob pushed AWAY from the player" direction.
const YAW_PLAYER_FACES_EAST = -Math.PI / 2;

function equipBotArmor(tier) {
  const pieces = BOT_ARMOR[tier];
  for (let i = 0; i < 4; i++) Iv.setItem(P.inventory, Iv.ARMOR_START + i, Iv.EMPTY);
  for (const it of pieces) {
    const slot = it.endsWith('boots') ? 0 : it.endsWith('leggings') ? 1 : it.endsWith('chestplate') ? 2 : 3;
    Iv.setItem(P.inventory, Iv.ARMOR_START + slot, { i: IT.of(it), n: 1 });
  }
  Sv.updateArmor(P, P.inventory);
}

function engineA(atk, tier) {
  EL.list.length = 0;
  Sv.init(P);
  P.x = 0; P.y = 64; P.z = 0; P.vx = 0; P.vy = 0; P.vz = 0; P.onGround = true;
  equipBotArmor(tier);
  const e = EL.spawn(atk.mob, OFFSET, 64, 0);
  if (!e) return { err: `EL.spawn gives nothing for ${atk.mob}` };
  e.persistent = true; e.onGround = true; e.yaw = YAW_MOB_FACES_WEST;
  const hit = Cb.mobAttack(e, P);
  return { hit, vx: P.vx || 0, vy: P.vy || 0, vz: P.vz || 0, err: null };
}

function engineB(w, tgt) {
  EL.list.length = 0;
  Sv.init(P);
  P.x = 0; P.y = 64; P.z = 0; P.onGround = true; P.yaw = YAW_PLAYER_FACES_EAST;
  P.sprinting = !!w.sprint; P.fallDistance = 0; P.walkDist = 0; P.walkDistO = 0;
  const st = w.item ? { i: IT.of(w.item), n: 1 } : Iv.EMPTY;
  // ⚠ `stack.t.Enchantments` (NOT a `.ench` shorthand -- `Cb.enchantList`, src/14j_combat.js:216-217,
  // reads `stack.t.Enchantments`; `07y_equip.js:539` is the same shape's own writer).
  if (w.kb) st.t = { Enchantments: [{ id: 'minecraft:knockback', lvl: w.kb }] };
  Iv.setItem(P.inventory, P.slot || 0, st);
  const e = EL.spawn(tgt.mob, OFFSET, 64, 0);
  if (!e) return { err: `EL.spawn gives nothing for ${tgt.mob}` };
  e.persistent = true; e.onGround = true; e.vx = 0; e.vy = 0; e.vz = 0;
  e.knockbackResistance = tgt.kbRes;
  // s145: a FULL-strength blow, as the server's (each rep is far more than one cooldown apart) -- the pmeleerefcheck recipe.
  // Without it the charge is empty and `full` (the > 0.9 gate the sprint bonus needs) is false.
  M.Hand.attackStrengthTicker = 1000;
  const result = Cb.attack(P, e);
  return { result, vx: e.vx || 0, vy: e.vy || 0, vz: e.vz || 0, err: null };
}

const reds = [];
let pass = 0, compared = 0;
const skipped = [];
const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
// ⚠ (A)'s CAPTURE IS NOT THE RAW POST-`takeKnockback` INSTANT (found running this pack for real):
// the Set Entity Velocity packet is whatever the tracker broadcasts at the END of the SAME server
// tick, i.e. AFTER that tick's own `LivingEntity.travel()` drag has already run once. The
// HORIZONTAL component's one-tick decay is a real, decomp-cited, EMPIRICALLY CONFIRMED constant --
// `this.onGround ? slipperiness*0.91F : 0.91F` (.decomp LivingEntity.java:2122), and this world's
// every flat-preset block is grass (slipperiness 0.6): 0.6*0.91 = 0.546. Checked against three
// independent shapes (zombie/husk/vindicator@none: -0.400 raw -> -0.2184 observed, exactly
// 0.400*0.546; the compound ravager case: -0.950 raw -> -0.519 observed, exactly 0.950*0.546;
// @netherite: 0.24 raw -> 0.131 observed) -- not a guessed fudge factor, a cited one, gating the RED
// comparison below (A only -- B no longer needs it, see `cmpB`). The VERTICAL component's own decay
// did NOT resolve to one clean constant in the time this pass had (compare zombie's 0.4 raw ->
// 0.2751 observed vs. the compound ravager's 0.95-clamped-to-0.4 raw -> 0.3135 observed -- the SAME
// clamped raw value decaying to two DIFFERENT numbers, meaning the mob-attack-cooldown timing
// changes how many ticks elapse before broadcast) -- it is printed for every A case (real data, not
// hidden) but does NOT gate red/green there either.
const HORIZ_DECAY = 0.6 * 0.91; // decomp LivingEntity.java:2122, this world's grass slipperiness 0.6
const TOL = 0.03; // block/tick, on the DECAY-CORRECTED horizontal magnitude only (see header)
function cmp(key, side, g, e, notes) {
  if (e.err) return [`${side} ${key}: ${e.err}`];
  const gx = avg(g.vx), gy = avg(g.vy), gz = avg(g.vz);
  if (gx === null) return null; // server itself never captured a value -- SKIP (still_owed), not red
  // the MEDIAN OF EACH REP'S MAGNITUDE, not the magnitude of the mean vector: a wide attacker (iron_golem) strikes from
  // a different angle each rep, and averaging the components first shrank its 8 reps of exactly 0.218 to 0.186. A
  // median, because a rep that caught the bot still moving reads HIGHER than one clean hit can (spider@none, 8 reps:
  // six at 0.218, one 0.225, one 0.259) -- one such rep must not move the verdict.
  const mags = g.vx.map((x, i) => Math.hypot(x, (g.vz && g.vz[i]) || 0));
  // fewer than 5 reps (spider@none: 3, 0.288/0.218/0.265): a median is just a noisy rep, and noise only reads HIGH -> take the min
  const gMag = mags.length < 5 ? Math.min(...mags) : median(mags);
  const eMagRaw = Math.hypot(e.vx, e.vz);
  const eMagDecayed = eMagRaw * HORIZ_DECAY;
  const info = `server h=${gMag.toFixed(3)} v=(${gx.toFixed(3)},${gy.toFixed(3)},${gz.toFixed(3)}), ` +
    `engine RAW h=${eMagRaw.toFixed(3)} v=(${e.vx.toFixed(3)},${e.vy.toFixed(3)},${e.vz.toFixed(3)}) ` +
    `-> decay-corrected h=${eMagDecayed.toFixed(3)}${notes ? '  (' + notes + ')' : ''}`;
  if (Math.abs(gMag - eMagDecayed) > TOL) return [`${side} ${key}: ${info}`];
  return [];
}

// ── Part C (infra W, 25 Sept 2026): hoglin/zoglin's randomised push, as a real DISTRIBUTION
// compare instead of the "owed a distribution comparison" skip this file used to print. Decomp
// (`Hoglin.knockback`, .decomp net/minecraft/entity/mob/Hoglin.java:31-42): horizontal magnitude
// is `d * (nextFloat()*0.5 + 0.2)` (d = ATTACK_KNOCKBACK 1.0 minus the target's own resistance)
// turned by `rotateY(nextInt(21) - 10)` -- an INTEGER passed straight into a RADIANS parameter
// (real vanilla quirk, ±10 RADIANS spans more than a full turn, so the push direction is
// effectively uniform on the circle), vertical is `d * nextFloat() * 0.5`, and BOTH are ADDED
// (`addVelocity`, not `takeKnockback`) on top of the mob's own base 0.4 knockback from
// `LivingEntity.damage()` -- so neither component's raw distribution is a clean closed form to
// hand-derive, this pack samples the engine's own `Cb.mobAttack` the SAME number of times the real
// server was sampled and runs a two-sample KS test (`ks`, below -- same asymptotic-D formula
// `mobrefattrcheck.mjs` already uses, `ks`/`P_FAIL` copied from there) instead.
//
// Both components need a per-tick DECAY correction before the KS test is fair (the golden samples
// are the broadcast packet, one server tick after the raw impulse, same as the point-cmp cases
// above) -- the HORIZONTAL constant is the SAME cited 0.546 (`HORIZ_DECAY`) used everywhere else in
// this file. The VERTICAL constant is NOT universal (this file's own header, above) but IS the
// same multiplicative factor for both engine and server samples of the SAME mob in the SAME run,
// so it is derived EMPIRICALLY here as `mean(server vy) / mean(engine raw vy)` -- legitimate
// because the engine's own `Hg.knockback` (src/07zzg_hoglin.js) is a line-for-line transcription of
// the decomp above (verified by inspection, not by this factor) and its RAW distribution is
// therefore the right yardstick for the decay, the same logic that produced 0.546 in the first
// place, just per-mob instead of universal.
const P_FAIL = 1e-5; // same threshold mobrefattrcheck.mjs uses for its own two-sample KS gate
function ks(a, b) {
  const R5 = (v) => Math.round(v * 1e5) / 1e5;
  a = a.map(R5).sort((x, y) => x - y); b = b.map(R5).sort((x, y) => x - y);
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    const v = Math.min(a[i], b[j]);
    while (i < a.length && a[i] <= v) i++;
    while (j < b.length && b[j] <= v) j++;
    d = Math.max(d, Math.abs(i / a.length - j / b.length));
  }
  const ne = a.length * b.length / (a.length + b.length);
  const lam = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  let q = 0;
  for (let k = 1; k <= 100; k++) q += 2 * (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * lam * lam);
  return { d, p: Math.min(1, Math.max(0, lam < 0.2 ? 1 : q)) };
}
const median = (xs) => { const s = xs.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function cmpADist(key, atk, tier, g) {
  const n = (g.vx || []).length;
  if (!n) return null; // server itself never captured a value -- SKIP, not red (same rule as `cmp`)
  const realH = g.vx.map((x, i) => Math.hypot(x, g.vz[i]));
  const realVy = g.vy.slice();
  const engHRaw = [], engVyRaw = [];
  for (let i = 0; i < n; i++) {
    const e = engineA(atk, tier);
    if (e.err) return [`A ${key}: ${e.err}`];
    engHRaw.push(Math.hypot(e.vx, e.vz));
    engVyRaw.push(e.vy);
  }
  const engHDecayed = engHRaw.map((v) => v * HORIZ_DECAY);
  const vyDecay = avg(realVy) / (avg(engVyRaw) || 1e-9); // empirical, per-mob (see header above)
  const engVyDecayed = engVyRaw.map((v) => v * vyDecay);
  const rH = ks(engHDecayed, realH);
  const rV = ks(engVyDecayed, realVy);
  const bad = [];
  if (rH.p < P_FAIL) {
    bad.push(`A ${key}: horizontal-magnitude KS D=${rH.d.toFixed(3)} p=${rH.p.toExponential(1)} ` +
      `(n=${n}) engine decay-corrected median ${median(engHDecayed).toFixed(3)} vs server median ${median(realH).toFixed(3)}`);
  }
  if (rV.p < P_FAIL) {
    bad.push(`A ${key}: vy KS D=${rV.d.toFixed(3)} p=${rV.p.toExponential(1)} (n=${n}) engine ` +
      `decay~${vyDecay.toFixed(3)}-corrected median ${median(engVyDecayed).toFixed(3)} vs server median ${median(realVy).toFixed(3)}`);
  }
  if (VERBOSE) console.log(`  A ${key} [dist n=${n}] horiz D=${rH.d.toFixed(3)} p=${rH.p.toExponential(1)}, vy D=${rV.d.toFixed(3)} p=${rV.p.toExponential(1)} (decay~${vyDecay.toFixed(3)})`);
  return bad;
}

// ── B: tick-exact (infra W, 25 Sept 2026) ──────────────────────────────────────────────────────
// `runkb.mjs`'s datapack logs the target's Motion every tick (runchase.mjs's own pattern); which
// logged tick is "the tick of the hit" is not assumed from timing, it is FOUND from the data: the
// hit is the one tick within the settle window whose horizontal |Motion| jumps by a wide margin
// over the previous tick (a sudden `Cb.knockback` impulse, not the mob's own gradual AI-walk
// acceleration) -- MIN_JUMP/MIN_MAG below are chosen well under the smallest scenario in kbscen.mjs
// (bare-hand vs. ravager's 0.75 resistance: raw 0.4*0.25 = 0.1) and well over an idle zombie's own
// per-tick walk delta (checked empirically: never above ~0.01 in this pack's logs). Once found, the
// logged sample AT that tick is compared RAW-to-RAW against the engine's `Cb.attack`/`Cb.knockback`
// result -- NO decay correction, because that tick's log write is BEFORE the SAME tick's own
// `LivingEntity.travel()` has run (`runchase.mjs`'s own convention: entry i = state after i world
// ticks, so the entry that FIRST shows the jump is the state the impulse produced, pre-drag) --
// confirmed empirically: iron_sword_kb1->zombie's own jump-tick average landed at h=0.697 against
// this file's `engineB` raw h=0.700 (0.4% apart, inside TOL_B), and the FOLLOWING tick decayed by
// exactly the `HORIZ_DECAY` (0.546) constant above -- the one-tick-later drag this file already
// knew about, now dated to the right tick instead of guessed at ~2-3 of them.
const MIN_MAG = 0.05, MIN_JUMP = 0.05; // block/tick -- see comment above
const TOL_B = 0.03;
function findHitTick(series, maxWindow) {
  let best = -1, bestJump = 0;
  for (let i = 1; i < Math.min(series.length, maxWindow); i++) {
    const prevMag = Math.hypot(series[i - 1][0], series[i - 1][2]);
    const mag = Math.hypot(series[i][0], series[i][2]);
    const jump = mag - prevMag;
    if (mag > MIN_MAG && jump > MIN_JUMP && jump > bestJump) { bestJump = jump; best = i; }
  }
  return best;
}
function cmpB(key, g, e) {
  if (e.err) return [`B ${key}: ${e.err}`];
  const hits = [];
  for (const series of g.series || []) {
    const i = findHitTick(series, Math.min(series.length, 12));
    if (i >= 0) hits.push(series[i]);
  }
  if (!hits.length) return null; // no rep's own attack packet registered a clean hit -- SKIP, not red
  const gx = avg(hits.map((h) => h[0])), gy = avg(hits.map((h) => h[1])), gz = avg(hits.map((h) => h[2]));
  const gMag = Math.hypot(gx, gz);
  const eMagRaw = Math.hypot(e.vx, e.vz);
  const info = `server (tick-exact, ${hits.length}/${(g.series || []).length} reps hit) h=${gMag.toFixed(3)} ` +
    `v=(${gx.toFixed(3)},${gy.toFixed(3)},${gz.toFixed(3)}), engine RAW h=${eMagRaw.toFixed(3)} ` +
    `v=(${e.vx.toFixed(3)},${e.vy.toFixed(3)},${e.vz.toFixed(3)})`;
  if (Math.abs(gMag - eMagRaw) > TOL_B) return [`B ${key}: ${info}`];
  return [];
}

console.log(`kbrefcheck — knockback vs the real 1.18.2 server (${Object.keys(golden.casesA || {}).length} A-cases, ${Object.keys(golden.casesB || {}).length} B-cases, ${golden.generatedAt})`);
const ENG_A = {}, ENG_B = {};
for (const [key, g] of Object.entries(golden.casesA || {})) {
  const atk = ATTACKERS.find((a) => a.id === g.mob);
  if (!atk) { skipped.push(key + ' (unknown attacker)'); continue; }
  // Part C (infra W, 25 Sept 2026): hoglin/zoglin's randomised push (Hoglin.knockback) is now a
  // real KS distribution compare (`cmpADist`, above) instead of a skip.
  if (atk.special === 'random-push') {
    const bad = cmpADist(key, atk, g.armor, g);
    if (bad === null) { skipped.push('A ' + key); continue; }
    compared++;
    if (bad.length) reds.push(...bad); else pass++;
    continue;
  }
  const e = engineA(atk, g.armor);
  ENG_A[key] = e;
  // iron_golem's horizontal component is the SAME base-0.4 push every other mob gets (its own
  // `special` is the VERTICAL add only, checked separately below by the none/netherite ratio) --
  // this point-cmp is a real horizontal-magnitude comparison for it too, not a "known gap" skip.
  const bad = cmp(key, 'A', g, e, atk.special === 'vertical-throw' ? 'horizontal only -- vertical throw checked below' : undefined);
  if (bad === null) { skipped.push('A ' + key); continue; }
  compared++;
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  A ${key}`, e);
}
// Part C -- iron_golem's own vertical throw (`IronGolemEntity.tryAttack`, .decomp
// net/minecraft/entity/passive/IronGolemEntity.java:211: `setVelocity(getVelocity().add(0.0,
// 0.4F, 0.0))`), UNCONDITIONAL and added AFTER `LivingEntity.damage()`'s own base-0.4 knockback
// has already run (and already clamped the bot's vy to `min(0.4, vy/2+strength)`, same as any
// other mob) -- so raw vy = min(0.4, 0.4*(1-kbRes)) + 0.4: 0.8 @none (kbRes 0), 0.64 @netherite
// (kbRes 0.4, 4 pieces * 0.1 -- kbscen.mjs's own BOT_ARMOR comment). Unlike the BASE component,
// this second add is a plain velocity add, NOT run through `takeKnockback`, so it is NOT scaled by
// the bot's knockback resistance -- armour changes the base term only, giving a decomp-predicted
// none/netherite raw-vy RATIO of 0.64/0.8 = 0.8. This file's own header already says the vertical
// component's one-tick decay is NOT one universal constant -- but it IS the same multiplicative
// factor for both armour tiers of the SAME mob (decay depends on the ATTACKER's own swing timing,
// not the target's armour), so the RATIO of the two tiers' observed (decayed) vy cancels the
// unknown decay factor out and needs no guessed constant at all.
const GOLEM_NONE = 'iron_golem@none', GOLEM_NETHER = 'iron_golem@netherite';
const TOL_GOLEM_VY_RATIO = 0.12; // ratio units, generous around the decomp-predicted 0.8 (see above)
function golemVyRatioCheck(gNoneIn, gNetherIn, eNone, eNether) {
  if (!gNoneIn || !gNetherIn || !eNone || eNone.err || !eNether || eNether.err) return null;
  const rNone = avg(gNoneIn.vy), rNether = avg(gNetherIn.vy);
  if (!rNone || !rNether) return null;
  const realRatio = rNether / rNone;
  const engRatio = eNether.vy / eNone.vy;
  const info = `A iron_golem vertical-throw ratio (none/netherite): server ${realRatio.toFixed(3)} vs engine ` +
    `${engRatio.toFixed(3)} (decomp-expected 0.800; server raw vy none=${rNone.toFixed(3)} netherite=${rNether.toFixed(3)}, ` +
    `engine raw vy none=${eNone.vy.toFixed(3)} netherite=${eNether.vy.toFixed(3)})`;
  return { bad: Math.abs(realRatio - engRatio) > TOL_GOLEM_VY_RATIO ? [info] : [], info };
}
{
  const r = golemVyRatioCheck(golden.casesA[GOLEM_NONE], golden.casesA[GOLEM_NETHER], ENG_A[GOLEM_NONE], ENG_A[GOLEM_NETHER]);
  if (r === null) { skipped.push('A iron_golem vertical-throw ratio (missing none/netherite data)'); }
  else {
    compared++;
    if (r.bad.length) reds.push(`A iron_golem@vertical-throw: ${r.info}`); else pass++;
    if (VERBOSE) console.log('  ' + r.info);
  }
}
for (const [key, g] of Object.entries(golden.casesB || {})) {
  const w = WEAPONS.find((x) => x.id === g.weapon);
  const tgt = TARGETS.find((x) => x.id === g.target);
  if (!w || !tgt) { skipped.push(key + ' (unknown weapon/target)'); continue; }
  const e = engineB(w, tgt);
  ENG_B[key] = { vx: e.vx, vy: e.vy, vz: e.vz, err: e.err };
  const bad = cmpB(key, g, ENG_B[key]);
  if (bad === null) { skipped.push('B ' + key); continue; }
  compared++;
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  B ${key}`, e);
}
for (const r of reds) console.log('  ✗ ' + r);
if (skipped.length) console.log(`  (server itself never captured a value, not compared: ${skipped.join(', ')})`);

let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
{ // break 1: shift a golden A vx by 0.1 block/tick (well past TOL) -- must flip green to red
  const key = Object.keys(golden.casesA || {}).find((k) => (golden.casesA[k].vx || []).length);
  if (key) {
    const g = JSON.parse(JSON.stringify(golden.casesA[key]));
    // x2, not +0.5: a +0.5 shift flips a -0.22 vx to +0.28, a magnitude the per-rep compare barely sees.
    g.vx = g.vx.map((v) => v * 2); g.vz = g.vz.map((v) => v * 2);
    const before = cmp(key, 'A', golden.casesA[key], ENG_A[key]);
    const after = cmp(key, 'A', g, ENG_A[key]);
    brk('golden A horizontal push x2', (before || []).join() !== (after || []).join());
  } else brk('golden A horizontal push x2 (no A case with data to shift)', false);
}
{ // break 2: zero the ENGINE's own knockback (Cb.KNOCKBACK_BASE) -- a currently-green B case (bare
  // hand, no resistance) must turn red. This is the D-685 regression itself, reproduced live.
  const key = Object.keys(golden.casesB || {}).find((k) => golden.casesB[k].weapon === 'hand' && golden.casesB[k].kbRes === 0 && (golden.casesB[k].series || []).length);
  if (key) {
    const saved = Cb.KNOCKBACK_BASE;
    Cb.KNOCKBACK_BASE = 0;
    const w = WEAPONS.find((x) => x.id === 'hand'), tgt = TARGETS.find((x) => x.id === 'zombie');
    const e2 = w && tgt ? engineB(w, tgt) : { vx: 0, vy: 0, vz: 0 };
    Cb.KNOCKBACK_BASE = saved;
    const before = cmpB(key, golden.casesB[key], ENG_B[key]);
    const after = cmpB(key, golden.casesB[key], e2);
    brk('Cb.KNOCKBACK_BASE forced to 0 (the D-685 regression, reproduced)', (before || []).length === 0 && (after || []).length > 0);
  } else brk('Cb.KNOCKBACK_BASE forced to 0 (no bare-hand/no-resistance B case with data)', false);
}
{
  // s145 (SPRINT KNOCKBACK): the engine run as if the bot were NOT sprinting on iron_sword_sprint->zombie must turn it red --
  // proves the sprint scenes see the +1 knockback level at all (the first run of them, with an uncharged attack, did not).
  const key = 'iron_sword_sprint->zombie';
  if (golden.casesB && golden.casesB[key] && (golden.casesB[key].series || []).length) {
    const w = Object.assign({}, WEAPONS.find((x) => x.id === 'iron_sword_sprint'), { sprint: false }), tgt = TARGETS.find((x) => x.id === 'zombie');
    const before = cmpB(key, golden.casesB[key], ENG_B[key]);
    const after = cmpB(key, golden.casesB[key], engineB(w, tgt));
    brk('sprint dropped from iron_sword_sprint->zombie', (before || []).length === 0 && (after || []).length > 0);
  } else brk('sprint dropped (no iron_sword_sprint->zombie case with data)', false);
}
{ // break 3: force the engine's own resulting vz by +0.1 -- must turn a currently-green case red
  const key = Object.keys(golden.casesA || {}).find((k) => (golden.casesA[k].vz || []).length && reds.every((r) => !r.startsWith(`A ${k}:`)));
  if (key) {
    const bumped = Object.assign({}, ENG_A[key], { vz: (ENG_A[key].vz || 0) + 0.5 });
    const before = cmp(key, 'A', golden.casesA[key], ENG_A[key]);
    const after = cmp(key, 'A', golden.casesA[key], bumped);
    brk('engine A vz forced +0.5', (before || []).length === 0 && (after || []).length > 0);
  } else brk('engine A vz forced +0.5 (no clean green A case to bump)', false);
}
{ // break 4 (infra W, tick-exact): shift a golden B case's OWN hit-tick sample by +0.5 -- exercises
  // `cmpB`'s series/`findHitTick` path specifically (breaks 1-3 never touch it), must flip green to red.
  const key = Object.keys(golden.casesB || {}).find((k) => cmpB(k, golden.casesB[k], ENG_B[k]) && cmpB(k, golden.casesB[k], ENG_B[k]).length === 0);
  if (key) {
    const g = JSON.parse(JSON.stringify(golden.casesB[key]));
    for (const series of g.series) {
      const i = findHitTick(series, Math.min(series.length, 12));
      if (i >= 0) series[i][0] += 0.5;
    }
    const before = cmpB(key, golden.casesB[key], ENG_B[key]);
    const after = cmpB(key, g, ENG_B[key]);
    brk('golden B hit-tick sample +0.5 (tick-exact path)', (before || []).length === 0 && (after || []).length > 0);
  } else brk('golden B hit-tick sample +0.5 (no clean green B case)', false);
}
{ // break 5 (Part C, infra W): iron_golem's own vertical-throw RATIO check -- with a SYNTHETIC
  // "correct engine" (engine ratio pinned to the server's own, so the assertion starts green
  // regardless of whatever the real engine measured), shifting the golden netherite vy by +0.5
  // must flip it to red. Decoupled from the real engine's own result on purpose -- this exercises
  // the CHECK, not today's finding.
  const gN = golden.casesA[GOLEM_NONE], gT = golden.casesA[GOLEM_NETHER];
  if (gN && gT && avg(gN.vy) && avg(gT.vy)) {
    const realRatio = avg(gT.vy) / avg(gN.vy);
    const fakeEng = { none: { vy: 1, err: null }, nether: { vy: realRatio, err: null } }; // engRatio === realRatio
    const before = golemVyRatioCheck(gN, gT, fakeEng.none, fakeEng.nether);
    const gT2 = JSON.parse(JSON.stringify(gT)); gT2.vy = gT2.vy.map((v) => v + 0.5);
    const after = golemVyRatioCheck(gN, gT2, fakeEng.none, fakeEng.nether);
    brk('iron_golem vertical-throw ratio (golden netherite vy +0.5, synthetic correct-engine baseline)',
      before && before.bad.length === 0 && after && after.bad.length > 0);
  } else brk('iron_golem vertical-throw ratio (no none/netherite data to break)', false);
}
{ // break 6 (Part C, infra W): the hoglin/zoglin KS harness itself -- a golden sample shifted by a
  // wide margin against ITSELF must be rejected (self-vs-self is p=1 by construction; this is
  // strictly a check on `ks()`, independent of whether today's engine push passes or fails it).
  const hgKey = Object.keys(golden.casesA || {}).find((k) => {
    const a = ATTACKERS.find((x) => x.id === golden.casesA[k].mob);
    return a && a.special === 'random-push' && (golden.casesA[k].vx || []).length >= 5;
  });
  if (hgKey) {
    const g = golden.casesA[hgKey];
    const realH = g.vx.map((x, i) => Math.hypot(x, g.vz[i]));
    const before = ks(realH, realH).p;             // identical samples -> p = 1
    const shifted = realH.map((v) => v + 2.0);      // well outside this scenario's own push range
    const after = ks(shifted, realH).p;
    brk('hoglin/zoglin KS harness (self vs. +2.0-shifted self)', before >= P_FAIL && after < P_FAIL);
  } else brk('hoglin/zoglin KS harness (no hoglin/zoglin A-case with >=5 reps)', false);
}

console.log(`kbrefcheck: ${pass}/${compared} scenarios match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
