#!/usr/bin/env node
// raidexactcheck — #5123: isValidRaiderFor despawnCounter <= 2400; Rd.tick retries the spawn search in-tick.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const M = loadEngine({ dom: false, extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07z_potion.js',
  '07m_breed.js', '07zh_rabbit.js', '07zj_fox.js', '07zj_goat.js', '07zl_panda.js', '07q_effects.js', '07zm_axolotl.js', '07s_raid.js'] });
const Rd = M.Raid || (M.NS && M.NS.Raid);
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
ok(!!Rd, 'Raid module loaded');
const raid = () => Rd.create(1, { x: 0, y: 64, z: 0 }, 'normal');
const R = raid();
ok(Rd.isValidRaiderFor({ type: 'pillager', despawnCounter: 2400 }, R), 'counter 2400 recruited');
okAv(!Rd.isValidRaiderFor({ type: 'pillager', despawnCounter: 2401 }, R), 'counter 2401 refused');
ok(Rd.isValidRaiderFor({ type: 'pillager' }, R), 'no counter recruited');
// in-tick retries
const run = (failN) => {
  const r = raid(); let calls = 0, tiers = [], spawned = 0;
  const ctx = { isNearVillage: () => true, rand: { nextFloat: () => 0.5, nextInt: () => 0 }, heightAt: () => 64,
    spawnPos: (rr, t) => { calls++; tiers.push(t); return calls > failN ? { x: 0, y: 64, z: 0 } : null; },
    spawnFn: () => { spawned++; return { type: 'pillager', x: 0, y: 64, z: 0 }; } };
  Rd.tick(r, ctx);
  return { r, calls, tiers, spawned };
};
let o = run(3);
ok(o.calls === 4 && o.tiers.join() === '0,1,2,3', 'three failures then success inside ONE tick, tiers 0..3: ' + o.tiers);
okAv(o.r.status !== Rd.Status.STOPPED && o.spawned > 0, 'wave spawned in the same tick');
o = run(99);
okAv(o.r.status === Rd.Status.STOPPED && o.calls === 4, 'tier>3 invalidates in-tick (calls=' + o.calls + ')');
// precalculation: cached during countdown, consumed by the wave even after RNG advanced
{
  const r = raid(); r.wavesSpawned = 1; r.started = true; let n = 0, got = [];
  const ctx = { isNearVillage: () => true, rand: { nextFloat: () => 0.5, nextInt: () => 0 }, heightAt: () => 64,
    spawnPos: () => { n++; return { x: 100 + n, y: 64, z: 0 }; },
    spawnFn: (...a) => { return { type: 'pillager', x: 0, y: 64, z: 0 }; } };
  Rd.tick(r, ctx); // sets 300
  ok(r.preRaidTicks === 300 && !r.preCalculatedSpawn, 'warning starts, nothing cached yet');
  for (let i = 0; i < 10; i++) Rd.tick(r, ctx);
  const cached = r.preCalculatedSpawn; const calls = n;
  ok(!!cached && calls === 1, 'cached once during countdown (calls=' + calls + ')');
  okAv(cached && cached.x === 101, 'cached spot is the first draw');
  for (let i = 0; i < 20; i++) Rd.tick(r, ctx);
  ok(r.preCalculatedSpawn === cached, 'cache stable');
  n = 5000; // world RNG advanced
  r.preRaidTicks = 0; r.raiders = []; r.preRaidTicks = 1;
  let used = null; ctx.spawnFn = (t, x, y, z) => { used = used || { x }; return { type: 'pillager', x, y, z }; };
  const sw = Rd.spawnNextWave; let at = null;
  Rd.spawnNextWave = (rr, pos, ...a) => { at = pos; return sw(rr, pos, ...a); };
  Rd.tick(r, ctx); Rd.spawnNextWave = sw;
  okAv(at && at.x === 101, 'wave spawned at cached cell, not a fresh search (x=' + (at && at.x) + ')');
  ok(r.preCalculatedSpawn === null, 'cache reset after wave');
}

