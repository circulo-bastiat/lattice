// hungerlockstepcheck.mjs -- #6851 (G17-L150): lockstep scenario 'hunger', 20 salts x Peaceful/Easy/Normal/Hard.
// Reference = .decomp HungerManager.update/add/addExhaustion (written out here from the Java, not from 14d_survival.js):
// exhaustion>4 -> saturation-1 else food-1 (not Peaceful); food>=20 & sat>0 & hurt -> heal min(sat,6)/6 every 10t (+exhaustion);
// food>=18 & hurt -> heal 1 every 80t (+6 exhaustion); food 0 -> starve 1 every 80t if hp>10 | Hard | (hp>1 & Normal).
// Scripted player: sprint (0.1/m), jump (0.05), sprint-jump (0.2), mine (0.005), damage (0.1 + hp), eat (add 6 / 3.6 sat).
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07q_effects.js', '14d_survival.js'], dom: false, initReg: true });
const Sv = M.Survival || M.Sv;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TICKS = 1500, F = (x) => x;   // engine arithmetic is double (Java floats are not modelled; survcheck pins it)
// per-tick scripted events from the salt: [{kind, amt}]
function script(salt) {
  const r = stream(salt), ev = [];
  for (let t = 1; t <= TICKS; t++) {
    const x = r(), l = [];
    if (x < 0.30) l.push(['sprint', 0.2 + r() * 0.1]);
    if (x > 0.30 && x < 0.34) l.push(['jump', 0]);
    if (x > 0.34 && x < 0.37) l.push(['sprintjump', 0]);
    if (x > 0.37 && x < 0.42) l.push(['mine', 0]);
    if (x > 0.42 && x < 0.425) l.push(['hit', 1 + Math.floor(r() * 3)]);
    if (x > 0.425 && x < 0.427) l.push(['eat', 0]);
    ev.push(l);
  }
  return ev;
}
function reference(salt, diff, st) {
  const ev = script(salt), rows = [];
  let food = st ? 0 : 20, sat = st ? 0 : F(5), exh = 0, timer = 0, hp = 20, age = 0;
  const addEx = (x) => { exh = F(Math.min(exh + F(x), 40)); };
  for (let t = 1; t <= TICKS; t++) {
    for (const [k, a] of ev[t - 1]) {
      if (k === 'sprint') addEx(F(F(0.1) * F(a))); else if (k === 'jump') addEx(0.05); else if (k === 'sprintjump') addEx(0.2);
      else if (k === 'mine') addEx(0.005);
      else if (k === 'hit') { hp -= a; addEx(0.1); }
      else if (k === 'eat') { food = Math.min(6 + food, 20); sat = F(Math.min(F(sat + F(F(6 * F(0.6)) * 2)), food)); }
    }
    if (hp <= 0) hp = 20;
    if (exh > 4) { exh = F(exh - 4); if (sat > 0) sat = Math.max(sat - 1, 0); else if (diff !== 'peaceful') food = Math.max(food - 1, 0); }
    const hurt = hp > 0 && hp < 20;
    if (sat > 0 && hurt && food >= 20) {
      if (++timer >= 10) { const h = Math.min(sat, 6); hp = F(Math.min(F(hp + F(h / 6)), 20)); addEx(h); timer = 0; }
    } else if (food >= 18 && hurt) {
      if (++timer >= 80) { hp = F(Math.min(hp + 1, 20)); addEx(6); timer = 0; }
    } else if (food <= 0) {
      if (++timer >= 80) { if (hp > 10 || diff === 'hard' || (hp > 1 && diff === 'normal')) { hp -= 1; } timer = 0; }
    } else timer = 0;
    age++;
    if (diff === 'peaceful') { if (hp < 20 && age % 20 === 0) hp = F(Math.min(hp + 1, 20)); if (food < 20 && age % 10 === 0) food++; }
    rows.push({ t, food, sat, exh, timer, hp });
  }
  return rows;
}
function engine(salt, diff, st) {
  const ev = script(salt), rows = [];
  Sv.difficulty = () => diff;
  const e = { type: 'player', invulnerable: 0, effects: {}, armor: 0, armorToughness: 0, age: 0 };
  Sv.init ? Sv.init(e) : null;
  Object.assign(e, { food: st ? 0 : 20, saturation: st ? 0 : 5, exhaustion: 0, foodTimer: 0, health: 20, maxHealth: 20, dead: false });
  for (let t = 1; t <= TICKS; t++) {
    for (const [k, a] of ev[t - 1]) {
      if (k === 'sprint') Sv.movement(e, a, { sprinting: true }); else if (k === 'jump') Sv.jumped(e, false); else if (k === 'sprintjump') Sv.jumped(e, true);
      else if (k === 'mine') Sv.mined(e);
      else if (k === 'hit') { e.health -= a; Sv.addExhaustion(e, Sv.EX_DAMAGE); }
      else if (k === 'eat') Sv.eat(e, 6, 0.6);
    }
    if (e.health <= 0 || e.dead) { e.health = 20; e.dead = false; }
    Sv.tick(e);
    rows.push({ t, food: e.food, sat: e.saturation, exh: e.exhaustion, timer: e.foodTimer, hp: e.health });
  }
  return rows;
}
function lane(salt, diff, st) {
  const R = reference(salt, diff, st), E = engine(salt, diff, st);
  const m = { food: 'food', sat: 'sat', exh: 'exh', timer: 'timer', hp: 'hp' };
  for (let i = 0; i < R.length; i++) for (const f in m) if (!Object.is(R[i][f], E[i][f])) return { tick: R[i].t, field: f, a: R[i][f], b: E[i][f] };
  return null;
}
const salts = Array.from({ length: 20 }, (_, i) => i), diffs = ['peaceful', 'easy', 'normal', 'hard'];
for (const d of diffs) for (const st of [0, 1]) {
  const bad = salts.map((s) => ({ s, d: lane(s, d, st) })).filter((x) => x.d);
  ok(!bad.length, d + (st ? ' starving' : '') + ': ' + bad.slice(0, 2).map((x) => `salt ${x.s} tick ${x.d.tick} ${x.d.field} ${x.d.a} vs ${x.d.b}`));
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const anyBad = () => diffs.some((d) => [0, 1].some((st) => salts.some((s) => lane(s, d, st))));
for (const [k, v] of [['SLOW_REGEN_TICKS', 79], ['FAST_REGEN_TICKS', 9], ['STARVE_TICKS', 79], ['EXHAUSTION_STEP', 3.9], ['EX_SPRINT_JUMP', 0.25], ['SLOW_REGEN_EXHAUST', 5]]) {
  const o = Sv[k]; Sv[k] = v; brk(anyBad(), k + ' = ' + v); Sv[k] = o;
}
console.log(`hungerlockstepcheck: ${8 + 6} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
