#!/usr/bin/env node
// lockstep-horsetemper -- #6897 (G17-L180): lockstep scenario 'horsetemper', 20 salts. An untamed horse is fed (Mount.interact) sugar, apple,
// golden carrot and hay (HorseBaseEntity.receiveFood: heal, temper, eating animation), ridden by a scripted player (HorseBondWithPlayerGoal.tick:
// nextInt(50)==0, nextInt(max) < temper -> bondWithPlayer, else addTemper(5) + eject + angry), then saddled and charged at power 0.4 / 1.0
// (setJumpStrength: 0.4F + 0.4F*c/90, float) and bred (setChildAttributes: 0.4F/0.45F float literals). Per tick: temper, tamed, owner, health,
// rider, angry, angryTicks, eatingTicks, jumpStrength, jump velocity. The reference is written from .decomp HorseBaseEntity/HorseBondWithPlayerGoal.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ENT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'entities.json'), 'utf8'));

const SALTS = 20, TICKS = 1500, f = Math.fround;
const stream = (salt) => { let s = (salt * 2654435761 + 777) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const FOOD = { sugar: [1, 3], apple: [3, 3], golden_carrot: [4, 5], hay_block: [20, 0] };
const SCRIPT = { 5: 'sugar', 10: 'apple', 15: 'golden_carrot', 20: 'hay_block', 21: 'apple', 22: 'apple' }, CHARGES = [0, 90, 45, 89];   // temper pinned to the 100 cap at tick 21
const MOUNT_AT = 30, SADDLE_AFTER = 1200;   // saddled once tamed or at this tick
const rowOf = (h, jv) => [h.temper | 0, !!h.tamed, h.owner || '-', h.health, !!h.rider, !!h.angry, h.angryTicks | 0, h.eatingTicks | 0, h.jumpStrength || 0, jv].join(',');

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07h_entities.js', '07m_breed.js', '07n_tame.js', '07r_mount.js', '07k_goals.js'], dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: ENT }); M.Entities.init(); M.Breed.init(); M.Mount.init();
  const r = stream(salt), h = { type: 'horse', x: 0, y: 64, z: 0, health: 1, maxHealth: 30, temper: 0, jumpStrengthAttr: 0.7 };
  M.Mount.ready = true;
  const goal = new M.Ai.HorseBondWithPlayerGoal(h, { random: r }), rows = [];
  let jv = 0;
  for (let t = 0; t < TICKS; t++) {
    if (t === 21) h.temper = 100;
    if (t === 23) h.temper = 0;
    if (SCRIPT[t]) M.Mount.interact(h, SCRIPT[t], {});
    if (t >= MOUNT_AT && !h.rider && !h.tamed && !h.angry) M.Mount.mount(h);
    if (h.rider && !h.tamed) goal.tick();
    M.Mount.tickAnger(h); M.Mount.tick(h);
    if (h.tamed && !h.saddled) h.saddled = true;
    if (h.saddled && t % 100 === 0) { M.Mount.setJumpStrength(h, CHARGES[(t / 100) % 4]); jv = h.jumpStrengthAttr * h.jumpStrength; }
    rows.push(rowOf(h, jv));
  }
  const a = { jumpStrengthAttr: 0.6, movementSpeedAttr: 0.2, maxHealth: 28 }, b = { jumpStrengthAttr: 0.8, movementSpeedAttr: 0.3, maxHealth: 32 }, c = {};
  M.Mount.setChildAttributes(c, a, b, stream(salt + 100));
  rows.push([c.maxHealthAttr, c.jumpStrengthAttr, c.movementSpeedAttr].join(','));
  return rows;
}

function reference(salt) {
  const r = stream(salt), ni = (n) => Math.floor(r() * n);
  const h = { temper: 0, tamed: false, owner: null, health: 1, rider: false, angry: false, angryTicks: 0, eatingTicks: 0, js: 0, saddled: false };
  const rows = []; let jv = 0;
  for (let t = 0; t < TICKS; t++) {
    if (t === 21) h.temper = 100;
    if (t === 23) h.temper = 0;
    if (SCRIPT[t]) {
      const [heal, tmp] = FOOD[SCRIPT[t]];
      let did = false;
      if (h.health < 30) { h.health = Math.min(30, h.health + heal); did = true; }
      if (tmp > 0 && (did || !h.tamed) && h.temper < 100) { h.temper = Math.min(100, h.temper + tmp); did = true; }
      if (did) h.eatingTicks = 1;
    }
    if (t >= MOUNT_AT && !h.rider && !h.tamed && !h.angry) h.rider = true;
    if (h.rider && !h.tamed && ni(50) === 0) {
      if (ni(100) < h.temper) { h.tamed = true; h.owner = 'player'; }
      else { h.temper = Math.min(100, h.temper + 5); h.rider = false; if (!h.angry) { h.angryTicks = 1; h.angry = true; } }
    }
    if (h.angryTicks > 0 && ++h.angryTicks > 20) { h.angryTicks = 0; h.angry = false; }
    if (h.eatingTicks > 0 && ++h.eatingTicks > 30) h.eatingTicks = 0;
    if (h.tamed) h.saddled = true;
    if (h.saddled && t % 100 === 0) { const c = CHARGES[(t / 100) % 4]; h.angryTicks = 1; h.angry = true; h.js = c >= 90 ? 1 : f(f(0.4) + f(f(f(0.4) * c) / 90)); jv = 0.7 * h.js; }
    rows.push([h.temper, h.tamed, h.owner || '-', h.health, h.rider, h.angry, h.angryTicks, h.eatingTicks, h.js, jv].join(','));
  }
  const q = stream(salt + 100), nd = () => q();
  const hb = f(15) + ni0(q, 8) + ni0(q, 9);
  const jb = f(0.4) + nd() * 0.2 + nd() * 0.2 + nd() * 0.2;
  const sb = (f(0.45) + nd() * 0.3 + nd() * 0.3 + nd() * 0.3) * 0.25;
  rows.push([(28 + 32 + hb) / 3, (0.6 + 0.8 + jb) / 3, (0.2 + 0.3 + sb) / 3].join(','));
  return rows;
}
function ni0(q, n) { return Math.floor(q() * n); }

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    let a, b;
    try { a = engine(s, patch); } catch (e) { return { bad: 1, first: 'engine threw ' + e.message }; }
    b = reference(s);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const breaks = [
  ['temper limit < -> <=', (file, s) => file === '07r_mount.js' ? s.replace('Mnt.getTemper(e) < Mnt.maxTemperOf(e)', 'Mnt.getTemper(e) <= Mnt.maxTemperOf(e)') : s],
  ['bond roll < -> <=', (file, s) => file === '07k_goals.js' ? s.replace('Math.floor(rand() * max) < temper', 'Math.floor(rand() * max) <= temper') : s],
  ['failed bond addTemper 5 -> 4', (file, s) => file === '07r_mount.js' ? s.replace('Mnt.BOND_FAIL_TEMPER = 5', 'Mnt.BOND_FAIL_TEMPER = 4') : s],
  ['sugar heal 1 -> 2', (file, s) => file === '07r_mount.js' ? s.replace('sugar:                 { heal: 1,', 'sugar:                 { heal: 2,') : s],
  ['jump charge 90 -> 80', (file, s) => file === '07r_mount.js' ? s.replace('charge >= 90', 'charge >= 80') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`horsetemper: ${caught} breaks caught, ${base.bad} divergences${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
