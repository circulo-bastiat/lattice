// dropstracecheck.mjs -- #6220 (G17-L15): server rows carry 'drops' (ItemEntity list after a kill); a changed loot weight is reported as field 'drops'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, ASSETS } from '../loadsrc.mjs';
import { drainDrops } from './lockstep/run.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  ✗ ' + m); } };
const brk = (c, m) => { n++; if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const base = { Pos: [0, 4, 0], Health: '0.0f' };
const items = [{ Item: { id: 'minecraft:rotten_flesh', Count: '2b' } }, { Item: { id: 'minecraft:iron_ingot', Count: '1b' } }, { Item: { id: 'minecraft:rotten_flesh', Count: '1b' } }];
const S = serverRow(10, base, { drops: items });
ok(JSON.stringify(S.drops) === '[["iron_ingot",1],["rotten_flesh",3]]', 'server drops merged, sorted, namespace stripped');
ok(serverRow(10, base).drops === null, 'no drop list -> null (skipped)');
const E = (d) => engineRow(10, { x: 0, y: 4, z: 0 }, { drops: d });
ok(compareTraces([S], [E([['rotten_flesh', 3], ['iron_ingot', 1]])], { fields: ['drops'] }) === null, 'matching engine drops agree');
const bad = compareTraces([S], [E([['rotten_flesh', 2], ['iron_ingot', 1]])], { fields: ['drops'] });
brk(bad && bad.field === 'drops' && bad.tick === 10, 'changed loot count reported at field drops');
brk(compareTraces([S], [E([['rotten_flesh', 3]])], { fields: ['drops'] })?.field === 'drops', 'missing loot entry reported as drops');
// #6258: live cow kill through Cb.dropLoot; EL.dropTrace -> ev.drops, Px.drainTally -> ev.particles.
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zx_particle.js', '14j_combat.js'], dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
M.Entities.init(); M.EntityList.init();
const live = (flip) => {
  const real = Math.random; let i = 0; const R = [0.75, 0.25, 0.5, 0.125, 0.9, 0.3];
  Math.random = () => R[i++ % R.length];
  try {
    M.EntityList.dropTrace = [];
    if (flip) { const L = M.Loot, f = L.entityDrops; L.entityDrops = (c) => f(c).map((d) => (d.item === 'beef' ? { item: d.item, count: d.count + 1 } : d)); }
    M.Combat.dropLoot({ type: 'cow', x: 0, y: 64, z: 0, health: 0 });
    return engineRow(7, {}, { drops: drainDrops(M.EntityList, (i) => M.Items.nameOf(i)), particles: {} });
  } finally { Math.random = real; }
};
const got = live(false);
console.log('  live cow drops:', JSON.stringify(got.drops));
const names = (got.drops || []).map((d) => d[0]);
ok(names.includes('beef'), 'live cow kill drops beef');
const fixture = serverRow(7, base, { drops: (got.drops || []).map(([id, c]) => ({ Item: { id: 'minecraft:' + id, Count: c + 'b' } })) });
ok(compareTraces([fixture], [got], { fields: ['drops'] }) === null, 'live cow drops equal the recorded drops fixture');
const bd = compareTraces([fixture], [live(true)], { fields: ['drops'] });
brk(bd && bd.field === 'drops' && bd.tick === 7, 'changed loot count is the first divergence on drops');
console.log(`dropstracecheck: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
