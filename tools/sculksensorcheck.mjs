#!/usr/bin/env node
// sculksensorcheck.mjs -- G17 (#5611): SculkSensorListener + SculkSensorBlock (src/07zzu_sculk.js), 1.18.2 values.
//   a frequency-5 event (hit_ground) 7 blocks away reaches the sensor after floor(dist)=7 ticks, power
//   getPower(7,8)=2, comparator reads 5, active 40 ticks then cooldown 1 tick; 9 blocks is out of range.
// Anti-vacuity: wrong range, wrong delay, wrong active length are each caught.
import { loadEngine } from './loadsrc.mjs';
console.log('sculksensorcheck -- G17 (#5611), sculk sensor: range 8, delay floor(dist), frequency, power, 40/1-tick phases');

function scenarios(patch, tweak) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); return c; };
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07zx_particle.js', '07zzu_sculk.js'], dom: false, patch });
  const R = M.Reg, B = M.Behave, Rs = M.Redstone, Sc = M.Sculk;
  if (tweak) tweak(Sc, M);
  const N = 40, MID = 20, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const world = {
    getBlock: (x, y, z) => cells[idx(x, y, z)],
    setBlock(x, y, z, id) { const old = cells[idx(x, y, z)]; cells[idx(x, y, z)] = id; B.changed(x, y, z, old); return true; },
    blockLightAt: () => 15,
  };
  const plays = []; M.Sound = { play: (ev, o) => { if (!(tweak && tweak.mute === ev)) plays.push([ev, o]); } };
  M.World = world;
  B.init(world); Rs.init(); Sc.reset();
  const def = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
  world.setBlock(0, 0, 0, def('sculk_sensor'));
  const st = () => world.getBlock(0, 0, 0);
  const ph = () => B.propName(st(), 'sculk_sensor_phase');
  const tick = () => B.tick();
  ok(Sc.emit('hit_ground', 9, 0, 0) === 0, 'out of range (9 blocks) not heard');
  ok(Sc.emit('not_an_event', 1, 0, 0) === 0, 'non-vibration event ignored');
  ok(Sc.emit('hit_ground', 7, 0, 0) === 1, '7 blocks heard');
  let t = 0; while (ph() === 'inactive' && t < 30) { tick(); t++; }
  ok(t === 7, 'activates after floor(dist)=7 ticks (got ' + t + ')');
  ok(ph() === 'active', 'active');
  const cl = plays.filter((p) => p[0] === 'block.sculk_sensor.clicking');
  ok(cl.length === 1 && cl[0][1].pitch >= 0.8 && cl[0][1].pitch < 1.0, 'activation queues one clicking play, pitch in [0.8,1.0)');
  ok(Rs.signal(st(), Rs.EAST, 0, 0, 0) === 2, 'redstone power getPower(7,8)=2');
  ok(Rs.analogOutput(0, 0, 0, st()) === 5, 'comparator reads frequency 5');
  ok(Sc.emit('step', 1, 0, 0) === 0, 'active sensor hears nothing');
  let a = 0; while (ph() === 'active' && a < 100) { tick(); a++; }
  ok(a === 40, 'active for 40 ticks (got ' + a + ')');
  ok(ph() === 'cooldown' && Rs.analogOutput(0, 0, 0, st()) === 0, 'cooldown, comparator 0');
  ok(plays.filter((p) => p[0] === 'block.sculk_sensor.clicking_stop').length === 1, 'cooldown queues one clicking_stop play');
  tick();
  ok(ph() === 'inactive', 'cooldown lasts 1 tick');
  // save/restore (#5900): frequency 11 survives BE.serializeAll/restoreAll, comparator still reads 11
  const BE = M.BlockEntities; BE.init();
  Sc.reset(); world.setBlock(0, 0, 0, def('sculk_sensor'));
  Sc.emit('block_open', 1, 0, 0); let u = 0; while (ph() === 'inactive' && u < 30) { tick(); u++; }
  ok(Rs.analogOutput(0, 0, 0, st()) === 11, 'comparator reads frequency 11 before save');
  const recs = JSON.parse(JSON.stringify(BE.serializeAll()));
  const rec = recs.find((r) => r.type === 'sculk_sensor');
  ok(rec && rec.lastVibrationFrequency === 11, 'saved record carries lastVibrationFrequency 11');
  BE.get(0, 0, 0).lastVibrationFrequency = 0; Sc.reset();
  BE.restoreAll(recs);
  ok(Rs.analogOutput(0, 0, 0, st()) === 11, 'comparator still reads 11 after restore');
  // §vibration trail: a pending vibration of delay N spawns one particle of lifetime N ending at the sensor centre
  M.Particle.init(); world.setBlock(0, 0, 0, 0); world.setBlock(0, 0, 0, def('sculk_sensor'));
  Sc.reset();
  ok(Sc.emit('hit_ground', 5, 0, 0) === 1, 'vibration trail: event heard');
  const vp = M.Particle.list.filter((q) => q.type === 'vibration');
  ok(vp.length === 1 && vp[0].maxAge === 5 && vp[0].scale === 0.3, 'one vibration particle, lifetime 5, size 0.3');
  for (let i = 0; i < 5; i++) M.Particle.tick();
  ok(vp.length === 1 && Math.abs(vp[0].x - 0.5) < 1e-9 && Math.abs(vp[0].y - 0.5) < 1e-9 && Math.abs(vp[0].z - 0.5) < 1e-9, 'path ends at the sensor centre');
  return { n, fails };
}

const base = scenarios();
for (const f of base.fails) console.log('  FAIL ' + f);
let breaks = 0;
for (const [name, tweak] of [['range 9', (S) => { S.RANGE = 9; }], ['active 30', (S) => { S.ACTIVE_TICKS = 30; }], ['no vibration spawn', (S, E) => { E.Particle.spawn = () => null; }], ['field dropped from BE.FIELDS', (S, E) => { delete E.BlockEntities.FIELDS.sculk_sensor; }], ['frequency table', (S) => { S.FREQUENCIES.hit_ground = 4; }],
  ['no clicking', Object.assign(() => {}, { mute: 'block.sculk_sensor.clicking' })], ['no clicking_stop', Object.assign(() => {}, { mute: 'block.sculk_sensor.clicking_stop' })]]) {
  const r = scenarios(undefined, tweak);
  if (r.fails.length) { breaks++; console.log('  ✓ break caught: ' + name); } else console.log('  NOT CAUGHT: ' + name);
}
console.log(`sculksensorcheck: ${base.n} assertions, ${base.fails.length} failures, ${breaks} breaks caught`);
process.exit(base.fails.length || breaks < 6 ? 1 : 0);
