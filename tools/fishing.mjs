#!/usr/bin/env node
// fishing.mjs — #325 G24i: bobber wait timer (Lure, rain), the 5x4x5 open-water scan, reeling a hooked cow.
// Runs against the real source, then against injected faults; each must be caught.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
console.log('fishing — #325 G24i: bobber wait / open water / hooked pull');
const SRC = readFileSync(fileURLToPath(new URL('../src/07zzq_fishing.js', import.meta.url)), 'utf8');
const JR = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js'], dom: false }).JRandom;
function load(src) {
  const NS = { JRandom: JR, EntityList: {}, Items: null };
  new Function('MCL', src.replace(/\}\)\(typeof MCL[\s\S]*$/, '})(MCL);'))(NS);
  return NS.Fishing;
}
// ticks from the first waitCountdown roll until the bite (hookCountdown set), mean over seeds
function meanWait(Fi, lure, rain) {
  let tot = 0, N = 300;
  for (let s = 1; s <= N; s++) {
    const e = { random: new JR(s), lureLevel: lure, waitCountdown: 0, fishTravelCountdown: 0, hookCountdown: 0, x: 0.5, y: 64, z: 0.5, fishAngle: 0 };
    const env = { hasRain: () => rain, skyVisible: () => true, isWater: () => true };
    let t = 0;
    while (!(e.hookCountdown > 0) && t < 5000) { Fi.tickFishingLogic(e, env, 0, 63, 0); t++; }
    tot += t;
  }
  return tot / N;
}
// world: still water everywhere at y<=63, air above, unless carve(x,y,z) says solid
function scan(Fi, solid) {
  const env = { positionType: (x, y, z) => solid(x, y, z) ? Fi.INVALID : y <= 63 ? Fi.INSIDE_WATER : Fi.ABOVE_WATER };
  return Fi.isOpenOrWaterAround(env, 0, 63, 0);
}
function run(src) {
  const Fi = load(src), f = [], ok = (c, m) => { if (!c) f.push(m); };
  const m0 = meanWait(Fi, 0, false), m3 = meanWait(Fi, 3, false), mr = meanWait(Fi, 0, true);
  ok(m3 < m0 - 40, 'lure III not shorter by ~300/n ticks: ' + m0.toFixed(1) + ' vs ' + m3.toFixed(1));
  ok(mr < m0 - 10, 'rain does not shorten the wait: ' + m0.toFixed(1) + ' vs ' + mr.toFixed(1));
  ok(scan(Fi, () => false), 'open pond is not open water');
  ok(!scan(Fi, (x, y, z) => y <= 63 && (Math.abs(x) > 0 || Math.abs(z) > 0)), '1x1 hole counted as open water');
  ok(!scan(Fi, (x, y) => y === 65), 'ceiling over the pond counted as open water');
  // 1x1 hole -> reel draws no treasure (Loot ctx.openWater false)
  const own = { x: 1, y: 64, z: 1 }, b = { x: 2, y: 65, z: 3, owner: own, state: Fi.FLYING, random: new JR(1) };
  const cow = { id: 9, type: 'cow', x: 4, y: 64, z: 7, height: 1.4, health: 20, vx: 0, vy: 0, vz: 0 };
  Fi.onEntityHit(b, cow);
  const dmg = Fi.reel(b, own, null, {});
  ok(dmg === 5 && cow.vx === (own.x - b.x) * 0.1 && cow.vz === (own.z - b.z) * 0.1, 'hooked cow not pulled');
  const hole = { x: 0.5, y: 64, z: 0.5, owner: own, state: Fi.BOBBING, random: new JR(2), inOpenWater: true, hookCountdown: 5, fishTravelCountdown: 0,
    lureLevel: 0, waitCountdown: 0, fishAngle: 0, vx: 0, vy: 0, vz: 0, width: 0.25 };
  const env = { fluidHeight: () => 0.9, rnd: () => 0.5, move() {}, positionType: (x, y, z) => (y <= 63 && (x || z)) ? Fi.INVALID : y <= 63 ? Fi.INSIDE_WATER : Fi.ABOVE_WATER };
  Fi.removeIfInvalid = () => false;
  Fi.tick(hole, env);
  ok(hole.inOpenWater === false, 'bobber in a 1x1 hole stays inOpenWater');
  return f;
}
const base = run(SRC);
if (base.length) { console.log('FAIL ' + base.join('; ')); process.exit(1); }
const faults = [
  ['lure term removed', (s) => s.replace(' - (e.lureLevel | 0) * 20 * 5', '')],
  ['rain term removed', (s) => s.replace('if (r.nextFloat() < 0.25 && env.hasRain && env.hasRain(bx, by + 1, bz)) n++;', 'r.nextFloat();')],
  ['open-water scan forced true', (s) => s.replace('Fi.isOpenOrWaterAround = function (env, bx, by, bz) {', 'Fi.isOpenOrWaterAround = function (env, bx, by, bz) { return true;')],
];
let caught = 0;
for (const [n, mut] of faults) {
  const src = mut(SRC);
  if (src === SRC) { console.log('FAIL fault "' + n + '" did not apply'); process.exit(1); }
  const r = run(src);
  if (r.length) { caught++; console.log('  ✓ caught: ' + n); } else { console.log('FAIL fault not caught: ' + n); process.exit(1); }
}
console.log('OK  8 checks passed, 0 failures; ' + caught + ' breaks caught');
