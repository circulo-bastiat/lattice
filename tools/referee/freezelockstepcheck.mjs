// freezelockstepcheck.mjs -- #6604 (G17-L79): lockstep scenario 'freeze': a zombie, cow, wolf and stray (+ a zombie in leather boots) enter a powder_snow pit at tick ENTER and leave at tick LEAVE; 20 seeds.
// Reference = LivingEntity.baseTick freeze block (.decomp: inPowderSnow && canFreeze -> min(140, f+1) else max(0, f-2); every 40 ticks of age while f >= 140 and canFreeze: FREEZE 1, or 5 for
// FREEZE_HURT_EXTRA_TYPES), addPowderSnowSlowIfNeeded (ADDITION -0.05F * min(f,140)/140 on movement_speed) and the freeze_immune_entity_types tag, written out independently.
// Per tick TicksFrozen, health and effective movement_speed go through lockstep/trace.mjs compareTraces.
import { loadEngine } from '../loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07y_equip.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07q_effects.js', '14j_combat.js'], dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8')).rawBytes });
const { Combat: Cb, Entities: EL2, Reg: R, States: St } = M;
const EL = M.EntityList || M.EL || EL2;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const TICKS = 330, salts = Array.from({ length: 20 }, (_, i) => i);
const BASE = { zombie: Math.fround(0.23), cow: Math.fround(0.2), wolf: Math.fround(0.3), stray: Math.fround(0.25) }, HP = { zombie: 20, cow: 10, wolf: 8, stray: 20 };
const IMMUNE = { stray: 1 };   // #freeze_immune_entity_types
const F = { fields: ['frozen', 'health', 'attributesEff'] };
const SNOW = R.realFirst[R.id.powder_snow] + R.defaultState[R.id.powder_snow];
const CASES = [['zombie', false], ['cow', false], ['wolf', false], ['stray', false], ['zombie', true]];   // [mob, leather boots]
function reference(mob, boots, enter, leave, age0) {
  let f = 0, hp = HP[mob], rows = [];
  const can = !IMMUNE[mob] && !boots;
  for (let t = 0; t < TICKS; t++) {
    const age = age0 + t + 1, inSnow = t >= enter && t < leave;
    f = inSnow && can ? Math.min(140, f + 1) : Math.max(0, f - 2);
    if (age % 40 === 0 && f >= 140 && can) hp -= 1;
    const spd = f > 0 ? BASE[mob] + Math.fround(Math.fround(-0.05) * Math.fround(Math.min(f, 140) / 140)) : BASE[mob];
    rows.push({ f, hp, spd });
    if (hp <= 0) break;
  }
  return rows;
}
function engine(mob, boots, enter, leave, age0) {
  const e = { type: mob, x: 0.5, y: 64, z: 0.5, height: mob === 'cow' ? 1.4 : 1.9, width: 0.6, health: HP[mob], maxHealth: HP[mob], dead: false, equip: {}, effects: {}, noAi: true, age: age0, onGround: true };
  if (boots) M.Equip.setEquipped(e, M.Items.FEET, { i: M.Items.names.indexOf('leather_boots'), n: 1 });
  let snow = false;
  M.World = { getLight: () => 0, getBlock: () => (snow ? SNOW : 0) };
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    snow = t >= enter && t < leave;
    if (e.invulnerableTime > 0) e.invulnerableTime--;
    e.age++;
    EL.tickHazards(e);
    rows.push({ f: e.frozenTicks | 0, hp: e.health, spd: M.Ai.movementSpeedOf(e) });
    if (!(e.health > 0)) break;
  }
  return rows;
}
const DBG = process.env.DBG;
const run = (mob, boots, salt) => {
  const enter = 5 + (salt * 3) % 11, leave = enter + 150 + (salt * 17) % 90, age0 = (salt * 13) % 40;
  const R_ = reference(mob, boots, enter, leave, age0), E = engine(mob, boots, enter, leave, age0);
  const S = R_.map((r, t) => serverRow(t, { Health: r.hp, TicksFrozen: r.f, Attributes: [{ Name: 'minecraft:generic.movement_speed', Base: r.spd, Modifiers: [] }] }));
  const G = E.map((r, t) => engineRow(t, { health: r.hp, frozenTicks: r.f }, { attributesEff: { movement_speed: r.spd } }));
  const d = compareTraces(S, G, F); if (DBG && d) console.log(JSON.stringify(d), JSON.stringify(S[d.tick]), JSON.stringify(G[d.tick]));
  return { d, R: R_ };
};
let damaged = 0, capped = 0;
for (const [mob, boots] of CASES) {
  const bad = salts.map((s) => ({ s, r: run(mob, boots, s) })).filter((x) => x.r.d);
  ok(!bad.length, `${mob}${boots ? '+leather boots' : ''}: ${bad.slice(0, 2).map((x) => `salt ${x.s} tick ${x.r.d.tick} ${x.r.d.field}`)}`);
  if (!IMMUNE[mob] && !boots) { damaged += salts.filter((s) => { const r = run(mob, boots, s).R; return r[r.length - 1].hp < HP[mob]; }).length; capped += salts.filter((s) => run(mob, boots, s).R.some((r) => r.f === 140)).length; }
}
ok(damaged > 0 && capped > 0, 'freeze damage and the 140 cap are reached (not vacuous)');
ok(EL.FREEZE_EXTRA.blaze === 1 && EL.FREEZE_EXTRA.strider === 1 && EL.FREEZE_EXTRA.magma_cube === 1 && !EL.FREEZE_EXTRA.zombie, 'FREEZE_HURT_EXTRA_TYPES = strider, blaze, magma_cube');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const dirty = (mob, boots = false) => salts.some((s) => run(mob, boots, s).d);
{ const o = EL.tickHazards; EL.tickHazards = (e) => { const had = e.frozenTicks | 0; o(e); if (had > 0 && !e.inPowderSnow) e.frozenTicks = Math.max(0, had - 1); }; brk(dirty('cow'), 'decay rate 2 -> 1 caught'); EL.tickHazards = o; }
{ const o = M.Ai.FREEZE_IMMUNE.stray; delete M.Ai.FREEZE_IMMUNE.stray; brk(dirty('stray'), 'stray immunity tag removed caught'); M.Ai.FREEZE_IMMUNE.stray = o; }
{ const o = M.Ai.movementSpeedOf; M.Ai.movementSpeedOf = (e) => o(Object.assign({}, e, { frozenTicks: 0 })); brk(dirty('wolf'), 'powder snow slow ignored caught'); M.Ai.movementSpeedOf = o; }
{ const o = M.Ai.canFreeze; M.Ai.canFreeze = () => true; brk(dirty('stray'), 'canFreeze always true caught'); M.Ai.canFreeze = o; }
console.log(`freezelockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
