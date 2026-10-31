#!/usr/bin/env node
// effectenvcheck.mjs — #296 (G23d): the status effects that change what the WORLD does to an
// entity. Against .decomp:
//   LivingEntity.damage          `isFire() && hasStatusEffect(FIRE_RESISTANCE)` -> false (:1032)
//   LivingEntity.baseTick        `!canBreatheInWater && !StatusEffectUtil.hasWaterBreathing`
//                                gates the air counter; when it is false the air is HELD (:358-384)
//   StatusEffectUtil             hasHaste / getHasteAmplifier / hasWaterBreathing (conduit power)
//   PlayerEntity.getBlockBreakingSpeed   the haste multiplier + mining fatigue's switch (:706-737)
// The break-tick expectations are re-derived here in float from the Java's own constants
// (fatigue's switch arms are PARSED from PlayerEntity.java), never read back from 07d_mining.js.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) console.log('   ✓ break caught: ' + m); else fails.push('anti-vacuity: ' + m); };
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const dec = (f) => readFileSync(join(MCLITE_ROOT, '.decomp', f), 'utf8');

console.log('effectenvcheck — #296 (G23d), fire resistance / water breathing + conduit power / haste + mining fatigue');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07d_mining.js', '07q_effects.js',
  '14d_survival.js', '14j_combat.js', '14i_hand.js', '14_player.js'], dom: true });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const ES = M.Effects, Sv = M.Survival, P = M.Player, Mi = M.Mining, Cb = M.Combat, R = M.Reg;
ok(ES && Sv && P && Mi && Mi.ready && Cb, 'Effects / Survival / Player / Mining(ready) / Combat loaded');
const fr = Math.fround;
const give = (e, name, amp) => ES.addStatusEffect(e, name, 600, amp);

// ── 0. the Java this is checked against says what we think it says ──────────────────────────
const LE = dec('net/minecraft/entity/LivingEntity.java');
const PE = dec('net/minecraft/entity/player/PlayerEntity.java');
const DS = dec('net/minecraft/entity/damage/DamageSource.java');
const SU = dec('net/minecraft/entity/effect/StatusEffectUtil.java');
ok(/\$\$0\.isFire\(\) && this\.hasStatusEffect\(StatusEffects\.field_5918\)\) \{\s*return false;/.test(LE),
  'LivingEntity.damage: isFire() && FIRE_RESISTANCE (field_5918) returns false');
