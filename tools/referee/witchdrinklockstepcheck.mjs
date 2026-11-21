// witchdrinklockstepcheck.mjs -- #6670 (G17-L99): lockstep scenario 'witchdrink'. Reference = .decomp WitchEntity.tickMovement (drink state machine: the four
// rolls in order water 0.15 / fire 0.15 / heal 0.05 / swift 0.5 with > 121 target distance, drinkTimeLeft-- <= 0 compares the OLD value, 32-tick potion use
// time, effects applied on finish, main hand emptied), attack (potion by raider / distance >= 8 / health >= 8 / <= 3 with the 0.25 roll, dy arc 0.2, power 0.75)
// and applyEnchantmentsToDamage (magic x 0.15F). Written independently of src/07z_potion.js; the engine is fed the SAME per-tick roll sequence (salted stream).
// Lanes per salt: (A) standing dummy at 8 blocks, hurt witch; (B) witch on fire, submerged in water. Compared per tick: drinking flag, potion in hand,
// drink timer, applied effects [id, amplifier, duration]; thrown potion type + velocity at distances 2..12 / health 6..20; magic damage factor.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07z_potion.js', '07v_spell.js', '07k_goals.js', '07zx_particle.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init();
if (M.Tags && M.Tags.init && !M.Tags.ready) M.Tags.init();
M.Behave.init(M.World); M.Particle.init();
const Po = M.Potion, ES = M.Effects;
let fails = 0, breaks = 0, cases = 0;
const ok = (c, m) => { cases++; if (!c) { fails++; if (fails < 20) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const K = { water: 0.15, fire: 0.15, heal: 0.05, swift: 0.5, magic: 0.15 };   // the reference constants; the breaks perturb them
const POT = { water_breathing: ['water_breathing', 3600, 0], fire_resistance: ['fire_resistance', 3600, 0], healing: ['instant_health', 1, 0], swiftness: ['speed', 3600, 0] };

// reference witch: s = { drinking, left, potion, effects{id:[amp,dur]}, health, max, onFire, submerged, target:{d2}|null }
function refTick(s, r) {
  if (s.drinking) {
    const old = s.left--;
    if (old <= 0) { s.drinking = false; const p = POT[s.potion]; s.potion = null; s.effects[p[0]] = [p[2], p[1]]; }
    return;
  }
  const has = (id) => s.effects[id] !== undefined;
  let pick = null;
  if (r() < K.water && s.submerged && !has('water_breathing')) pick = 'water_breathing';
  else if (r() < K.fire && s.onFire && !has('fire_resistance')) pick = 'fire_resistance';
  else if (r() < K.heal && s.health < s.max) pick = 'healing';
  else if (r() < K.swift && s.target && !has('speed') && s.target.d2 > 121) pick = 'swiftness';
  if (pick) { s.drinking = true; s.potion = pick; s.left = 32; }
}
const snapEng = (e) => ({ drinking: !!e.witchDrinking, potion: e.witchDrinkPotion || null, left: e.witchDrinking ? e.witchDrinkTimeLeft : null,
  eff: Object.keys(e.effects || {}).filter((k) => e.effects[k].duration > 0).sort().map((k) => [k, e.effects[k].amplifier, e.effects[k].duration]) });
const snapRef = (s) => ({ drinking: s.drinking, potion: s.potion, left: s.drinking ? s.left : null,
  eff: Object.keys(s.effects).sort().map((k) => [k, s.effects[k][0], s.effects[k][1]]) });

function lane(salt, o) {
  const r = stream(salt), re = stream(salt);   // identical roll sequences for reference and engine
  const e = { type: 'witch', x: 0, y: 8, z: 0, health: o.hurt ? 10 : 26, maxHealth: 26, eyeInWater: !!o.water, isOnFire: !!o.fire, age: 0, dead: false, effects: {} };
  if (o.target) e.target = { x: 8, y: 8, z: 0 };
  const s = { drinking: false, left: 0, potion: null, effects: {}, health: e.health, max: 26, onFire: !!o.fire, submerged: !!o.water, target: o.target ? { d2: 64 } : null };
  for (let t = 1; t <= 200; t++) {
    refTick(s, r); Po.tickWitchDrink(e, { random: re });
    for (const id of Object.keys(s.effects)) { if (e.effects[id] === undefined) continue; }
    // ES.tick would count durations down once per tick; mirror it in the reference after the tick
    if (o.tickEffects) { ES.tick(e); for (const id of Object.keys(s.effects)) { s.effects[id][1]--; if (s.effects[id][1] <= 0) delete s.effects[id]; } }
    const a = JSON.stringify(snapEng(e)), b = JSON.stringify(snapRef(s));
    if (a !== b) return { tick: t, a, b };
  }
  return null;
}
for (const [name, o] of [['dummy at 8, hurt', { target: true, hurt: true }], ['far target 12 (swift)', { target: true, far: true }], ['on fire in water', { fire: true, water: true, hurt: true }]]) {
  const bad = salts.map((x) => lane(x, o)).filter(Boolean);
  ok(!bad.length, `drink lane ${name}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
// swift needs a target > 11 blocks: engine target at 12, reference d2 = 144
{
  const run = (salt) => { const r = stream(salt), re = stream(salt); const e = { type: 'witch', x: 0, y: 8, z: 0, health: 26, maxHealth: 26, age: 0, effects: {}, target: { x: 12, y: 8, z: 0 } };
    const s = { drinking: false, left: 0, potion: null, effects: {}, health: 26, max: 26, target: { d2: 144 } }; let sawSwift = false;
    for (let t = 1; t <= 120; t++) { refTick(s, r); Po.tickWitchDrink(e, { random: re }); if (s.potion === 'swiftness') sawSwift = true;
      if (JSON.stringify(snapEng(e)) !== JSON.stringify(snapRef(s))) return { tick: t }; }
    return sawSwift ? null : { tick: 0, why: 'no swiftness drunk' }; };
  const bad = salts.map(run).filter(Boolean); ok(!bad.length, `swift lane: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
// thrown potion by distance and target health (WitchEntity.attack), velocity power 0.75
const refChoose = (horiz, hp, hasSlow, hasPoison, hasWeak, roll) => horiz >= 8 && !hasSlow ? 'slowness' : hp >= 8 && !hasPoison ? 'poison' : horiz <= 3 && !hasWeak && roll < 0.25 ? 'weakness' : 'harming';
let thrown = 0;
for (const salt of salts) {
  const r = stream(salt);
  for (let k = 0; k < 6; k++) {
    const horiz = 2 + Math.floor(r() * 11), hp = 6 + Math.floor(r() * 15), roll = r(), eff = r() < 0.3 ? 'poison' : null;
    const w = { type: 'witch', x: 0, y: 8, z: 0, height: 1.95, effects: {} };
    const tg = { type: 'player', x: horiz, y: 8, z: 0, vx: 0, vz: 0, height: 1.8, health: hp, effects: {} };
    if (eff) tg.effects.poison = ES.instance('poison', 100, 0);
    const got = Po.witchChoosePotion(w, tg, () => roll);
    const want = refChoose(horiz, hp, false, !!eff, false, roll);
    ok(got === want, `thrown potion horiz=${horiz} hp=${hp} roll=${roll.toFixed(2)}: ${got} vs ${want}`); thrown++;
  }
}
// magic damage: x0.15, own hit 0, other damage untouched
for (const salt of salts) { const a = 1 + stream(salt)() * 12; const w = { type: 'witch' };
  ok(Math.abs(ES.witchMagic(w, a, {}) - a * K.magic) < 1e-12, 'witch magic x0.15 salt ' + salt); ok(ES.witchMagic(w, a, w) === 0, 'own hit 0'); ok(ES.witchMagic({ type: 'cow' }, a, {}) === a, 'non-witch unchanged'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const bad20 = (o) => salts.some((x) => lane(x, o));
K.water = 0.16; brk(bad20({ fire: true, water: true, hurt: true }), 'water roll 0.15 -> 0.16 caught'); K.water = 0.15;
K.fire = 0.16; brk(bad20({ fire: true, water: true, hurt: true }), 'fire roll 0.15 -> 0.16 caught'); K.fire = 0.15;
K.heal = 0.06; brk(bad20({ target: true, hurt: true }), 'heal roll 0.05 -> 0.06 caught'); K.heal = 0.05;
K.magic = 0.16; brk(Math.abs(ES.witchMagic({ type: 'witch' }, 10, {}) - 10 * K.magic) > 1e-9, 'witch magic factor 0.15 -> 0.16 caught'); K.magic = 0.15;
const ov = Po.DRINK_TIME; Po.DRINK_TIME = 33; brk(bad20({ target: true, hurt: true }), 'drink time 32 -> 33 caught'); Po.DRINK_TIME = ov;
console.log(`witchdrinklockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
