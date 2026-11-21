#!/usr/bin/env node
// borderentitycheck.mjs — #8308: the world-border clip applies to every entity in Physics.move, not only the player.
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
NS.World.get = () => emptyChunk; NS.Section.get = () => 0;
const WB = NS.World.border, Ph = NS.Physics;
function run() {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  WB.setSize(20); WB.centerX = 0; WB.centerZ = 0;      // east edge x=10
  NS.Player = { x: 0, y: 200, z: 0, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8 };
  const z = { x: 5, y: 200, z: 0, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.95 };
  const it = { x: 5, y: 200, z: 0, vx: 0, vy: 0, vz: 0, width: 0.25, height: 0.25 };
  for (const e of [z, it]) {
    for (let i = 0; i < 40; i++) Ph.move(e, 0.5, 0, 0);
    ok(Math.abs(e.x + e.width / 2 - 10) < 1e-6, `entity w=${e.width} box edge ${e.x + e.width / 2}, want 10`);
  }
  const out = { x: 15, y: 200, z: 0, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.95 };
  Ph.move(out, 0.5, 0, 0);
  ok(Math.abs(out.x - 15.5) < 1e-6, `outside mob was clipped: x=${out.x}`);
  return fails;
}
const fails = run();
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(' assertions passed .. 3\n failures ........... 0');
const orig = WB.clipAxis; let caught = 0;
WB.clipAxis = (pos, hw, d) => d;
if (run().length) { caught++; console.log('✓ break caught'); }
WB.clipAxis = (pos, hw, d) => (pos > 10 ? 0 : d) && Math.min(d, 10 - hw - pos);
if (run().length) { caught++; console.log('✓ break caught'); }
WB.clipAxis = orig;
console.log(`${caught} breaks caught`);
process.exit(caught === 2 ? 0 : 1);
