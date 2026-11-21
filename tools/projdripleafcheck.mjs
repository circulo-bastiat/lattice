#!/usr/bin/env node
// projdripleafcheck.mjs - #8667: BigDripleafBlock.onProjectileHit via Cb.PROJ_BLOCK_HIT.
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js',
          '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07i_entitylist.js',
          '07k_goals.js', '14j_combat.js', '07s_raid.js', '07zv_dripleaf.js'],
  dom: false
});
initRegistry(M);
const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
M.World = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; },
            get: () => null, getLight: () => 240, heightAt: () => 63, chunks: new Map() };
M.Behave.init(M.World); M.BlockEntities.init(); M.EntityList.list = [];
const B = M.Behave, Cb = M.Combat, D = M.Dripleaf, S = M.States;
const sounds = [], sched = [];
M.Sound = { play: (n) => sounds.push(n) };
B.schedule = (x, y, z, d) => sched.push(d);
M.Redstone = { receivedPower: () => 0 };
const LEAF = S.stateOf('big_dripleaf'), STEM = S.stateOf('big_dripleaf_stem');
const hit = (st) => {
  cells.clear(); cells.set(k(0, 0, 0), st); sounds.length = 0; sched.length = 0;
  Cb.projectileBlockHit({ type: 'arrow', shooter: null }, { state: st, cx: 0, cy: 0, cz: 0, face: 2, hx: 0.5, hy: 0.5, hz: 0.5 });
};
console.log('projdripleafcheck - BigDripleafBlock.onProjectileHit');
hit(LEAF);
ok(D.tilt(0, 0, 0) === 'full', 'arrow hit sets FULL immediately (no unstable/partial ramp)');
ok(sounds.length === 1, 'tilt_down played once (' + sounds.length + ')');
ok(sched.length === 1 && sched[0] === D.DELAY.full, 'one reset tick scheduled with the FULL delay ' + D.DELAY.full);
D.scheduledTick(0, 0, 0);
ok(D.tilt(0, 0, 0) === 'none', 'FULL tick returns to NONE');
hit(STEM);
ok(cells.get(k(0, 0, 0)) === STEM && sounds.length === 0 && sched.length === 0, 'hit on a stem does nothing');
const real = Cb.PROJ_BLOCK_HIT.big_dripleaf; delete Cb.PROJ_BLOCK_HIT.big_dripleaf; breaks++;
hit(LEAF);
ok(D.tilt(0, 0, 0) === 'none' && sounds.length === 0, 'handler reverted: leaf stays NONE');
Cb.PROJ_BLOCK_HIT.big_dripleaf = real;
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
