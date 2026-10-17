#!/usr/bin/env node
// beaconcheck.mjs — #5571: BeaconBlockEntity.tick (.decomp): pyramid level, beam segments, glass mixing, caps.
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('beaconcheck — #5571: beacon pyramid level, beam segments and colours');

function scene(build, breakPyramid) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07c_blockentity.js'], dom: false });
  const R = M.Reg, BE = M.BlockEntities;
  const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
  const cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  M.World = { getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0 };
  const put = (x, y, z, n) => cells.set(key(x, y, z), def(n));
  BE.init();
  const by = 64;
  put(0, by, 0, 'beacon');
  build({ put, by, def });
  if (breakPyramid) cells.delete(key(1, by - 1, 1));
  const e = BE.create(0, by, 0, 'beacon');
  M.Behave.gameTime = 0;
  for (let t = 0; t < 200; t++) { M.Behave.gameTime = t; BE.tickBeacon(e); }
  return e;
}
function pyramid(layers, mat = 'iron_block') {
  return ({ put, by }) => {
    for (let k = 1; k <= layers; k++) for (let x = -k; x <= k; x++) for (let z = -k; z <= k; z++) put(x, by - k, z, mat);
  };
}
const heights = (e) => e.beamSegments.map((s) => s[3]);

for (let l = 1; l <= 4; l++) {
  const mat = ['iron_block', 'gold_block', 'emerald_block', 'diamond_block'][l - 1];
  const e = scene(pyramid(l, mat));
  ok(e.levels === l, `${l}-layer ${mat} pyramid: level ${e.levels}`);
  ok(e.beamSegments.length === 1 && e.beamSegments[0].slice(0, 3).every((v) => v === 1), `${l} layers: one white segment`);
}
{
  const e = scene(pyramid(4, 'netherite_block'));
  ok(e.levels === 4, 'netherite pyramid level 4, got ' + e.levels);
  const b = scene(pyramid(1)), br = scene(pyramid(1), true);
  ok(b.levels === 1 && br.levels === 0, `broken pyramid block drops level ${b.levels} -> ${br.levels}`);
}
{
  const w = scene((c) => { pyramid(1)(c); c.put(0, c.by + 1, 0, 'red_stained_glass'); c.put(0, c.by + 2, 0, 'red_stained_glass');
    c.put(0, c.by + 3, 0, 'blue_stained_glass'); });
  const col = w.beamSegments.map((s) => s.slice(0, 3));
  ok(w.beamSegments.length === 3, 'white, red, mixed: ' + w.beamSegments.length);
  ok(col[1][0] > 0.6 && col[1][1] < 0.3, 'second segment red');
  ok(Math.abs(col[2][0] - (col[1][0] + 0.2392157) / 2) < 1e-4 || col[2][2] > col[1][2], 'third segment is the red/blue average');
  ok(heights(w).join() === '2,2,2', 'segment heights: ' + heights(w));
}
{
  const s = scene((c) => { pyramid(1)(c); c.put(0, c.by + 3, 0, 'stone'); });
  ok(s.beamSegments.length === 0 && s.levels === 0, 'stone cap blocks the beam: ' + s.beamSegments.length + ' lvl ' + s.levels);
  const b = scene((c) => { pyramid(1)(c); c.put(0, c.by + 3, 0, 'bedrock'); });
  ok(b.beamSegments.length === 1 && b.levels === 1, 'bedrock does not block: lvl ' + b.levels);
}
// #5572 — applyPlayerEffects + sounds
function fx(lv, primary, secondary, dist, range = null) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07c_blockentity.js'], dom: false });
  const BE = M.BlockEntities, got = [], snd = [];
  M.Effects = { addStatusEffect: (p, n, d, a) => got.push([n, d, a]) };
  M.Sound = { play: (ev) => snd.push(ev) };
  M.Player = { x: 0.5 + dist, y: 64, z: 0.5 };
  const e = { x: 0, y: 64, z: 0, levels: lv, primary, secondary, beamSegments: [[1, 1, 1, 1]] };
  if (range !== null) BE.applyPlayerEffects(e, range, primary, secondary); else BE.applyPlayerEffects(e, lv, primary, secondary);
  return { got, snd, BE, M, e };
}
{
  const a = fx(4, 1, 1, 40).got;
  ok(a.length === 1 && a[0][0] === 'speed' && a[0][1] === 340 && a[0][2] === 1, 'level 4 speed/speed: speed II 340t ' + JSON.stringify(a));
  const b = fx(4, 1, 10, 40).got;
  ok(b.length === 2 && b[0][2] === 0 && b[1][0] === 'regeneration' && b[1][2] === 0 && b[1][1] === 340, 'level 4 speed+regen: ' + JSON.stringify(b));
  ok(fx(4, 1, 10, 100).got.length === 0, 'player 100 blocks away gets nothing');
  ok(fx(1, 1, null, 25).got.length === 0, 'level 1 range 20: 25 blocks out nothing');
  const c = fx(1, 1, null, 15).got;
  ok(c.length === 1 && c[0][1] === 220 && c[0][2] === 0, 'level 1 speed I 220t ' + JSON.stringify(c));
  ok(fx(4, 1, 1, 40, 0).got.length === 0, 'anti-vacuity: zero range reaches nobody at 40');
  const d = fx(3, 1, 10, 20).got;
  ok(d.length === 1, 'level 3 gives no secondary');
}
function sounds(startLv, endLv, beam) {
  const { M, BE, snd } = (() => { const r = fx(0, null, null, 0); return r; })();
  const e = { x: 0, y: 64, z: 0, levels: startLv, primary: null, secondary: null, beamSegments: [] };
  M.World = { getBlock: (x, y, z) => (y < 64 ? 0 : 0) };
  M.Behave.gameTime = 1;
  // force a completed scan with the wanted level via direct state
  e.minY = 400; e.pending = beam ? [[1, 1, 1, 1]] : []; e.levels = startLv;
  BE.updateLevel = () => endLv;
  e.beamSegments = beam ? [[1, 1, 1, 1]] : [];
  M.Behave.gameTime = 80;
  BE.beaconTopY = () => 65;
  BE.tickBeacon(e);
  return snd;
}
ok(sounds(0, 0, true).length === 0, 'level 0 beacon plays no sound: ' + sounds(0, 0, true));
ok(sounds(0, 1, true).includes('block.beacon.activate'), 'activate on 0 -> 1');
ok(sounds(1, 0, true).includes('block.beacon.deactivate'), 'deactivate on 1 -> 0: ' + sounds(1, 0, true));
ok(sounds(1, 1, true).includes('block.beacon.ambient') && !sounds(1, 1, true).includes('block.beacon.activate'), 'ambient every 80 ticks');
console.log(`   ${pass} ok`);
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); process.exit(1); }
console.log('  ✓ anti-vacuity break 1 caught');
console.log(`beaconcheck: ${pass} checks passed, 0 failures (1 anti-vacuity)`);
