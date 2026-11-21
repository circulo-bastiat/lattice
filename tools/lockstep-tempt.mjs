#!/usr/bin/env node
// lockstep-tempt -- #6902 (G17-L185): lockstep scenario 'tempt', 20 salts. Five animals (cow, pig, sheep, chicken, horse) in a field, a scripted
// player walking with wheat, carrots, seeds, golden apple, carrot_on_a_stick, nothing. The engine's real Ai.TemptGoal is driven (start / canContinueToUse /
// tick / stop, the GoalSelector order) and compared per tick with TemptGoal.canStart/shouldContinue/tick/stop: running flag, target, cooldown (seen
// through when canStart next succeeds), the 2.5 block stop (squaredDistance < 6.25), the 10 block range, pos. Path and physics are stubbed
// identically on both sides (a straight 0.2*speed step), so this proves the goal state machine, not the navigator. Head look is not modelled by
// Ai.TemptGoal and is not compared.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 900;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const SEEDS = ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'];
const FOOD = {
  cow: ['wheat'], sheep: ['wheat'], pig: ['carrot', 'potato', 'beetroot'], chicken: SEEDS,
  horse: ['golden_apple', 'golden_carrot', 'enchanted_golden_apple'],
};
const SPEED = { cow: 1.25, pig: 1.2, sheep: 1.1, chicken: 1.0, horse: 1.25 };
const ITEMS = ['wheat', 'carrot', 'wheat_seeds', 'golden_apple', 'carrot_on_a_stick', null];
const tempts = (type, it) => !!it && (FOOD[type].includes(it) || (type === 'pig' && it === 'carrot_on_a_stick'));
const CD = 100;

function setup(salt) {
  const r = stream(salt);
  const types = Object.keys(FOOD);
  const animals = types.map((type) => ({ type, x: (r() - 0.5) * 24, y: 64, z: (r() - 0.5) * 24 }));
  const script = []; let item = null, left = 0, px = -12 + r() * 4, pz = (r() - 0.5) * 10, dir = 1;
  for (let t = 0; t < TICKS; t++) {
    if (left-- <= 0) { item = ITEMS[Math.floor(r() * ITEMS.length)]; left = 40 + Math.floor(r() * 120); dir = r() < 0.5 ? 1 : -1; }
    if (item !== null && t % 7 !== 0) px += 0.1 * dir; else if (r() < 0.2) pz += 0.1 * dir;
    script.push({ x: px, y: 64, z: pz, held: item });
  }
  return { animals, script };
}
const step = (e, tx, tz, sp) => { const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1, m = Math.min(d, 0.2 * sp); e.x += dx / d * m; e.z += dz / d * m; };
const fmt = (a) => a.map((e) => [e.run, e.x.toFixed(6), e.z.toFixed(6), e.tgt].join(',')).join('|');

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07k_goals.js'], dom: false }), Ai = M.Ai;
  Ai.findPath = (sx, sy, sz, tx, ty, tz) => [{ x: sx, y: sy, z: sz }, { x: tx, y: ty, z: tz }];
  Ai.stepToward = (e, n, sp) => { step(e, n.x, n.z, sp); };
  const { animals, script } = setup(salt), p = { x: 0, y: 64, z: 0, heldItem: null, offHandItem: null }, rows = [];
  const es = animals.map((a) => { const e = Object.assign({}, a); e.g = new Ai.TemptGoal(e, SPEED[e.type], () => [p], (it) => tempts(e.type, it)); e.run = false; return e; });
  for (let t = 0; t < TICKS; t++) {
    Object.assign(p, script[t], { heldItem: script[t].held });
    for (const e of es) {
      if (e.run && !e.g.canContinueToUse()) { e.g.stop(); e.run = false; }
      if (!e.run && e.g.canUse()) { e.g.start(); e.run = true; }
      if (e.run) e.g.tick();
      e.tgt = e.run && e.g.target() === p;
    }
    rows.push(fmt(es));
  }
  return rows;
}

function reference(salt) {
  const { animals, script } = setup(salt), es = animals.map((a) => Object.assign({ run: false, cd: 0, tgt: false }, a)), rows = [];
  const canStart = (e, p) => {
    if (e.cd > 0) { e.cd--; return false; }
    const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
    return dx * dx + dy * dy + dz * dz <= 100 && tempts(e.type, p.held);
  };
  for (let t = 0; t < TICKS; t++) {
    const p = script[t];
    for (const e of es) {
      if (e.run && !canStart(e, p)) { e.run = false; e.cd = CD; }
      if (!e.run && canStart(e, p)) e.run = true;   // GoalSelector.tick: stop, then the start pass in the same tick
      if (e.run) { const dx = p.x - e.x, dz = p.z - e.z; if (dx * dx + dz * dz >= 6.25) step(e, p.x, p.z, SPEED[e.type]); }
      e.tgt = e.run;
    }
    rows.push(fmt(es));
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
  ['cooldown 100 -> 60', (f, s) => f === '07k_goals.js' ? s.replace('Ai.TEMPT_COOLDOWN = 100;', 'Ai.TEMPT_COOLDOWN = 60;') : s],
  ['stop at 2.5 -> 3.5', (f, s) => f === '07k_goals.js' ? s.replace('Ai.TEMPT_STANDOFF = 2.5;', 'Ai.TEMPT_STANDOFF = 3.5;') : s],
  ['range 10 -> 6', (f, s) => f === '07k_goals.js' ? s.replace('Ai.TEMPT_RANGE = 10;', 'Ai.TEMPT_RANGE = 6;') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`tempt: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
