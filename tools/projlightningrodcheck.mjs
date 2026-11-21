#!/usr/bin/env node
// projlightningrodcheck.mjs - #8668: LightningRodBlock.onProjectileHit (Cb.PROJ_BLOCK_HIT.lightning_rod).
import { loadEngine, initRegistry } from './loadsrc.mjs';
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js',
          '14f_inventory.js', '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js',
          '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '14j_combat.js'],
  dom: false
});
initRegistry(M);
const Cb = M.Combat, ROD = M.States.stateOf('lightning_rod');
const player = { name: 'p' }; M.Player = player;
let thunder = true, sky = true, spawns = [];
M.Sky = { isThundering: () => thunder };
M.World = { getBlock: () => ROD, canSeeSky: () => sky };
M.EntityList.spawn = (t, x, y, z, o) => { spawns.push({ t, x, y, z, o }); return {}; };
const bh = { state: ROD, cx: 3, cy: 70, cz: 5 };
const run = (type, ench) => { spawns = []; Cb.projectileBlockHit({ type, shooter: player, pickupTag: ench ? { Enchantments: [{ id: 'minecraft:channeling', lvl: 1 }] } : null }, bh); return spawns; };
let r = run('trident', true);
ok(r.length === 1 && r[0].t === 'lightning_bolt' && r[0].x === 3.5 && r[0].y === 71 && r[0].z === 5.5 && r[0].o.channeler === player, 'channeling trident spawns one bolt with channeler');
thunder = false; ok(run('trident', true).length === 0, 'clear weather none'); thunder = true;
ok(run('trident', false).length === 0, 'no channeling none');
sky = false; ok(run('trident', true).length === 0, 'covered none'); sky = true;
ok(run('arrow', true).length === 0, 'arrow none');
// anti-vacuity: with the handler removed the positive case must go red
const h = Cb.PROJ_BLOCK_HIT.lightning_rod; delete Cb.PROJ_BLOCK_HIT.lightning_rod; breaks++;
if (run('trident', true).length === 0) pass++; else fails.push('anti-vacuity');
Cb.PROJ_BLOCK_HIT.lightning_rod = h;
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
