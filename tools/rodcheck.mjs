#!/usr/bin/env node
// rodcheck.mjs — s128 (G20): the LIGHTNING ROD and COPPER WEATHERING.
//   src/07zzc_lightning.js  Lgt.getLightningRodPos / setRodPowered / rodScheduledTick / the trap veto
//   src/07zu_poi.js         the lightning_rod POI type (ticketCount 0)
//   src/07f_redstone.js     LightningRodBlock.getWeak/StrongRedstonePower
//   src/07zze_oxidize.js    Oxidizable + Degradable (random-tick weathering) + cleanOxidation
// Every number is the code's own, read off .decomp (ServerWorld.getLightningRodPos :472-482,
// LightningRodBlock, LightningEntity :69-237, Oxidizable, Degradable) — cited in those files.
//
//   node tools/rodcheck.mjs [--verbose]
//
// ANTI-VACUITY (D-30/D-305): each section breaks its own input and asserts the break is caught.

import { loadEngine } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ anti-vacuity: ' + m); };

console.log('rodcheck — LIGHTNING ROD (redirect, power) + COPPER (weathering, the strike ring)');

const M = loadEngine({
  extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js',
          '07f_redstone.js', '09c_weather.js', '07zu_poi.js', '07zzc_lightning.js', '07zze_oxidize.js', '07zx_particle.js'],
  dom: false
});
const W = M.World, CH = M.CH, SR = M.States, R = M.Reg, Poi = M.Poi, Lgt = M.Lightning, Ox = M.Oxidize;
ok(!!(Poi && Lgt && Ox), 'Poi, Lightning and Oxidize modules loaded');
W.init(1);
for (let cx = -2; cx <= 10; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
M.Redstone.init();
const B = M.Behave, Rs = M.Redstone;
const st = (n) => SR.stateOf(n);
const name = (s) => R.names[SR.block[s]];
const put = (x, y, z, n) => W.setBlock(x, y, z, typeof n === 'number' ? n : st(n));
const rodFacing = (f) => B.setProp(st('lightning_rod'), 'facing', f);
/** A deterministic [0,1) stream from a list, then `fallback`. */
const seq = (list, fallback = 0.99) => { let i = 0; return () => (i < list.length ? list[i++] : fallback); };

console.log('\n1. the lightning_rod POI type — every rod state, ticketCount 0');
{
  put(5, 69, 5, 'stone'); put(5, 70, 5, rodFacing('up'));
  Poi.rescanNow();
  ok(Poi.getType({ x: 5, y: 70, z: 5 }) === Poi.LIGHTNING_ROD, 'a placed rod is indexed as LIGHTNING_ROD');
  ok(Poi.hasSpace({ x: 5, y: 70, z: 5 }) === false, 'ticketCount 0: a rod never has space (PointOfInterestType :75)');
  ok(Poi.TICKET_COUNT.home === 1 && Poi.TICKET_COUNT.meeting === 32, 'HOME/MEETING ticket counts unchanged');
  put(6, 69, 6, 'stone'); put(6, 70, 6, rodFacing('north'));
  Poi.rescanNow();
  ok(Poi.getType({ x: 6, y: 70, z: 6 }) === Poi.LIGHTNING_ROD, 'a sideways rod state is indexed too (getAllStatesOf)');
  put(6, 70, 6, 0); put(6, 69, 6, 0); Poi.rescanNow();
  okAv(Poi.getType({ x: 6, y: 70, z: 6 }) === null, 'a broken rod leaves the store on the next reconcile');
}

console.log('\n2. ServerWorld.getLightningRodPos — nearest, topmost, within 128');
{
  // the column the bolt rolled: bare stone floor at y=63
  for (let x = -2; x <= 2; x++) put(x, 63, 0, 'stone');
  const top = { x: 0, y: 64, z: 0 };
  let p = Lgt.getLightningRodPos(top);
  ok(p && p.x === 5 && p.y === 71 && p.z === 5, `the rod 5 blocks away takes the strike, on the cell above it (${JSON.stringify(p)})`);
  ok(JSON.stringify(Lgt.getLightningPos(0, 0)) === JSON.stringify({ x: 5, y: 71, z: 5 }),
    'getLightningPos returns the rod position before any entity/top search');
  // a nearer rod wins
  put(2, 64, 1, rodFacing('up')); Poi.rescanNow();
  p = Lgt.getLightningRodPos(top);
  ok(p && p.x === 2 && p.y === 65 && p.z === 1, 'of two rods the NEARER one (squared BlockPos distance) wins');
  // a rod under a roof is not the column's topmost block -> skipped
  put(2, 66, 1, 'stone'); Poi.rescanNow();
  p = Lgt.getLightningRodPos(top);
  okAv(p && p.x === 5, 'a rod with a block above it is refused (y == WORLD_SURFACE top - 1), the far rod takes it');
  put(2, 66, 1, 0); put(2, 64, 1, 0); put(5, 70, 5, 0); Poi.rescanNow();
  // 128 is the radius: a rod at dx=127 is found, one at dx=129 is not
  put(127, 63, 0, 'stone'); put(127, 64, 0, rodFacing('up')); Poi.rescanNow();
  p = Lgt.getLightningRodPos(top);
  ok(p && p.x === 127, 'a rod at distance 127 is inside the 128 circle');
  put(127, 64, 0, 0); put(129, 63, 0, 'stone'); put(129, 64, 0, rodFacing('up')); Poi.rescanNow();
  okAv(Lgt.getLightningRodPos(top) === null, 'a rod at distance 129 is outside MAX_REDIRECT_DISTANCE and not found');
  put(129, 64, 0, 0); Poi.rescanNow();
  ok(Lgt.getLightningRodPos(top) === null, 'no rod: null, and getLightningPos falls to the top position');
  put(5, 70, 5, rodFacing('up')); Poi.rescanNow();
}

console.log('\n3. the skeleton-horse trap is vetoed on a rod (ServerWorld.tickChunk :399-402)');
{
  const spawned = [];
  M.EntityList = { random: () => 0, list: [], canSpawn: () => true,
    spawn: (t, x, y, z, o) => { const e = { type: t, x, y, z, cosmetic: o && o.cosmetic }; spawned.push(e); return e; } };
  M.Sky = { weather: { raining: true }, newWeather() { return this.weather; }, isRainingAt: () => true };
  M.Spawn = { ready: true };
  Lgt.strikeAt(0, 0);
  ok(spawned.length === 1 && spawned[0].type === 'lightning_bolt' && spawned[0].x === 5.5 && spawned[0].y === 71,
    `a strike redirected to the rod spawns ONLY the bolt, on the rod (${spawned.map((e) => e.type).join(',')})`);
  ok(spawned[0] && !spawned[0].cosmetic, 'a rod strike is a real (non-cosmetic) bolt');
  spawned.length = 0;
  put(5, 70, 5, 0); Poi.rescanNow();
  Lgt.strikeAt(0, 0);
  okAv(spawned.some((e) => e.type === 'skeleton_horse'), 'the same roll with no rod DOES spring the trap');
  put(5, 70, 5, rodFacing('up')); Poi.rescanNow();
  M.EntityList = undefined;
}

console.log('\n4. powerLightningRod — 15 out, strong into the block it stands on, 8 ticks');
{
  B.clearSchedule();
  put(6, 69, 5, 'redstone_lamp');
  const bolt = { x: 5.5, y: 71, z: 5.5, ambientTick: 2, remainingActions: 1, cosmetic: true };
  ok(!Lgt.powerLightningRod({ x: 0.5, y: 64, z: 0.5 }), 'a bolt on bare stone powers nothing');
  M.Particle.clear();
  Lgt.tick(bolt);
  const rs = W.getBlock(5, 70, 5);
  // D-664: setPowered's syncWorldEvent(3002, pos, axis) — an UP rod's sparks run along Y only
  const sparks = M.Particle.list.filter((q) => q.type === 'electric_spark');
  ok(sparks.length >= 10 && sparks.length <= 19 && sparks.every((q) => q.vx === 0 && q.vz === 0 && Math.abs(q.x - 5.5) <= 0.125),
    `the powered rod throws 10..19 sparks along its own axis (${sparks.length})`);
  ok(B.propName(rs, 'powered') === 'true', 'the struck rod is POWERED (a cosmetic bolt too — no cosmetic guard)');
  ok([0, 1, 2, 3, 4, 5].every((d) => Rs.signal(rs, d, 5, 70, 5) === 15), 'weak power 15 in all six directions');
  ok(Rs.directSignal(rs, 1, 5, 70, 5) === 15, 'strong power toward FACING (up) — the stone it stands on');
  okAv(Rs.directSignal(rs, 0, 5, 70, 5) === 0 && Rs.directSignal(rs, 2, 5, 70, 5) === 0,
    'no strong power in any other direction');
  ok(B.propName(W.getBlock(6, 69, 5), 'lit') === 'true', 'a lamp beside the rod\'s stone lights through it (the notify reached it)');
  for (let t = 0; t < 7; t++) B.tick();
  ok(B.propName(W.getBlock(5, 70, 5), 'powered') === 'true', 'still powered after 7 ticks');
  B.tick();
  ok(B.propName(W.getBlock(5, 70, 5), 'powered') === 'false', 'unpowered on the 8th tick (SCHEDULED_TICK_DELAY)');
  for (let t = 0; t < 6; t++) B.tick();
  ok(B.propName(W.getBlock(6, 69, 5), 'lit') === 'false', 'the lamp goes out after the pulse');
  const down = B.setProp(rodFacing('down'), 'powered', true);
  ok(Rs.directSignal(down, 0, 0, 0, 0) === 15 && Rs.directSignal(down, 1, 0, 0, 0) === 0,
    'a hanging rod (facing down) strongly powers DOWN only');
  ok(!('lightning_rod' in Rs.OWED_SOURCES), 'lightning_rod is DELETED from Rs.OWED_SOURCES (D-139)');
}

console.log('\n5. Oxidizable — the chain, and state carried across tiers');
{
  ok(Ox.levelOf(st('copper_block')) === 0 && Ox.levelOf(st('exposed_copper')) === 1 &&
     Ox.levelOf(st('weathered_copper')) === 2 && Ox.levelOf(st('oxidized_copper')) === 3, 'copper levels 0..3');
  ok(Ox.levelOf(st('oxidized_cut_copper_stairs')) === 3 && Ox.levelOf(st('cut_copper_slab')) === 0, 'stairs/slab families');
  okAv(Ox.levelOf(st('waxed_exposed_copper')) === -1 && Ox.levelOf(st('stone')) === -1, 'waxed copper is NOT Oxidizable');
  const stairs = B.setProp(st('weathered_cut_copper_stairs'), 'facing', 'east');
  const bare = Ox.unaffected(stairs);
  ok(name(bare) === 'cut_copper_stairs' && B.propName(bare, 'facing') === 'east', 'getUnaffectedOxidationState keeps facing');
  ok(name(Ox.decreased(stairs)) === 'exposed_cut_copper_stairs', 'getDecreasedOxidationState is one step');
  ok(Ox.increased(st('oxidized_copper')) === null && Ox.decreased(st('copper_block')) === null, 'the ends of the chain');
  ok(B.hasRandomTick(st('exposed_copper')) && !B.hasRandomTick(st('oxidized_copper')) &&
     !B.hasRandomTick(st('waxed_copper_block')), 'random ticks: lower tiers yes, OXIDIZED and waxed no');
}

console.log('\n6. Degradable.tryDegrade — the neighbour census and the chance');
{
  const X = 40, Y = 80, Z = 0;
  const clear = () => { for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) for (let dz = -5; dz <= 5; dz++) put(X + dx, Y + dy, Z + dz, 0); };
  clear(); put(X, Y, Z, 'copper_block');
  ok(!Ox.tryDegrade(X, Y, Z, W.getBlock(X, Y, Z), seq([0.76])), 'alone at UNAFFECTED: 1*1*0.75 — 0.76 fails');
  ok(Ox.tryDegrade(X, Y, Z, W.getBlock(X, Y, Z), seq([0.74])) && name(W.getBlock(X, Y, Z)) === 'exposed_copper',
    'alone at UNAFFECTED: 0.74 passes and the block becomes exposed_copper');
  put(X + 2, Y + 2, Z, 'exposed_copper');   // Manhattan 4, same level -> f = 1/2, chance 0.25
  ok(!Ox.tryDegrade(X, Y, Z, W.getBlock(X, Y, Z), seq([0.26])), 'one same-level neighbour at Manhattan 4: 0.26 fails');
  ok(Ox.tryDegrade(X, Y, Z, W.getBlock(X, Y, Z), seq([0.24])), 'and 0.24 passes (((0+1)/(0+1+1))^2)');
  clear(); put(X, Y, Z, 'exposed_copper'); put(X + 1, Y, Z, 'copper_block');
  okAv(!Ox.tryDegrade(X, Y, Z, W.getBlock(X, Y, Z), seq([0])) && name(W.getBlock(X, Y, Z)) === 'exposed_copper',
    'a LOWER-level neighbour vetoes even a 0 roll');
  clear(); put(X, Y, Z, 'exposed_copper'); put(X + 3, Y + 2, Z, 'copper_block');   // Manhattan 5
  ok(Ox.tryDegrade(X, Y, Z, W.getBlock(X, Y, Z), seq([0.99])), 'a lower neighbour at Manhattan 5 is out of range');
  clear(); put(X, Y, Z, 'copper_block');
  ok(!Ox.randomTick(X, Y, Z, W.getBlock(X, Y, Z), seq([0.0569, 0])), 'tickDegradation: 0.0569 >= 0.05688889 skips');
  ok(Ox.randomTick(X, Y, Z, W.getBlock(X, Y, Z), seq([0.0568, 0])), 'tickDegradation: 0.0568 goes on to tryDegrade');
  clear();
}