ok(/!this\.canBreatheInWater\(\)\s*&& !StatusEffectUtil\.hasWaterBreathing\(this\)/.test(LE), 'baseTick gates air on hasWaterBreathing');
ok(/hasWaterBreathing[\s\S]*?field_5923\)[\s\S]*?field_5927\)/.test(SU), 'hasWaterBreathing = water_breathing (5923) || conduit_power (5927)');
ok(/hasHaste[\s\S]*?field_5917\)[\s\S]*?field_5927\)/.test(SU), 'hasHaste = haste (5917) || conduit_power (5927)');
ok(/\$\$1 \*= 1\.0F \+ \(float\)\(StatusEffectUtil\.getHasteAmplifier\(this\) \+ 1\) \* 0\.2F;/.test(PE), 'haste: *= 1.0F + (float)(amp + 1) * 0.2F');
const arms = [...PE.matchAll(/case (\d) -> ([0-9.E-]+)F;|default -> ([0-9.E-]+)F;/g)].map((m) => Number(m[2] || m[3]));
ok(arms.length === 4, `mining fatigue switch has 4 arms (got ${arms.length})`);
const FAT = (amp) => fr(arms[amp >= 0 && amp <= 2 ? amp : 3]);
// every `setFire()` source this engine names carries `fire: true`, and nothing else does
const fireSrc = new Set([...DS.matchAll(/new (?:Projectile)?DamageSource\("(\w+)"[^;]*?\.setFire\(\)/g)].map((m) => m[1]));
for (const k of Object.keys(Sv.DAMAGE)) ok(!!Sv.DAMAGE[k].fire === fireSrc.has(k), `Sv.DAMAGE.${k}.fire is ${!!Sv.DAMAGE[k].fire}, DamageSource says ${fireSrc.has(k)}`);

// ── 1. fire resistance zeroes lava/fire damage (player and mob paths) ───────────────────────
const survivor = () => { const e = { effects: {} }; Sv.init(e); e.armor = 0; e.armorToughness = 0; return e; };
const fireHits = (withFR, types) => {
  const out = [];
  for (const t of types) {
    const e = survivor(); if (withFR) give(e, 'fire_resistance', 0);
    const hit = Sv.hurt(e, t, 4);
    out.push({ t, hit, hp: e.health, inv: e.invulnerable });
  }
  return out;
};
const FIRE = ['lava', 'inFire', 'onFire'];
const frRows = fireHits(true, FIRE);
for (const r of frRows) ok(r.hit === false && r.hp === 20 && r.inv === 0, `fire resistance: ${r.t} x4 lands nothing (hit=${r.hit} hp=${r.hp} inv=${r.inv})`);
const plainRows = fireHits(false, FIRE);
for (const r of plainRows) ok(r.hit === true && r.hp === 16, `no effect: ${r.t} x4 takes 4 (hp=${r.hp})`);
{ // a non-fire source is untouched by fire resistance
  const e = survivor(); give(e, 'fire_resistance', 0);
  ok(Sv.hurt(e, 'drown', 2) === true && e.health === 18, 'fire resistance does not stop drowning');
}
const mobBurn = (withFR) => {
  const z = { type: 'zombie', health: 20, maxHealth: 20, effects: {}, invulnerableTime: 0, lastHurt: 0 };
  if (withFR) give(z, 'fire_resistance', 0);
  const hit = Cb.hurt(z, 1, 0, false, { bypassArmor: true, source: 'onFire' });
  return { hit, hp: z.health };
};
{
  const a = mobBurn(true), b = mobBurn(false);
  ok(a.hit === false && a.hp === 20, `mob with fire resistance: the burn tick lands nothing (hp=${a.hp})`);
  ok(b.hit !== false && b.hp === 19, `mob without: the burn tick takes 1 (hp=${b.hp})`);
}

// ── 2. water breathing / conduit power hold the air counter ─────────────────────────────────
const dive = (setup, ticks, air) => {
  const e = survivor(); e.eyeInWater = true; if (air !== undefined) e.air = air;
  setup(e);
  const trace = [];
  for (let i = 0; i < ticks; i++) { Sv.tickAir(e); trace.push(e.air); }
  return { e, trace };
};
{
  const wb = dive((e) => give(e, 'water_breathing', 0), 400);
  ok(wb.trace.every((a) => a === 300) && wb.e.health === 20, 'water breathing: 400 ticks submerged, air held at 300, no drowning');
  const cp = dive((e) => give(e, 'conduit_power', 0), 400);
  ok(cp.trace.every((a) => a === 300), 'conduit power: air held at 300');
  const held = dive((e) => give(e, 'water_breathing', 0), 50, 120);
  ok(held.trace.every((a) => a === 120), `water breathing at air 120 HOLDS 120 underwater (no refill) — got ${held.trace[49]}`);
  const cr = dive((e) => { e.invulnerableGamemode = true; }, 50, 120);
  ok(cr.trace.every((a) => a === 120), 'an invulnerable (creative) player underwater holds air too — the refill is on land only');
  const none = dive(() => {}, 330);
  ok(none.trace[0] === 299 && none.trace[319] === 0 && none.e.health === 18, `no effect: 299 after one tick, drowned at 320 (hp ${none.e.health})`);
  // effect ends underwater -> the counter moves again from where it was held
  // through Sv.tick: vanilla's baseTick runs the air branch BEFORE tickStatusEffects, so the
  // 10th tick (duration 1) still holds and only ticks 11..30 cost air
  const e2 = survivor(); e2.eyeInWater = true; ES.addStatusEffect(e2, 'water_breathing', 10, 0);
  for (let i = 0; i < 30; i++) Sv.tick(e2);
  ok(e2.air === 280 && !ES.hasStatusEffect(e2, 'water_breathing'), `water breathing (10 ticks) then 20 ticks without: air 280 (got ${e2.air})`);
  // on land the refill is untouched by the effect
  const land = survivor(); land.air = 100; give(land, 'water_breathing', 0); Sv.tickAir(land);
  ok(land.air === 104, 'on land the +4 refill still runs with water breathing');
}

// ── 3. haste / conduit / mining fatigue -> break ticks, exactly as PlayerEntity does ─────────
P.effects = {};
let held = 'diamond_pickaxe';
P.heldItemName = () => held;
P.onGround = true; P.eyeInWater = false; P.efficiency = 0;
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
// the Java, re-derived: base speed (tool table) -> haste -> fatigue -> /hardness /30|100 -> ceil(1/p)
const javaTicks = (block, hard, base, harvest, hasteAmp, fatigueAmp) => {
  let f = fr(base);
  if (hasteAmp !== null) f = fr(f * fr(1 + fr(fr(hasteAmp + 1) * fr(0.2))));
  if (fatigueAmp !== null) f = fr(f * FAT(fatigueAmp));
  const p = fr(fr(f / fr(hard)) / (harvest ? 30 : 100));
  return p >= 1 ? 1 : Math.ceil(1 / p);
};
const engineTicks = (state, fx) => {
  P.effects = {}; for (const [n, a] of fx) give(P, n, a);
  return Mi.ticks(state, P.miningContext());
};
const CASES = [
  // [block, hardness, tool, base speed, canHarvest]
  ['stone', 1.5, 'diamond_pickaxe', 8, true],
  ['obsidian', 50, 'diamond_pickaxe', 8, true],
  ['oak_log', 2, 'iron_axe', 6, true],
  ['dirt', 0.5, '', 1, true],
  ['stone', 1.5, '', 1, false],
];
const EFFECTS = [
  [[], null, null],
  [[['haste', 1]], 1, null],                                   // Haste II
  [[['haste', 0]], 0, null],
  [[['conduit_power', 2]], 2, null],                           // conduit counts as haste
  [[['haste', 0], ['conduit_power', 1]], 1, null],             // max of the two amplifiers
  [[['mining_fatigue', 2]], null, 2],                          // Mining Fatigue III
  [[['mining_fatigue', 0]], null, 0],
  [[['mining_fatigue', 7]], null, 7],                          // default arm
  [[['mining_fatigue', -1]], null, -1],                        // a byte-wrapped 255: default arm too
  [[['haste', 1], ['mining_fatigue', 1]], 1, 1],
];
let rows = 0;
for (const [b, h, tool, base, harv] of CASES) {
  held = tool;
  ok(Mi.itemSpeed(tool, R.id[b]) === base && Mi.canHarvest(R.id[b], tool) === harv, `${tool || 'hand'} on ${b}: speed ${base}, harvest ${harv}`);
  for (const [fx, ha, fa] of EFFECTS) {
    const want = javaTicks(b, h, base, harv, ha, fa), got = engineTicks(def(b), fx);
    ok(got === want, `${tool || 'hand'} on ${b} with ${JSON.stringify(fx)}: ${got} ticks, PlayerEntity says ${want}`);
    rows++;
  }
}
// the two numbers the issue names, as literals too
held = 'diamond_pickaxe';
ok(engineTicks(def('stone'), []) === 6 && engineTicks(def('stone'), [['haste', 1]]) === 5, 'stone / diamond pickaxe: 6 ticks, Haste II 5');
ok(engineTicks(def('stone'), [['mining_fatigue', 2]]) === javaTicks('stone', 1.5, 8, true, null, 2) &&
   engineTicks(def('stone'), [['mining_fatigue', 2]]) > 2000, 'stone / diamond pickaxe, Mining Fatigue III: over 2000 ticks');
console.log(`   ${rows} (block, tool, effect) rows against the re-derived Java`);

// the swing (LivingEntity.getHandSwingDuration) reads the same StatusEffectUtil
P.effects = {}; give(P, 'conduit_power', 1);
ok(M.Hand.swingDuration(P) === 4, 'conduit power II: swing 4 ticks');

// ── anti-vacuity: each rule, broken, must be caught ─────────────────────────────────────────
console.log('anti-vacuity');
{
  const real = ES.hasStatusEffect;
  ES.hasStatusEffect = (e, n) => n === 'fire_resistance' ? false : real(e, n);
  const rs = fireHits(true, FIRE), m = mobBurn(true);
  ES.hasStatusEffect = real;
  okAv(rs.every((r) => r.hp === 16) && m.hp === 19, 'fire resistance gate removed -> lava/fire lands on player and mob');
}
{
  const real = ES.hasWaterBreathing;
  ES.hasWaterBreathing = () => false;
  const wb = dive((e) => give(e, 'water_breathing', 0), 400);
  ES.hasWaterBreathing = real;
  okAv(!wb.trace.every((a) => a === 300), 'water-breathing gate removed -> the air counter falls');
}
{
  const real = ES.hasWaterBreathing;
  ES.hasWaterBreathing = (e) => ES.hasStatusEffect(e, 'water_breathing');   // conduit dropped
  const cp = dive((e) => give(e, 'conduit_power', 0), 50);
  ES.hasWaterBreathing = real;
  okAv(cp.trace[49] === 250, 'conduit power dropped from hasWaterBreathing -> air falls under conduit');
}
{
  const real = ES.hasHaste;
  ES.hasHaste = (e) => ES.hasStatusEffect(e, 'haste');                       // conduit dropped
  held = 'diamond_pickaxe';
  const t = engineTicks(def('stone'), [['conduit_power', 2]]);
  ES.hasHaste = real;
  okAv(t !== javaTicks('stone', 1.5, 8, true, 2, null), 'conduit power dropped from hasHaste -> break ticks differ from PlayerEntity');
}
{
  const real = ES.getHasteAmplifier;
  ES.getHasteAmplifier = (e) => ES.hasStatusEffect(e, 'haste') ? e.effects.haste.amplifier : 0;   // no max
  held = 'iron_axe';
  const t = engineTicks(def('oak_log'), [['haste', 0], ['conduit_power', 1]]);
  ES.getHasteAmplifier = real;
  okAv(t !== javaTicks('oak_log', 2, 6, true, 1, null), 'getHasteAmplifier without the max -> haste I + conduit II mines like haste I');
}
{
  const real = P.syncMiningEffects;
  P.syncMiningEffects = function () { real(); if (P.effects.mining_fatigue) P.fatigue = P.effects.mining_fatigue.amplifier + 1; };
  held = 'diamond_pickaxe';
  const t = engineTicks(def('stone'), [['mining_fatigue', -1]]);
  P.syncMiningEffects = real;
  okAv(t !== javaTicks('stone', 1.5, 8, true, null, -1), 'fatigue as amp+1 (no default arm) -> a byte-wrapped amplifier mines at full speed');
}
{
  // the old order (effects before air) loses water breathing's last tick
  const e = survivor(); e.eyeInWater = true; ES.addStatusEffect(e, 'water_breathing', 10, 0);
  for (let i = 0; i < 30; i++) { ES.tick(e); Sv.tickAir(e); }
  okAv(e.air !== 280, `effects ticked before air -> ${e.air}, not baseTick's 280`);
}
{
  const saved = arms.slice(); arms[2] = 0.027;                             // a power-of-0.3 guess
  held = 'diamond_pickaxe';
  const t = engineTicks(def('stone'), [['mining_fatigue', 2]]);
  const w = javaTicks('stone', 1.5, 8, true, null, 2);
  arms.splice(0, 4, ...saved);
  okAv(t !== w, 'Mining Fatigue III as 0.3^3 -> the engine and the "Java" disagree');
}

if (fails.length) { console.log('FAIL'); for (const f of fails.slice(0, 40)) console.log('  ✗ ' + f); process.exit(1); }
console.log(`effectenvcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
