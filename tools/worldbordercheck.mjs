#!/usr/bin/env node
// worldbordercheck.mjs — G17 world border (#5625): the clip, the lerp, the damage maths.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = {}; globalThis.MCL = NS;
NS.Survive = NS.Survive || {};
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
                 '02c_states.js', '03_section.js', '05_mesher.js', '07_world.js', '14b_physics.js'])
  new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
const rm = JSON.parse(readFileSync(join(ROOT, 'assets/block-runtime.meta.json'), 'utf8'));
const gm = JSON.parse(readFileSync(join(ROOT, 'assets/block-geometry.meta.json'), 'utf8'));
NS.Reg.init({ runtime: readFileSync(join(ROOT, 'assets/block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
  geometry: readFileSync(join(ROOT, 'assets/block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes });
NS.Blocks.init();
const emptyChunk = { state: NS.CH.GENERATED, sec: Array.from({ length: 24 }, () => null) };
NS.World.get = () => emptyChunk; NS.Section.get = () => 0;      // an all-air world
const WB = NS.World.border, Ph = NS.Physics;

function run() {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  let t = 0; WB.now = () => t;
  WB.setSize(100); WB.centerX = 0; WB.centerZ = 0;
  // clip: a player in the air pushed at the east edge stops at 50 - halfwidth
  const p = NS.Player = { x: 40, y: 200, z: 0, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, noclip: false };
  for (let i = 0; i < 100; i++) Ph.move(p, 0.5, 0, 0);
  ok(p.x <= 50 - 0.3 + 1e-6, `player passed the border: x=${p.x}`);
  ok(p.x >= 50 - 0.3 - 1e-6, `player stopped short of the edge: x=${p.x}`);
  const q = NS.Player = { x: 0, y: 200, z: -40, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8 };
  for (let i = 0; i < 100; i++) Ph.move(q, 0, 0, -0.5);
  ok(Math.abs(q.z + 49.7) < 1e-6, `north edge: z=${q.z}`);
  // damage: floor(-(dist+5)*0.2) min 1
  ok(WB.contains(49.9, 0) && !WB.contains(50, 0), 'contains edges');
  ok(Math.abs(WB.distanceInside(60, 0) + 10) < 1e-9, 'distanceInside');
  const dmg = (d) => Math.max(1, Math.floor(-(d + WB.safeZone) * WB.damagePerBlock));
  ok(dmg(-10) === 1 && dmg(-30) === 5, 'damage formula');
  // lerp
  WB.setSize(100); t = 1000;
  WB.lerpSize(20, 10000);
  ok(WB.stage() === 'shrinking', 'stage shrinking');
  t = 6000; ok(Math.abs(WB.size() - 60) < 1e-9, `half-way size ${WB.size()}`);
  t = 11000; ok(WB.size() === 20 && WB.stage() === 'stationary', 'end of lerp');
  return fails;
}
let fails = run();
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(' assertions passed .. 9\n failures ........... 0');
// anti-vacuity: remove the clip, the check must notice
const orig = WB.clipAxis; let caught = 0;
WB.clipAxis = (pos, hw, d) => d;
if (run().length) { caught++; console.log("✓ break caught"); }
WB.clipAxis = orig;
const o2 = WB.size; WB.size = function () { return this.newSize; };
if (run().length) { caught++; console.log("✓ break caught"); }
WB.size = o2;
console.log(`${caught} breaks caught`);
process.exit(caught === 2 ? 0 : 1);
