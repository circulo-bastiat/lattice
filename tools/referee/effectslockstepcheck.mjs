// effectslockstepcheck.mjs -- #6300 (G17-L52): lockstep scenario 'effects': poison, wither, regeneration, slowness, absorption on a zombie and a cow, 20 salts.
// Reference = StatusEffect.canApplyUpdateEffect/applyUpdateEffect + LivingEntity.tickStatusEffects (.decomp) written out independently;
// effect applied at tick 5; per tick health, effects [[id,amp,duration]], effective movement_speed (slowness -15%/level MULTIPLY_TOTAL) compared
// with lockstep/trace.mjs compareTraces. Poison stops at 1 hp, wither kills, regeneration every 50>>amp ticks, expiry tick is the first row without the effect.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07y_equip.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07q_effects.js', '14j_combat.js'], dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
const { Effects: ES, Combat: Cb } = M;
const ids = ES.IDS;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const TICKS = 70, APPLY = 5, salts = Array.from({ length: 20 }, (_, i) => i);
const BASE = { zombie: Math.fround(0.23), cow: Math.fround(0.2) }, HP = { zombie: 20, cow: 10 };
const F = { fields: ['health', 'effects', 'attributesEff'] };
const EFF = [['poison', 0, 40], ['poison', 1, 60], ['wither', 0, 50], ['wither', 1, 30], ['regeneration', 0, 120], ['regeneration', 1, 70], ['slowness', 0, 40], ['slowness', 2, 30], ['absorption', 1, 25]];
// salt picks the start health (the cadence is keyed to the remaining duration, so the start health only moves what is visible)
const startHp = (mob, salt) => 1 + (salt * 7) % (HP[mob] - 1);
function reference(mob, [eff, amp, dur], hp0) {
  let hp = hp0, left = 0, rows = [];
  const max = HP[mob];
  for (let t = 0; t < TICKS; t++) {
    if (t === APPLY) left = dur;
    if (left > 0) {
      const iv = { regeneration: 50, poison: 25, wither: 40 }[eff];
      const due = iv ? ((iv >> amp) > 0 ? left % (iv >> amp) === 0 : true) : false;
      if (due && hp > 0) {
        if (eff === 'regeneration' && hp < max) hp = Math.min(hp + 1, max);
        if (eff === 'poison' && hp > 1) hp -= 1;
        if (eff === 'wither') hp -= 1;
      }
      left--;
    }
    const absorbed = eff === 'absorption' && t >= APPLY && left > 0;
    rows.push({ hp: Math.max(hp, 0), eff: left > 0 ? [[ids[eff], amp, left]] : [], spd: eff === 'slowness' && left > 0 ? BASE[mob] * (1 + -0.15 * (amp + 1)) : BASE[mob], absorbed });
    if (hp <= 0) break;
  }
  return rows;
}
function engine(mob, [eff, amp, dur], hp0) {
  const e = { type: mob, x: 0.5, y: 64, z: 0.5, height: 1.5, width: 0.6, health: hp0, maxHealth: HP[mob], dead: false, equip: {}, effects: {}, noAi: true };
  M.World = { getLight: () => 0, getBlock: () => 0 };
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    if (t === APPLY) ES.addStatusEffect(e, eff, dur, amp, false, false);
    if (e.invulnerableTime > 0) e.invulnerableTime--;   // LivingEntity.tick, which this harness does not run
    ES.tick(e);
    const spd = M.Ai.movementSpeedOf(e);
    rows.push({ hp: Math.max(e.health, 0), fx: JSON.parse(JSON.stringify(e.effects)), spd });
    if (!(e.health > 0)) break;
  }
  return rows;
}
const DBG = process.env.DBG;
const run = (mob, eff, salt) => {
  const hp0 = startHp(mob, salt), R = reference(mob, eff, hp0), E = engine(mob, eff, hp0);
  const S = R.map((r, t) => serverRow(t, { Health: r.hp, ActiveEffects: r.eff.map((x) => ({ Id: x[0], Amplifier: x[1], Duration: x[2] })), Attributes: [{ Name: 'minecraft:generic.movement_speed', Base: r.spd, Modifiers: [] }] }));
  const G = E.map((r, t) => engineRow(t, { health: r.hp, effects: r.fx }, { effectIds: ids, attributesEff: { movement_speed: r.spd } }));
  const d = compareTraces(S, G, F); if (DBG && d) console.log(JSON.stringify(d), JSON.stringify(S[d.tick]), JSON.stringify(G[d.tick]));
  return { d, R, E };
};
let heals = 0;
for (const mob of ['zombie', 'cow']) for (const eff of EFF) {
  // zombie is undead: the gate refuses regeneration/poison, so the reference expects the effect absent
  const undeadRefuses = mob === 'zombie' && (eff[0] === 'regeneration' || eff[0] === 'poison');
  if (undeadRefuses) continue;
  const bad = salts.map((s) => ({ s, r: run(mob, eff, s) })).filter((x) => x.r.d);
  ok(!bad.length, `${mob} ${eff.join('/')}: ${bad.slice(0, 2).map((x) => `salt ${x.s} tick ${x.r.d.tick} ${x.r.d.field}`)}`);
  if (eff[0] === 'regeneration') heals += salts.filter((s) => { const R = run(mob, eff, s).R; return R.some((r, t) => t && r.hp > R[t - 1].hp); }).length;
}
ok(heals > 0, 'regeneration heals somewhere (not vacuous)');
{ const e = { type: 'zombie', health: 5, maxHealth: 20, effects: {} }; ES.addStatusEffect(e, 'regeneration', 100, 0, false, false); ok(!e.effects.regeneration, 'zombie refuses regeneration'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const dirty = (mob, eff) => salts.some((s) => run(mob, eff, s).d);
{ const o = ES.TICK_INTERVAL_BASE.regeneration; ES.TICK_INTERVAL_BASE.regeneration = 49; brk(dirty('cow', ['regeneration', 0, 120]), 'regeneration interval 50 -> 49 caught at the first heal'); ES.TICK_INTERVAL_BASE.regeneration = o; }
{ const o = ES.TICK_INTERVAL_BASE.poison; ES.TICK_INTERVAL_BASE.poison = 24; brk(dirty('cow', ['poison', 0, 40]), 'poison interval 25 -> 24 caught'); ES.TICK_INTERVAL_BASE.poison = o; }
{ const o = M.Ai.movementSpeedOf; M.Ai.movementSpeedOf = (e) => o({ type: e.type }); brk(dirty('cow', ['slowness', 0, 40]), 'slowness ignored by speed attribute caught'); M.Ai.movementSpeedOf = o; }
{ const o = ES.applyTickEffect; ES.applyTickEffect = (e, f, a) => { if (f === 'poison') e.health -= 1; else o(e, f, a); }; brk(dirty('cow', ['poison', 0, 200]), 'poison without the 1 hp floor caught'); ES.applyTickEffect = o; }
console.log(`effectslockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
