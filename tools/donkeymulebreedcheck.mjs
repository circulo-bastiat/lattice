#!/usr/bin/env node
// #11683: DonkeyEntity / MuleEntity breeding rules in 07m_breed.js (CHILD_SPECIES, MATE, CHILD).
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '07m_breed.js'], dom: false });
const Br = MCL.Breed;
let fails = 0, pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log('FAIL ' + m); } };
const mk = (t) => ({ type: t, x: 0, y: 0, z: 0, inLove: true, tamed: true, health: 30, maxHealth: 30 });
function run() {
  ok(Br.CHILD_SPECIES('donkey', 'donkey') === 'donkey', 'donkey+donkey -> donkey');
  ok(Br.CHILD_SPECIES('horse', 'donkey') === 'mule', 'horse+donkey -> mule');
  ok(Br.CHILD_SPECIES('donkey', 'horse') === 'mule', 'donkey+horse -> mule');
  ok(Br.CHILD_SPECIES('mule', 'mule') === 'mule', 'mule -> mule');
  ok(Br.canMate(mk('donkey'), mk('donkey')), 'donkey pair mates');
  ok(Br.canMate(mk('donkey'), mk('horse')), 'donkey x horse mates');
  ok(Br.canMate(mk('horse'), mk('donkey')), 'horse x donkey mates');
  ok(!Br.canMate(mk('mule'), mk('mule')), 'mule pair refuses');
  ok(!Br.canMate(mk('mule'), mk('donkey')), 'mule x donkey refuses');
  ok(typeof Br.CHILD.donkey === 'function' && typeof Br.CHILD.mule === 'function', 'CHILD rows exist');
}
run();
const orig = { cs: Br.CHILD_SPECIES, m: Br.MATE.mule, d: Br.CHILD.donkey, mu: Br.CHILD.mule };
const base = fails;
// breaks: cut each piece and prove the check notices
const cuts = [
  () => { Br.CHILD_SPECIES = (a) => a; },
  () => { Br.MATE.mule = () => true; },
  () => { delete Br.CHILD.donkey; },
  () => { delete Br.CHILD.mule; },
];
for (const cut of cuts) {
  Br.CHILD_SPECIES = orig.cs; Br.MATE.mule = orig.m; Br.CHILD.donkey = orig.d; Br.CHILD.mule = orig.mu;
  const f0 = fails; cut(); run();
  if (fails > f0) { breaks++; fails = f0; console.log('   ✓ cut caught'); } else console.log('FAIL cut not caught');
}
console.log(` assertions passed .. ${pass}\n failures ........... ${fails}\n ${breaks} breaks caught`);
process.exit(fails || breaks !== cuts.length ? 1 : 0);
