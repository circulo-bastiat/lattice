#!/usr/bin/env node
// endermandropcheck.mjs — #4745: a carried block drops at death (not at corpse removal), only under doMobLoot.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const MODS = []; for (const m of readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14b_physics.js', '14c_raycast.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, S = M.States;
EL.random = () => 0.5;
const dirt = S.stateOf('dirt') | 0;
const items = () => EL.list.filter((o) => o.type === 'item' && o.item === 'dirt').length;
// kill (dead, deathTime 0): the block must already be an item after the first death tick; `loot` = doMobLoot
const kill = (loot, carrying) => {
  EL.list.length = 0;
  M.Breed.mobLoot = () => loot;
  const e = EL.spawn('enderman', 0.5, 5, 0.5);
  e.carriedBlock = carrying ? dirt : null; e.dead = true; e.health = 0; e.deathTime = 0;
  Cb.tickEntity(e);
  return { e, n: items() };
};
console.log('endermandropcheck — #4745');
{ const r = kill(true, true); okAv(r.n >= 1 && r.e.carriedBlock === null && !r.e.removed, 'carried block dropped at death, corpse still present'); }
{ const r = kill(false, true); okAv(r.n === 0 && r.e.carriedBlock === null, 'doMobLoot false: nothing dropped'); }
{ const r = kill(true, false); ok(r.n === 0, 'empty-handed enderman drops no block'); breaks++; }
console.log('================ endermandropcheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('======================================================');
process.exit(fails.length ? 1 : 0);
