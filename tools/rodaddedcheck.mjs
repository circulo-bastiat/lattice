#!/usr/bin/env node
// rodaddedcheck.mjs — s128 (G20): the LIGHTNING ROD and COPPER WEATHERING.
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

console.log("rodaddedcheck — LightningRodBlock.onBlockAdded / onStateReplaced");

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
const pw = (f) => B.setProp(B.setProp(st('lightning_rod'), 'facing', f), 'powered', true);
const isP = (x, y, z) => B.propName(W.getBlock(x, y, z), 'powered') === 'true';

function run(label) {
  console.log('\n' + label);
  put(5, 69, 5, 'stone'); put(5, 70, 5, 0);
  put(5, 70, 5, pw('up'));
  const a = !isP(5, 70, 5);
  put(9, 69, 5, 'stone'); put(9, 70, 5, 0);
  B.schedule(9, 70, 5, 8, 0);
  put(9, 70, 5, pw('up'));
  const b = isP(9, 70, 5);
  for (let t = 0; t < 10; t++) B.tick();
  const c = !isP(9, 70, 5);
  return [a, b, c];
}
const [a, b, c] = run('1. a powered rod placed with no queued tick drops to unpowered; a queued one waits for its tick');
ok(a, 'unqueued powered rod placed -> unpowered (onBlockAdded)');
ok(b, 'queued powered rod keeps POWERED until its tick');
ok(c, 'queued rod unpowers after the 8-tick tick');
const saved = Lgt.rodChanged;
Lgt.rodChanged = () => {};
const [a2] = run('2. anti-vacuity: hook removed');
okAv(a2 === false, 'with the hook removed the placed powered rod stays powered');
Lgt.rodChanged = saved;

console.log('\n3. onStateReplaced: replacing a powered rod tells the block it was fixed to');
{
  put(5, 70, 5, 0); put(5, 70, 5, pw('up'));
  put(5, 70, 5, 0);
  ok(W.getBlock(5, 70, 5) === 0, 'rod replaced by air');
  let told = 0; const oc = B.changed;
  put(13, 69, 5, 'stone');
  B.schedule(13, 70, 5, 8, 0); put(13, 70, 5, pw('up'));
  B.changed = function (x, y, z, o) { if (x === 13 && y === 69 && z === 5) told++; return oc.apply(this, arguments); };
  put(13, 70, 5, 0);
  B.changed = oc;
  ok(told > 0, 'the support block was updated when a powered rod was removed');
}
console.log(`\nrodaddedcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
