#!/usr/bin/env node
// lockstep-horsefeed -- #8654 (G18b-L39): lockstep scenario 'horsefeed', 20 salts. Adult and baby horse, donkey, mule, llama and trader llama are fed every
// food in turn (HorseBaseEntity.receiveFood / LlamaEntity.receiveFood: heal, growUp seconds*20 ticks for babies, lovePlayer only when tame + age 0 + not
// in love and decided BEFORE the grow, temper bump, playEatingAnimation for horses only). Salt seeds tamed, health, temper. Per feed: consumed, health,
// temper, age, inLove, eatingTicks. The reference is written from .decomp HorseBaseEntity/LlamaEntity.receiveFood.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ENT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'entities.json'), 'utf8'));
const SALTS = 20;
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TYPES = ['horse', 'donkey', 'mule', 'llama'];
const FOODS = ['wheat', 'sugar', 'hay_block', 'apple', 'golden_carrot', 'golden_apple', 'enchanted_golden_apple'];
const BABY_AGE = -24000, LOVE = 600;
const isLl = (t) => t === 'llama' || t === 'trader_llama';

function cases(salt) {
  const r = stream(salt), out = [];
  for (const type of TYPES) for (const baby of [false, true]) {
    const maxHealth = isLl(type) ? 30 : 30;
    out.push({ type, baby, tamed: r() < 0.5, health: 1 + Math.floor(r() * 12), temper: Math.floor(r() * (isLl(type) ? 31 : 101)), maxHealth, order: FOODS.slice().sort(() => r() - 0.5) });
  }
  return out;
}
const rowOf = (c, ok) => [ok, c.health, c.temper, c.age, c.inLove, c.eatingTicks].join(',');

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07h_entities.js', '07m_breed.js', '07n_tame.js', '07r_mount.js', '07k_goals.js'], dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: ENT }); M.Entities.init(); M.Breed.init(); M.Mount.init();
  M.Mount.ready = true;
  const rows = [];
  for (const c of cases(salt)) {
    const e = { type: c.type, x: 0, y: 64, z: 0, health: c.health, maxHealth: c.maxHealth, temper: c.temper, tamed: c.tamed, growAge: c.baby ? BABY_AGE : 0, isBaby: c.baby };
    for (const f of c.order) {
      e.eatingTicks = 0;
      const res = M.Mount.feed(e, f, {});
      rows.push(rowOf({ health: e.health, temper: e.temper, age: M.Breed.getAge(e), inLove: e.inLove | 0, eatingTicks: e.eatingTicks | 0 }, !!res));
    }
  }
  return rows;
}

function reference(salt) {
  const rows = [];
  for (const c of cases(salt)) {
    const ll = isLl(c.type), max = ll ? 30 : 100;
    const s = { health: c.health, temper: c.temper, age: c.baby ? BABY_AGE : 0, inLove: 0, eatingTicks: 0 };
    for (const f of c.order) {
      s.eatingTicks = 0;
      let heal = 0, grow = 0, tmp = 0, did = false, love = false;
      if (ll) {
        if (f === 'wheat') { grow = 10; tmp = 3; heal = 2; }
        else if (f === 'hay_block') { grow = 90; tmp = 6; heal = 10; love = true; }
      } else if (f === 'wheat') { heal = 2; grow = 20; tmp = 3; }
      else if (f === 'sugar') { heal = 1; grow = 30; tmp = 3; }
      else if (f === 'hay_block') { heal = 20; grow = 180; }
      else if (f === 'apple') { heal = 3; grow = 60; tmp = 3; }
      else if (f === 'golden_carrot') { heal = 4; grow = 60; tmp = 5; love = true; }
      else { heal = 10; grow = 240; tmp = 10; love = true; }
      const known = ll ? (f === 'wheat' || f === 'hay_block') : true;
      if (!known) { rows.push([false, s.health, s.temper, s.age, s.inLove, s.eatingTicks].join(',')); continue; }
      if (love && c.tamed && s.age === 0 && s.inLove <= 0) { did = true; s.inLove = LOVE; }
      if (s.health < c.maxHealth && heal > 0) { s.health = Math.min(c.maxHealth, s.health + heal); did = true; }
      if (s.age < 0 && grow > 0) { s.age = Math.min(0, s.age + grow * 20); did = true; }
      if (tmp > 0 && (did || !c.tamed) && s.temper < max) { s.temper = Math.min(max, s.temper + tmp); did = true; }
      if (did && !ll) s.eatingTicks = 1;
      rows.push([true, s.health, s.temper, s.age, s.inLove, s.eatingTicks].join(','));
    }
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    let a;
    try { a = engine(s, patch); } catch (e) { return { bad: 1, first: 'engine threw ' + e.message }; }
    const b = reference(s);
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} row ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const m = (from, to) => (file, s) => {
  if (file !== '07r_mount.js') return s;
  if (!s.includes(from)) throw new Error('break target not found: ' + from);
  return s.replace(from, to);
};
const breaks = [
  ['golden_apple heal 10 -> 8', m('golden_apple:          { heal: 10,', 'golden_apple:          { heal: 8,')],
  ['apple temper 3 -> 4', m('apple:                 { heal: 3,  grow: 60,  temper: 3 }', 'apple:                 { heal: 3,  grow: 60,  temper: 4 }')],
  ['hay_block grow 180 -> 120', m('grow: 180', 'grow: 120')],
  ['llama hay love dropped', m('temper: 6, love: true', 'temper: 6')],
  ['temper limit < -> <=', m('Mnt.getTemper(e) < Mnt.maxTemperOf(e)', 'Mnt.getTemper(e) <= Mnt.maxTemperOf(e)')],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`horsefeed: ${caught} breaks caught, ${base.bad} divergences${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
