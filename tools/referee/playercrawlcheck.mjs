#!/usr/bin/env node
// lockstep-playercrawl -- #8767 (G17-L237): a player swims (sprint) into a one-block water tunnel under a ceiling, stops sprinting and walks out.
// Reference = .decomp PlayerEntity.updatePose (swimming/crouching/standing wanted; if the wanted box collides -> CROUCHING if that fits, else SWIMMING),
// Entity.wouldPoseNotCollide (the pose's box at the feet contracted by 1e-7 hits no collider), PlayerEntity.POSE_DIMENSIONS (1.8 / 1.5 / 0.6) and
// getStandingEyeHeight (1.62 / 1.27 / 0.4). The reference box test is written here against the cell map, not by asking Physics.
// Ceilings: a full block (gap 1.0: only SWIMMING fits) or a TOP slab (gap 1.5: CROUCHING fits). Per tick: height and eye height vs reference.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)), SRC = ROOT + 'src', ASSETS = ROOT + 'assets';
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '03_section.js', '05_mesher.js', '14b_physics.js'])
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
const gm = JSON.parse(readFileSync(join(ASSETS, 'block-geometry.meta.json'), 'utf8'));
const rm = JSON.parse(readFileSync(join(ASSETS, 'block-runtime.meta.json'), 'utf8'));
const PHYS = JSON.parse(readFileSync(join(ASSETS, 'block-physics.json'), 'utf8'));
NS.Reg.init({ runtime: readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
  geometry: readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes, physics: { defaults: PHYS.defaults, exceptions: PHYS.exceptions } });
NS.Blocks.init();
const Ph = NS.Physics, SR = NS.States;
const WATER = SR.stateOf('water'), STONE = SR.stateOf('stone'), SLAB = SR.stateOf('stone_slab');
const stream = (salt) => { let s = (salt * 2654435761 + 8767) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// scene along +z at x=0: floor y=63 stone; pool z -6..-1 water y=64,65; tunnel z 0..L-1 water y=64 under ceiling y=65; land z>=L (air, floor)
let L = 8, CEIL = 'stone';
const cell = (x, y, z) => {
  if (x < -2 || x > 2) return 0;
  if (y <= 63) return STONE;
  if (z < 0) return (z >= -6 && y <= 65) ? WATER : 0;
  if (z < L) return y === 64 ? WATER : (y === 65 ? (CEIL === 'stone' ? STONE : SLAB) : 0);
  return 0;
};
const boxes = (x, y, z) => { const s = cell(x, y, z); if (s === STONE) return [[0, 0, 0, 1, 1, 1]]; if (s === SLAB) return [[0, 0.5, 0, 1, 1, 1]]; return null; };
Ph.blockAt = (x, y, z) => cell(Math.floor(x), Math.floor(y), Math.floor(z));
Ph.shapeAt = (x, y, z) => boxes(Math.floor(x), Math.floor(y), Math.floor(z));
// reference pose table and collision test (independent of Physics)
const DIM = { standing: [1.8, 1.62], crouching: [1.5, 1.27], swimming: [0.6, 0.4] };
function refFits(e, pose) {
  const h = DIM[pose][0], e7 = 1e-7, x0 = e.x - 0.3 + e7, x1 = e.x + 0.3 - e7, z0 = e.z - 0.3 + e7, z1 = e.z + 0.3 - e7, y0 = e.y + e7, y1 = e.y + h - e7;
  for (let cx = Math.floor(x0); cx <= Math.floor(x1); cx++) for (let cy = Math.floor(y0); cy <= Math.floor(y1); cy++) for (let cz = Math.floor(z0); cz <= Math.floor(z1); cz++) {
    const bs = boxes(cx, cy, cz); if (!bs) continue;
    for (const b of bs) if (x0 < cx + b[3] && x1 > cx + b[0] && y0 < cy + b[4] && y1 > cy + b[1] && z0 < cz + b[5] && z1 > cz + b[2]) return false;
  }
  return true;
}
function refPose(e) {
  const want = e.fallFlying ? 'swimming' : e.swimming ? 'swimming' : e.crouching ? 'crouching' : 'standing';
  if (refFits(e, want)) return want;
  return refFits(e, 'crouching') ? 'crouching' : 'swimming';
}
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
function lane(salt, ceil) {
  CEIL = ceil; L = 5 + Math.floor(stream(salt)() * 6);
  const r = stream(salt + 100), sprintTicks = 20 + Math.floor(r() * 40), sneakAfter = r() < 0.4;
  const e = { x: 0.5, y: 64, z: -5.5, vx: 0, vy: 0, vz: 0, yaw: Math.PI, pitch: 0, onGround: false, flying: false, noclip: false, height: 1.8, eyeHeight: 1.62, fallDistance: 0, type: 'player' };
  const seen = new Set();
  for (let t = 0; t < 140; t++) {
    const sprint = t < sprintTicks;
    const pre = { x: e.x, y: e.y, z: e.z };   // updatePose runs at the start of the tick, before the move
    Ph.tick(e, { fwd: 1, strafe: 0, jump: false, sneak: !sprint && sneakAfter && t % 7 < 3, sprint });
    const p = refPose({ x: pre.x, y: pre.y, z: pre.z, fallFlying: e.fallFlying, swimming: e.swimming, crouching: e.crouching }); seen.add(p);
    if (Math.abs(e.height - DIM[p][0]) > 1e-9 || Math.abs(e.eyeHeight - DIM[p][1]) > 1e-9) return { t, ref: p, got: [e.height, e.eyeHeight], z: e.z };
  }
  return { seen: [...seen] };
}
const run = (c) => { const res = []; for (let s = 0; s < 20; s++) res.push(lane(s, c)); return res; };
const cases = ['stone', 'slab'];
const all = {};
for (const c of cases) { const rs = run(c); const bad = rs.filter((x) => x.ref); all[c] = rs; ok(!bad.length, `${c} ceiling: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`); }
const seenAll = new Set(); for (const c of cases) for (const x of all[c]) (x.seen || []).forEach((p) => seenAll.add(p));
ok(seenAll.has('swimming') && seenAll.has('crouching') && seenAll.has('standing'), 'scenario reaches all three poses: ' + [...seenAll]);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const anyBad = () => cases.some((c) => run(c).some((x) => x.ref));
const pf = Ph.poseFits; Ph.poseFits = () => true;
brk(anyBad(), 'stand-up collision test removed'); Ph.poseFits = pf;
const sw = Ph.POSE.swimming; Ph.POSE.swimming = { w: 0.6, h: 0.8, eye: 0.4 };
brk(anyBad(), 'swimming height 0.6 -> 0.8'); Ph.POSE.swimming = sw;
console.log(`playercrawlcheck: ${2 * 20 + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
