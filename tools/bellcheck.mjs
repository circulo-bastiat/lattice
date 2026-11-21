#!/usr/bin/env node
// bellcheck.mjs - #191: BellBlock.onUse / neighborUpdate / ring + BellBlockEntity resonate sound (.decomp BellBlock.java, BellBlockEntity.java).
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js',
          '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07i_entitylist.js',
          '07k_goals.js', '14j_combat.js', '14l_use.js', '07s_raid.js', '07zv7_vbbell.js'],
  dom: false
});
initRegistry(M);
const N = 64, MID = 32, cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const w = { get: (x, y, z) => cells[idx(x, y, z)], set: (x, y, z, s) => { cells[idx(x, y, z)] = s; return true; }, getLight: () => 240, heightAt: () => 63, chunks: new Map() };
w.getBlock = w.get; w.setBlock = w.set; M.World = w;
const B = M.Behave; B.init(w); M.BlockEntities.init(); M.EntityList.list = []; M.Redstone.init();
const sounds = [], stats = [];
M.Sound = { play: (ev) => sounds.push(ev) }; M.Stats = { inc: (id) => stats.push(id) };
const bell = (att, facing) => B.setProp(B.setProp(M.States.stateOf('bell'), 'attachment', att), 'facing', facing);
const put = (x, y, z, s) => { w.set(x, y, z, typeof s === 'number' ? s : M.States.stateOf(s)); B.changed(x, y, z); };
const reset = () => { sounds.length = 0; stats.length = 0; M.BlockEntities.clear(); };

console.log('bellcheck - BellBlock.onUse / neighborUpdate / resonate');
const use = (thy, face) => { reset(); put(0, 0, 0, bell('floor', 'north')); return M.Use.blockUse({ thy, tface: face, tx: 0, ty: 0, tz: 0 }, 0, 0, 0, w.get(0, 0, 0), null); };
const useOk = () => use(0.5, 5) === true && !!(M.BlockEntities.get(0, 0, 0) || {}).ringing && sounds.includes('block.bell.use') && stats.includes('bell_ring');
let be;
M.Use.init(w);
ok(useOk(), 'use on the bell body rings, plays block.bell.use, counts bell_ring');
be = M.BlockEntities.get(0, 0, 0); ok(be.lastSideHit === 'north', 'lastSideHit is the clicked face');
ok(use(0.9, 5) === false && !sounds.length && !stats.length, 'use above 0.8124 passes (no ring/sound/stat)');
ok(use(0.5, 0) === false, 'use on the wrong axis passes');
// redstone: rising edge rings facing direction, no stat, falling edge silent
reset(); put(0, 0, 0, bell('floor', 'east')); M.BlockEntities.create(0, 0, 0, 'bell');
put(1, 0, 0, 'redstone_block');
be = M.BlockEntities.get(0, 0, 0);
const rsOk = () => be.ringing && be.lastSideHit === 'east' && sounds.includes('block.bell.use') && !stats.length && B.propName(w.get(0, 0, 0), 'powered') === 'true';
ok(rsOk(), 'redstone rising edge rings toward FACING, powered set, no player stat');
sounds.length = 0; B.changed(1, 0, 0); ok(!sounds.length, 'no re-ring while powered');
put(1, 0, 0, 0); ok(!sounds.length && B.propName(w.get(0, 0, 0), 'powered') === 'false', 'falling edge is silent');
// resonate sound
reset(); put(0, 0, 0, bell('floor', 'north')); M.Bell.activate(0, 0, 0, 'north'); be = M.BlockEntities.get(0, 0, 0);
M.EntityList.list = [{ type: 'pillager', x: 3.5, y: 0.5, z: 0.5, dead: false }];
for (let i = 0; i < 6; i++) M.Bell.tick(be);
const resOk = () => sounds.includes('block.bell.resonate') && be.resonating;
ok(resOk(), 'raider in range at tick 5 starts resonating and plays block.bell.resonate');
// anti-vacuity: each broken run must be rejected
const origRing = M.Bell.ringBlock; M.Bell.ringBlock = () => false; breaks++;
ok(!useOk(), 'ringBlock disabled: use no longer rings'); M.Bell.ringBlock = origRing;
const origTick = M.Bell.tick; M.Bell.tick = () => {}; breaks++;
{ reset(); M.Bell.activate(0, 0, 0, 'north'); be = M.BlockEntities.get(0, 0, 0); for (let i = 0; i < 6; i++) M.Bell.tick(be); ok(!resOk(), 'tick disabled: no resonate'); }
M.Bell.tick = origTick;
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
