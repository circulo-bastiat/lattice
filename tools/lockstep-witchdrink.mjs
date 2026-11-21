#!/usr/bin/env node
// lockstep-witchdrink -- #8646 (G18b-L37): witch DrinkPotion state machine, 20 salts x 1200 ticks (engine side).
// Four triggers in turn, 300 ticks each: hurt (health 6), on fire, eye in water, a target 11+ blocks away. Per tick: drink timer,
// drinking flag, held potion, applied effects (id/amplifier/duration). Vanilla WitchEntity.tickMovement (15% swim, 15% fire, 5% heal,
// 50% swiftness at d^2 > 121, 32-tick drink).
import { harness } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const { M } = harness();
const Po = M.Potion, ES = M.Effects, EL = M.EntityList;
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const stream = (s) => { let a = (s + 1) * 2654435761 >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const T = 1200, PH = 300;

function run(salt) {
  const r = stream(salt);
  const e = { type: 'witch', x: 0, y: 0, z: 0, health: 26, maxHealth: 26, age: 0, effects: {}, target: null };
  const rows = [];
  for (let t = 0; t < T; t++) {
    const ph = (t / PH) | 0;
    if (t % PH === 0) {
      e.health = e.maxHealth; e.isOnFire = false; e.eyeInWater = false; e.target = null;
      if (ph === 0) e.health = 6; if (ph === 1) e.isOnFire = true; if (ph === 2) e.eyeInWater = true;
      if (ph === 3) e.target = { x: salt % 2 ? 10.5 : 11.5, y: 0, z: 0 };
    }
    e.age = t;
    Po.tickWitchDrink(e, { random: r });
    if (ES.tick) ES.tick(e);
    const held = e.witchDrinkPotion || null;
    const fx = ['water_breathing', 'fire_resistance', 'speed', 'instant_health'].filter((k) => ES.hasStatusEffect(e, k)).map((k) => k + ':' + ES.amplifierOf(e, k) + ':' + ES.getStatusEffect(e, k).duration);
    rows.push({ tick: t, drinking: !!e.witchDrinking, left: e.witchDrinkTimeLeft || 0, held, fx: fx.join(','), hp: e.health });
  }
  return rows;
}
run(0);
const base = run(0);
const F = ['drinking', 'left', 'held', 'fx', 'hp'];
const seen = new Set();
for (let s = 0; s < 20; s++) {
  const a = run(s), b = run(s);
  ok(compareTraces(a, b, { fields: F }) === null, `salt ${s}: repeatable`);
  a.forEach((row, t) => {
    if (row.held) seen.add(row.held);
    if (t > 0 && row.drinking && !a[t - 1].drinking) {
      ok(row.left === 32 - 0 || row.left === 32, `salt ${s} t${t}: drink starts at ${row.left}`);
      const ph = (t / PH) | 0, want = ['healing', 'fire_resistance', 'water_breathing', 'swiftness'][ph];
      ok(ph < 3 ? row.held === want : (s % 2 === 0 && row.held === want), `salt ${s} t${t}: phase ${ph} drank ${row.held}`);
    }
  });
}
for (const k of ['healing', 'fire_resistance', 'water_breathing', 'swiftness']) ok(seen.has(k), `never drank ${k}`);
const mut = (f, fn) => base.map((r, t) => (t === 200 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(base, mut('left', (v) => v + 1), { fields: F })?.field === 'left', 'left +1');
caught(compareTraces(base, mut('held', () => 'x'), { fields: F })?.field === 'held', 'held');
const sq = Po.DRINK_TARGET_DIST_SQ; Po.DRINK_TARGET_DIST_SQ = 100;
let alt = []; for (let s = 0; s < 20; s++) alt = alt.concat(run(s)); Po.DRINK_TARGET_DIST_SQ = sq;
let ref = []; for (let s = 0; s < 20; s++) ref = ref.concat(run(s));
caught(compareTraces(ref, alt, { fields: F }) === null ? false : true, 'swiftness gate 121 changed to 100');
caught(compareTraces(base, base.slice(1), { fields: F }) !== null, 'row shift');
console.log(`${20 * 2 + 4} assertions, ${bad} failures, ${breaks} breaks caught (20 salts x ${T} ticks; drank ${[...seen].join('/')})`);
process.exit(bad ? 1 : 0);
