#!/usr/bin/env node
// autojumpcheck.mjs — ClientPlayerEntity.autoJump (options.autoJump), driven through Ph.tick.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// anti-vacuity: each break edits the physics source; the check must then fail
const BREAKS = [
  ['headroom', "if (Ph.shapeAt(cx, Math.floor(e.y + H) + 1, cz) !== null) return;", ''],
  ['jumpfactor', 'if (Ph.jumpFactorOf(e) < 1) return;', 'e.autoJumpTicks = 1;'],
  ['sneak', 'cmd.sneak || e.vehicle', 'e.vehicle'],
  ['option', "if (e.autoJumpEnabled === true) Ph.autoJump", 'if (true) Ph.autoJump'],
  ['fence-top', 'var maxStep = 1.2 +', 'var maxStep = 9 +']
];
const BRK = process.env.AJ_BREAK === undefined ? -1 : +process.env.AJ_BREAK;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '03_section.js', '05_mesher.js', '14b_physics.js']) {
  let src = readFileSync(join(ROOT, 'src', f), 'utf8');
  if (BRK >= 0 && f === '14b_physics.js') { if (!src.includes(BREAKS[BRK][1])) throw new Error('break target missing'); src = src.replace(BREAKS[BRK][1], BREAKS[BRK][2]); }
  new Function('MCL', src)(NS);
}
const gm = JSON.parse(readFileSync(join(ROOT, 'assets/block-geometry.meta.json'), 'utf8'));
const rm = JSON.parse(readFileSync(join(ROOT, 'assets/block-runtime.meta.json'), 'utf8'));
NS.Reg.init({ runtime: readFileSync(join(ROOT, 'assets/block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
  geometry: readFileSync(join(ROOT, 'assets/block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes });
NS.Blocks.init();
const Ph = NS.Physics;
NS.World = { getBlock: () => 0, get: () => null };
const CUBE = [[0, 0, 0, 1, 1, 1]], SLAB = [[0, 0, 0, 1, 0.5, 1]], FENCE = [[0.375, 0, 0.375, 0.625, 1.5, 0.625]];
let shapes = new Map();
Ph.shapeAt = (x, y, z) => y < 1 ? CUBE : (shapes.get(x + ',' + y + ',' + z) || null);

let pass = 0; const fails = []; const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// walk -Z (yaw 0) from z=0.5 toward a ledge at z=-3; returns { maxY, jumpTick }
function walk(setup, { enabled = true, sneak = false } = {}) {
  shapes = new Map(); setup(shapes);
  const e = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, autoJumpEnabled: enabled };
  let maxY = 1, jumpTick = -1;
  for (let t = 0; t < 40; t++) {
    Ph.tick(e, { fwd: 1, strafe: 0, jump: false, sneak, sprint: false });
    if (jumpTick < 0 && e.vy > 0.3) jumpTick = t;
    maxY = Math.max(maxY, e.y);
  }
  return { maxY, jumpTick, e };
}
const wall = (shape, h) => m => { for (let x = -3; x <= 3; x++) for (let z = -8; z <= -3; z++) for (let y = 1; y < 1 + h; y++) m.set(x + ',' + y + ',' + z, shape); };
const col = (shape, ys) => m => { for (let x = -3; x <= 3; x++) for (let z = -8; z <= -3; z++) for (const y of ys) m.set(x + ',' + y + ',' + z, shape); };

const ledge = walk(wall(CUBE, 1));
ok(ledge.maxY >= 2 - 1e-6, 'one-block ledge: player climbs onto it (maxY ' + ledge.maxY + ')');
ok(ledge.jumpTick > 0, 'jump starts after the move that met the ledge, not on tick 0 (' + ledge.jumpTick + ')');
const ledge2 = walk(wall(CUBE, 1)); ok(ledge2.jumpTick === ledge.jumpTick, 'jump tick is deterministic');
ok(walk(wall(CUBE, 1), { enabled: false }).maxY < 1.01, 'option OFF: no jump');
ok(walk(wall(CUBE, 1), { sneak: true }).maxY < 1.01, 'sneaking: no jump');
ok(walk(wall(CUBE, 2)).maxY < 1.01, '2-block wall: no jump');
ok(walk(col(FENCE, [1])).maxY < 1.01, 'fence (1.5): no jump');
const slab = walk(col(SLAB, [1]));
ok(slab.jumpTick < 0 && slab.maxY >= 1.5 - 1e-6, 'slab: stepped without a jump (' + slab.jumpTick + ', ' + slab.maxY + ')');
const ceil = walk(m => { wall(CUBE, 1)(m); for (let x = -3; x <= 3; x++) for (let z = -8; z <= 1; z++) m.set(x + ',3,' + z, CUBE); });
ok(ceil.maxY < 1.01, 'no headroom above the player: no jump');

if (BRK < 0) {
  let caught = 0;
  for (let i = 0; i < BREAKS.length; i++) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, AJ_BREAK: String(i) }, encoding: 'utf8' });
    if (r.status === 1) caught++; else fails.push('break "' + BREAKS[i][0] + '" not caught');
  }
  console.log(caught + ' breaks caught');
}
console.log(fails.length ? 'autojumpcheck FAIL\n' + fails.join('\n') : 'autojumpcheck ok — ' + pass + ' assertions');
process.exit(fails.length ? 1 : 0);
