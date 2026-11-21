#!/usr/bin/env node
// lockstep-foxeat -- #6943 (G17-L203): lockstep scenario 'foxeat', 20 salts. FoxEntity.tickMovement eating loop (.decomp 184-205: eatingTime++,
// >560 a 10% roll plays the eat sound + status 45 particles, >600 finishUsing + food effects, reset), canPickupItem (466-470) and loot (490-506)
// for dropped sweet_berries / glow_berries / rabbit / chicken / bone, and the sweet-berry-bush ripeness test (EatSweetBerriesGoal.isTargetPos,
// AGE >= 2). The engine's real Fx.mobTick / Fx.loot / Fx.EatSweetBerriesGoal run against a hand reference; per-tick held item, eating ticks,
// effects, sound/particle counts and the rng position are compared. Items/Equip are minimal stubs (the Java food table), the Fox code is real.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 2500;
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const NAMES = ['air', 'sweet_berries', 'glow_berries', 'rabbit', 'chicken', 'bone', 'bowl'];
const FOOD = [0, 1, 1, 1, 1, 0, 0];
const FX = { chicken: [['hunger', 600, 0, 0.3]] };

function scenario(salt) {
  const r = stream(salt), drops = [];
  for (let k = 0; k < 6; k++) drops.push({ t: Math.floor(r() * TICKS), i: 1 + Math.floor(r() * 5), n: 1 + Math.floor(r() * 3) });
  drops.sort((a, b) => a.t - b.t);
  return { drops, eat0: Math.floor(r() * 300), start: 1 + Math.floor(r() * 5), age: Math.floor(r() * 4) };
}
const key = (L) => L.join('|');

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07k_goals.js', '07zj_fox.js'], dom: false });
  const sc = scenario(salt), log = { snd: 0, par: 0, fx: [] }, list = [];
  M.Items = { ready: true, MAINHAND: 0, nutrition: FOOD, of: (n) => NAMES.indexOf(n), nameOf: (i) => NAMES[i] };
  M.Equip = {
    getEquipped: (e, s) => (e.equip ? e.equip[s] || null : null),
    setEquipped: (e, s, st) => { e.equip = e.equip || []; e.equip[s] = st || null; },
    setDropChance: () => {}, triggerPickedUp: () => {}, stackOf: (n) => ({ i: NAMES.indexOf(n), n: 1, d: 0 }),
  };
  M.Sound = { play: () => { log.snd++; } };
  M.Particles = { spawn: () => { log.par++; return {}; } };
  M.Effects = { addStatusEffect: (e, n, d, a) => { log.fx.push(n + d + a); } };
  M.EntityList = { list, aiCtx: () => null, dropStack: () => null };
  const e = { type: 'fox', x: 0, y: 64, z: 0, onGround: true, eatingTime: sc.eat0, equip: [{ i: sc.start, n: 2, d: 0 }] };
  const r = stream(salt + 100), rows = []; let di = 0;
  for (let k = 0; k < TICKS; k++) {
    while (di < sc.drops.length && sc.drops[di].t === k) { const d = sc.drops[di++]; list.push({ type: 'item', item: NAMES[d.i], count: d.n, x: 0.5, y: 64, z: 0.5, pickupDelay: 0 }); }
    M.Fox.mobTick(e, r);
    const h = e.equip[0];
    rows.push(key([h ? h.i + 'x' + h.n : '-', e.eatingTime, log.snd, log.par, log.fx.join(','), list.filter((o) => !o.removed).length, Math.floor(r() * 1e6)]));
  }
  // bush ripeness: the real goal's target test via a stubbed world is registry-bound; compare the age>=2 rule on the real state table
  return rows;
}

function reference(salt) {
  const sc = scenario(salt), r = stream(salt + 100), rows = [];
  let snd = 0, par = 0; const fx = [], items = []; let di = 0;
  let held = { i: sc.start, n: 2 }, eating = sc.eat0;
  for (let k = 0; k < TICKS; k++) {
    while (di < sc.drops.length && sc.drops[di].t === k) { const d = sc.drops[di++]; items.push({ i: d.i, n: d.n, gone: false }); }
    eating++;
    for (const o of items) {
      if (o.gone) continue;
      const can = !held || (eating > 0 && FOOD[o.i] && !FOOD[held.i]);
      if (can) { if (held) snd++; held = { i: o.i, n: 1 }; o.gone = true; eating = 0; break; }
    }
    if (held && FOOD[held.i]) {
      if (eating > 600) {
        snd++; r(); r();
        for (const f of FX[NAMES[held.i]] || []) if (r() < f[3]) fx.push(f[0] + f[1] + f[2]);
        held.n--; if (held.n <= 0) held = NAMES[held.i] === 'bowl' ? null : null;
        eating = 0;
      } else if (eating > 560 && r() < 0.1) {
        snd++; for (let q = 0; q < 8; q++) { r(); r(); } par += 8;
      }
    }
    rows.push(key([held ? held.i + 'x' + held.n : '-', eating, snd, par, fx.join(','), items.filter((o) => !o.gone).length, Math.floor(r() * 1e6)]));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const breaks = [
  ['eating threshold 560 -> 600', (f, s) => f === '07zj_fox.js' ? s.replace('Fx.EAT_START = 560', 'Fx.EAT_START = 600') : s],
  ['berry bush age condition >= 2 -> >= 3', (f, s) => f === '07zj_fox.js' ? s.replace('return ageOfBush(st) >= 2;', 'return ageOfBush(st) >= 3;') : s],
  ['canPickupItem ignores held food', (f, s) => f === '07zj_fox.js' ? s.replace('&& !isFoodStack(held))', '&& isFoodStack(held))') : s],
];
// the bush rule is checked on the real state table: ripe (age>=2) test over ages 0..3
function bushBad(patch) {
  const M = loadEngine({ patch, extra: ['07k_goals.js', '07zj_fox.js'], dom: false });
  const R = M.Reg, S = M.States; let bad = 0;
  const bush = R.id.sweet_berry_bush, blocks = {};
  for (let st = 0; st < S.block.length; st++) if (S.block[st] === bush) blocks[st] = true;
  M.World = { getBlock: (x) => x };
  const g = new M.Fox.EatSweetBerriesGoal({ x: 0.5, y: 64, z: 0.5, yaw: 0 }, { mobGriefing: () => true });
  const e = { x: 0, y: 0, z: 0 };
  // age is a state property: probe via the goal on a one-cell world per state
  for (const st of Object.keys(blocks).map(Number)) {
    M.World = { getBlock: (x, y, z) => (x === 0 && y === 0 && z === 0 ? st : 0) };
    const gg = new M.Fox.EatSweetBerriesGoal(e, { mobGriefing: () => true });
    const age = +R.valueNames[S.propValue(st, R.PROP.age)];
    if (gg.canUse() !== (age >= 2)) bad++;
  }
  return bad + (Object.keys(blocks).length ? 0 : 1);
}
base.bad += bushBad();
ok = base.bad === 0;
for (const [name, p] of breaks) {
  const x = run(p), b = name.startsWith('berry') ? bushBad(p) : 0;
  if (x.bad > 0 || b > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`foxeat: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