console.log('\n7. cleanOxidation — the strike scrubs copper under a rod back to bare');
{
  const X = 60, Y = 80, Z = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) put(X + dx, Y, Z + dz, 'oxidized_copper');
  put(X, Y + 1, Z, rodFacing('up'));
  // walks = floor(0*3)+3 = 3; each walk 1 step (floor(0*8)+1); all ten draws land on (-1,-1,-1),
  // which is AIR under the copper sheet -> the walk finds nothing and stops
  const r = seq([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
  const n = Ox.cleanOxidation(X, Y + 1, Z, r);
  ok(name(W.getBlock(X, Y, Z)) === 'copper_block', 'the block the rod is fixed to goes straight to UNAFFECTED');
  ok(n === 1, `only the struck block: every walk's ten draws hit air (${n})`);
  ok(name(W.getBlock(X - 1, Y - 1, Z - 1)) === 'air' || W.getBlock(X - 1, Y - 1, Z - 1) === 0,
    'a walk draw on a non-copper cell does not count (fixture sanity)');
  // with the draws landing on (+0,-0,...) centre: offsets floor(r*3)-1; r=0.5 -> 0 -> the centre itself
  put(X, Y, Z, 'oxidized_copper'); put(X + 1, Y, Z, 'oxidized_copper');
  const r2 = seq([0, 0, 0.5, 0.5, 0.5, 0, 0.9, 0.5, 0.5, 0, 0.9, 0.5, 0.5], 0.5);
  M.Particle.clear();
  Ox.cleanOxidation(X, Y + 1, Z, r2);
  // D-664: each block a walk lands on fires 3002 with -1 — sparks on its six faces, 0.55 out
  const cs = M.Particle.list.filter((q) => q.type === 'electric_spark');
  ok(cs.length >= 18 && cs.some((q) => Math.abs(q.y - (Y + 0.5 + 0.55)) < 1e-9 || Math.abs(q.y - (Y + 0.5 - 0.55)) < 1e-9),
    `a walk step throws electric sparks on the block's faces (${cs.length})`);
  M.Particle.clear();
  Ox.cleanOxidation(X, Y + 1, Z, r);
  okAv(M.Particle.list.length === 0, 'a walk that found no copper threw no sparks');
  ok(name(W.getBlock(X, Y, Z)) === 'copper_block', 'struck block unaffected again');
  ok(name(W.getBlock(X + 1, Y, Z)) !== 'oxidized_copper', 'a walk onto the neighbour scrubs it one tier');
  put(X, Y, Z, 'waxed_oxidized_copper');
  okAv(Ox.cleanOxidation(X, Y + 1, Z, seq([], 0)) === 0 && name(W.getBlock(X, Y, Z)) === 'waxed_oxidized_copper',
    'waxed copper under a rod is left alone');
  // the live path: a bolt tick on the rod scrubs the block it is fixed to
  put(X, Y, Z, 'weathered_copper');
  Lgt.tick({ x: X + 0.5, y: Y + 2, z: Z + 0.5, ambientTick: 2, remainingActions: 0, cosmetic: true });
  ok(name(W.getBlock(X, Y, Z)) === 'copper_block', 'Lgt.tick calls cleanOxidation at the affected block');
}

console.log(`\nrodcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
