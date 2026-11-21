#!/usr/bin/env node
// mobdrowncheck.mjs — #3103: LivingEntity.baseTick breath step for land mobs (.decomp LivingEntity.java:357-380).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, ASSETS } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('mobdrowncheck — #3103: land mobs drown, golem/water/undead mobs do not');

function run(patch) {
  const M = loadEngine({ patch,
    extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07q_effects.js', '07i_entitylist.js', '14j_combat.js', '07zk_undead.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  M.Entities.init();
  const hits = [];
  M.Combat.hurt = (e, a, x, y, o) => { hits.push([e.t, a, o && o.source]); };
  const EL = M.EntityList;
  const out = {};
  const drown = (type, ticks) => {
    const e = { type, eyeInWater: true, t: 0 };
    hits.length = 0;
    for (let i = 0; i < ticks; i++) { e.t = i; EL.tickMobAir(e); }
    return hits.slice();
  };
  // 300 air -> -20 hit at tick 320, air resets to 0, next hit 20 ticks later
  const pig = drown('pig', 345);
  out.pig = pig.length === 2 && pig[0][1] === 2 && pig[0][2] === 'drown' && pig[0][0] === 319 && pig[1][0] === 339;
  out.villager = drown('minecraft:villager', 345).length === 2;
  for (const t of ['iron_golem', 'squid', 'cod', 'guardian', 'turtle', 'axolotl', 'dolphin', 'drowned', 'zombie', 'skeleton']) out[t] = drown(t, 345).length === 0;
  const p = { type: 'pig', eyeInWater: false, air: 100 };
  EL.tickMobAir(p);
  out.refill = p.air === 104;
  // #5320: convertInWater copies equipment per slot, with drop chances and persistence
  {
    const U = M.Undead, z = { type: 'zombie', x: 0, y: 0, z: 0, persistent: true, equip: [{ i: 'iron_sword', n: 1, t: { a: 1 } }, null, { i: 'iron_helmet', n: 1 }], equipDropChance: [1, 0.085, 0.5] };
    M.EntityList.spawn = (t) => ({ type: t, equip: [], growAge: 0 });
    const d = U.convertInWater(z, 'drowned');
    out.equipDistinct = !!d && d.equip !== z.equip && d.equip[0] !== z.equip[0] && d.equip[0].i === 'iron_sword' && d.equip[2].i === 'iron_helmet' && d.equip[1] == null;
    if (d) { d.equip[0].n = 9; d.equip[0].t.a = 5; }
    out.equipIndep = z.equip[0].n === 1 && z.equip[0].t.a === 1;
    out.equipChance = !!d && !!d.equipDropChance && d.equipDropChance !== z.equipDropChance && d.equipDropChance[0] === 1 && d.equipDropChance[2] === 0.5;
    out.equipPersist = !!d && d.persistent === true;
  }
  return out;
}

const base = run(null);
for (const k of Object.keys(base)) ok(base[k], 'mob drown ' + k);
let caught = 0;
const brk = (a, b, F = '07i_entitylist.js') => (f, s) => f === F ? s.replace(a, b) : s;
const breaks = [
  ['if (e.air === -20) {', 'if (e.air === -99) {', 'pig'],
  ['iron_golem: 1 };', '};', 'iron_golem'],
  ['(NS.Effects && NS.Effects.isUndead(e))', 'false', 'zombie'],
  ['e.air + 4, 300', 'e.air + 1, 300', 'refill'],
  ['Object.assign({}, est,', 'Object.assign(est,', 'equipDistinct', '07zk_undead.js'],
  ['fresh.equipDropChance = e.equipDropChance.slice();', '', 'equipChance', '07zk_undead.js']
];
for (const [a, b, key, F] of breaks) {
  const r = run(brk(a, b, F));
  if (!r[key]) { caught++; console.log('  ✓ break caught: ' + key); } else fails.push('break not caught: ' + key);
}
ok(caught === breaks.length, 'all breaks caught');
console.log(`  ${caught} breaks caught`);
console.log(`mobdrowncheck: ${pass} checks passed, ${fails.length} failures (${caught} anti-vacuity)`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
