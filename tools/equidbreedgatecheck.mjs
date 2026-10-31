#!/usr/bin/env node
// #3933: Breed.canMate applies HorseBaseEntity.canBreed (tame, adult, no rider/vehicle, full health).
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '07m_breed.js'], dom: false });
const Br = MCL.Breed;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log('FAIL ' + m); } };
const mk = (t) => ({ type: t, x: 0, y: 0, z: 0, inLove: true, tamed: true, health: 30, maxHealth: 30 });
for (const t of ['horse', 'donkey', 'llama']) {
  ok(Br.canMate(mk(t), mk(t)), t + ' healthy tame pair mates');
  const cases = { hurt: e => { e.health = 29; }, ridden: e => { e.rider = 'player'; }, untamed: e => { e.tamed = false; }, baby: e => { e.growAge = -100; } };
  for (const k in cases) {
    const a = mk(t), b = mk(t); cases[k](a);
    breaks++; ok(!Br.canMate(a, b), t + ' ' + k + ' refuses'); console.log('   ✓ ' + t + ' ' + k + ' refused'); ok(!Br.canMate(b, a), t + ' partner ' + k + ' refuses');
  }
}
console.log(` assertions passed .. ${pass}\n failures ........... ${fails}\n breaks caught ...... ${breaks}`);
process.exit(fails ? 1 : 0);
