#!/usr/bin/env node
// tamedwolfhealcheck.mjs — #1698: WolfEntity.interactMob heals a hurt tamed wolf by food.getHunger().
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js']
});
const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Breed.init(); M.Tame.init();

// FoodComponents.*.getHunger() for the eleven .meat() foods (.decomp FoodComponents)
const HUNGER = { beef: 3, chicken: 2, cooked_beef: 8, cooked_chicken: 6, cooked_mutton: 6, cooked_porkchop: 8,
                 cooked_rabbit: 5, mutton: 2, porkchop: 3, rabbit: 3, rotten_flesh: 4 };
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const wolf = (hp, tamed = true) => ({ type: 'wolf', tamed, owner: 'player', health: hp, maxHealth: 20 });

function run(table) {
  const out = [];
  for (const [item, h] of Object.entries(table)) {
    const w = wolf(10), r = M.Tame.healWolf(w, item);
    out.push(`${item}: ${!!r && w.health === Math.min(20, 10 + h)}`);
    const w2 = wolf(19); M.Tame.healWolf(w2, item);
    out.push(`${item} cap: ${w2.health === 20}`);
  }
  return out;
}
for (const l of run(HUNGER)) ok(l.endsWith('true'), l);
ok(M.Tame.healWolf(wolf(20), 'cooked_beef') === null, 'full health -> falls through');
ok(M.Tame.healWolf(wolf(10, false), 'cooked_beef') === null, 'untamed wolf not healed');
ok(M.Tame.healWolf(wolf(10), 'wheat') === null, 'non-meat not healed');

// #1871: tamed owned cat heals from cod/salmon (nutrition 2), no love mode
const cat = (hp, o = true) => ({ type: 'cat', tamed: true, owner: o ? 'player' : 'x', health: hp, maxHealth: 10, inLove: 0 });
for (const it of ['cod', 'salmon']) {
  const c = cat(4), r = M.Tame.healWolf(c, it, { isOwner: true });
  ok(!!r && c.health === 6 && !c.inLove, 'cat heals from ' + it);
  ok(M.Tame.healWolf(cat(4), it, { isOwner: false }) === null, 'non-owner cat not healed');
  ok(M.Tame.healWolf(cat(10), it, { isOwner: true }) === null, 'full cat falls through');
}
// anti-vacuity: wrong expectations must be caught
for (const bad of [{ cooked_beef: 7 }, { rotten_flesh: 5 }, { rabbit: 2 }]) {
  breaks++;
  if (!run(bad).some(l => l.endsWith('false'))) fails.push('anti-vacuity: wrong hunger not caught ' + JSON.stringify(bad));
}
breaks++;
{ const f0 = M.Tame.healWolf; const c = cat(4); M.Tame.healWolf = (e, i, x) => e.type === 'wolf' ? f0(e, i, x) : null; M.Tame.healWolf(c, 'cod', { isOwner: true });
  if (c.health === 4) {} else fails.push('anti-vacuity: wolf-only mutation not caught'); M.Tame.healWolf = f0; }
breaks++;
{ const w = wolf(10); const f = M.Tame.healWolf; M.Tame.healWolf = () => null; M.Tame.healWolf(w, 'cooked_beef');
  if (w.health === 18) fails.push('anti-vacuity: stubbed heal'); M.Tame.healWolf = f; }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`PASS ${pass} assertions, ${breaks} breaks caught`);