// #5141 canPlaceRaiderAt = SpawnHelper.canSpawn(ON_GROUND, ..., RAVAGER) + world border
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
const W = M.World, S = M.States;
W.init(1); M.Behave.init(W); M.EntityList.init(); M.Ai.init(); M.Spawn.init();
{ const c = W.makeChunk(0, 0); c.state = M.CH.GENERATED; W.chunks.set(W.key(0, 0), c); }
const st = (n) => S.stateOf(n) | 0;
const col = (x, cells) => { for (const [y, b] of cells) W.setBlock(x, y, 0, b); };
const can = (x) => Rd.canPlaceRaiderAt(M, x, 61, 0);
const STONE = st('stone');
col(1, [[60, STONE], [61, 0], [62, 0]]);
okAv(can(1), 'plain stone floor, two air cells: placeable');
col(2, [[60, STONE], [61, st('white_carpet')], [62, 0]]);
okAv(can(2), 'carpet in the feet cell is not a full cube: isClearForSpawn, placeable');
col(3, [[60, STONE], [61, st('oak_fence')], [62, 0]]);
okAv(can(3), 'fence in the feet cell is not a full cube: placeable');
col(4, [[60, STONE], [61, st('oak_slab')], [62, 0]]);
okAv(can(4), 'bottom slab in the feet cell is not a full cube: placeable');
col(5, [[60, STONE], [61, 0], [62, st('water')]]);
okAv(!can(5), 'water-filled head cell: refused');
col(6, [[60, st('oak_slab')], [61, 0], [62, 0]]);
okAv(!can(6), 'bottom slab floor has no sturdy top face: refused');
col(7, [[60, STONE], [61, 0], [62, st('stone')]]);
okAv(!can(7), 'full cube in the head cell: refused');
const edge = (x) => Rd.canPlaceRaiderAt({ World: { getBlock: (a, y) => (y < 61 ? STONE : 0) }, Behave: M.Behave, Spawn: M.Spawn }, x, 61, 0);
okAv(!edge(29999984) && !edge(-29999985), 'cells outside the world border refused');
{
  const heard = []; const pl = { x: 100, y: 64, z: 0 };
  const r = raid(); const ctx = { isNearVillage: () => true, rand: { nextFloat: () => 0.5, nextInt: () => 0 }, heightAt: () => 64,
    spawnPos: () => ({ x: 0, y: 64, z: 0 }), spawnFn: () => ({ type: 'pillager', x: 0, y: 64, z: 0 }),
    players: [pl], barPlayers: [pl], playSound: (ev, o) => heard.push([ev, o]) };
  Rd.tick(r, ctx);
  okAv(heard.length === 1 && heard[0][0] === 'event.raid.horn', 'horn once at wave start: ' + heard.length);
  okAv(heard[0] && Math.hypot(heard[0][1].x - 100, heard[0][1].z) > 12.99 && Math.hypot(heard[0][1].x - 100, heard[0][1].z) < 13.01 && heard[0][1].volume === 64, 'far player hears the 13-block offset position '+JSON.stringify(heard[0]));
  const h2 = []; ctx.players = [{ x: 500, y: 64, z: 0 }]; ctx.barPlayers = []; ctx.playSound = (e) => h2.push(e);
  Rd.playRaidHorn({ x: 0, y: 64, z: 0 }, ctx);
  okAv(h2.length === 0, 'player beyond 64 and off the bar hears nothing');
}
console.log(`\n${fails.length ? 'FAIL' : 'PASS'} raidexactcheck: ${pass} assertions, ${breaks} breaks caught, ${fails.length} failure(s)`);
console.log(`${breaks} breaks caught`);
if (fails.length) { fails.forEach(f => console.log('   x ' + f)); process.exit(1); }
