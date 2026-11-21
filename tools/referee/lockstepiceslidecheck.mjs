#!/usr/bin/env node
// lockstep-iceslide (harness from movecheck.mjs)
//
//   node tools/movecheck.mjs [--verbose]
//
// ⚠ WHAT MAKES THIS A REFEREE AND NOT A MIRROR. Every expectation below is computed HERE, from
// vanilla's law in closed form, and compared against what the engine actually does when it is
// ticked. Nothing asks `Physics` what it thinks the answer is. The law itself came out of the
// 1.18.2 server jar's bytecode (D-250/D-251), not out of anyone's memory of the wiki:
//
//     getFrictionInfluencedSpeed(f) = onGround ? speed * (0.21600002 / f³) : flyingSpeed
//     travel: f1 = onGround ? f*0.91 : 0.91;  delta += input·a;  move;
//             delta.xz *= blockSpeedFactor;  delta.y = (delta.y − 0.08)·0.98;  delta.xz *= f1
//
// and the steady state of v ← (v + a)·f1, measured as the displacement of the tick (which is the
// velocity BEFORE the damping), is a/(1 − f1). At default friction that is 0.098/0.454 = 0.21586
// blocks a tick = 4.317 blocks a second — vanilla's published walking speed, derived rather than
// fitted. That agreement is itself the strongest evidence the law is right, and §2 asserts it.
//
// The old model reached the same speed at friction 0.6 by construction and disagreed everywhere
// else, so ICE COULD NEVER HAVE BEEN CORRECT under it. §3 is the part that could not pass before.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ASSETS = MCLITE_ROOT + 'assets';
const SRC = MCLITE_ROOT + 'src';
const VERBOSE = false;

const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
                 '02c_states.js', '03_section.js', '05_mesher.js', '14b_physics.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const gm = JSON.parse(readFileSync(join(ASSETS, 'block-geometry.meta.json'), 'utf8'));
const rm = JSON.parse(readFileSync(join(ASSETS, 'block-runtime.meta.json'), 'utf8'));
const PHYS = JSON.parse(readFileSync(join(ASSETS, 'block-physics.json'), 'utf8'));
NS.Reg.init({
  runtime: readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
  geometry: readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes,
  physics: { defaults: PHYS.defaults, exceptions: PHYS.exceptions },
});
NS.Blocks.init();
const Ph = NS.Physics, R = NS.Reg, SR = NS.States;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
// ⚠ THE SUITE COUNTS THE TICKS, so an anti-vacuity case that passes silently is a deliberate
// break the summary cannot see (D-30's rule, and `suite.mjs` counts a literal ✓ per break).
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

// ── the fake world: a floor of one chosen block at y < 0, air above ─────────────────────────
// CEILING is a BOTTOM SLAB in cell y = 1, so the gap under it is exactly 1.5 blocks — the one
// height a crouching player fits in and a standing one does not. A full cube cannot express that:
// cells are integers, so a cube ceiling leaves a gap of 1 or of 2 and never of 1.5. This is why
// crouching under a slab is the canonical test and crouching under a block is not a test at all.
let FLOOR = 'stone', CEILING = false;
// a TOP slab: it occupies 1.5..2.0 of cell y = 1, so the free space under it is exactly 1.5
const SLAB = [[0, 0.5, 0, 1, 1, 1]];
const stateOf = (n) => SR.stateOf(n);
Ph.shapeAt = (x, y, z) => (y < 0 ? Ph.FULL_CUBE : (CEILING && y === 1 ? SLAB : null));
let LAVA_TOP = 0;   // lava fills cells 0 <= y < LAVA_TOP (stone below)
Ph.blockAt = (x, y, z) => (y < 0 ? stateOf(FLOOR) : (y < LAVA_TOP ? stateOf('lava') : (CEILING && y === 1 ? stateOf('stone_slab') : 0)));

const ent = (over) => Object.assign({
  x: 0.5, y: 0, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
  onGround: true, flying: false, inWater: false, noclip: false,
  height: Ph.H, eyeHeight: Ph.EYE, fallDistance: 0,
}, over || {});
const CMD = (over) => Object.assign({ fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false }, over || {});

/** Run n ticks and return the entity. */
function run(e, cmd, n) { for (let i = 0; i < n; i++) Ph.tick(e, cmd); return e; }
/** Blocks travelled in the last tick, horizontally. */
function stepOf(e, cmd) { const x0 = e.x, z0 = e.z; Ph.tick(e, cmd); return Math.hypot(e.x - x0, e.z - z0); }

// ── vanilla's law, in closed form, computed HERE ────────────────────────────────────────────
const SPEED = 0.1, SPRINT = 1.3, INPUT = 0.98, SNEAK = 0.3, CUBE = 0.21600002, AIR = 0.91;
function accel(friction, { sprint = false, sneak = false, diagonal = false } = {}) {
  let ix = diagonal ? INPUT : 0, iz = INPUT;
  if (sneak) { ix *= SNEAK; iz *= SNEAK; }
  const l2 = ix * ix + iz * iz, l = l2 > 1 ? Math.sqrt(l2) : 1;
  const inputLen = Math.hypot(ix / l, iz / l);
  return SPEED * (sprint ? SPRINT : 1) * (CUBE / (friction ** 3)) * inputLen;
}
/** steady-state displacement per tick, with an optional post-move speed factor */
const steady = (friction, opts, sf = 1) => accel(friction, opts) / (1 - friction * AIR * sf);


// lockstep-iceslide -- #6720: slipperiness lockstep. Same push on each floor; per tick horizontal velocity vs an independent reference
// (slime is registry-only: SlimeBlock.onSteppedOn adds its own x/z scaling, see slimeblockcheck) of LivingEntity.travel (f1 = f*0.91, accel = speed*0.21600002/f^3 on ground), friction resolved at y-0.5000001. 20 salts.
const FR = { stone: 0.6, ice: 0.98, packed_ice: 0.98, blue_ice: 0.989, slime_block: 0.8 };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
let breaks = 0;
function lane(salt, name, table) {
  FLOOR = name; const r = stream(salt * 7 + name.length);
  const vx0 = (r() - 0.5) * 0.6, vz0 = (r() - 0.5) * 0.6, push = r() < 0.5 ? 0 : 1;
  const e = ent({ vx: 0, vz: 0 }); for (let i = 0; i < 3; i++) Ph.tick(e, CMD()); e.vx = vx0; e.vz = vz0; const cmd = CMD({ fwd: push });
  const f = table[name];
  let vx = vx0, vz = vz0; e.x = 0.5; e.z = 0.5;
  for (let t = 0; t < 60; t++) {
    if (t === 30) cmd.fwd = 0;
    const a = cmd.fwd ? 0.1 * (0.21600002 / (f * f * f)) * 0.98 : 0;
    // yaw 0: forward = +z
    vz -= a;
    const sx = e.x + vx, sz = e.z + vz;
    vx *= f * 0.91; vz *= f * 0.91;
    Ph.tick(e, cmd);
    const exv = Math.abs(e.vx - vx), ezv = Math.abs(e.vz - vz);
    if (exv > 1e-5 || ezv > 1e-5 || Math.abs(e.x - sx) > 1e-5 || Math.abs(e.z - sz) > 1e-5) return `${name} salt ${salt} tick ${t}: v=(${e.vx.toFixed(5)},${e.vz.toFixed(5)}) want (${vx.toFixed(5)},${vz.toFixed(5)})`;
  }
  return null;
}
for (let s = 0; s < 20; s++) for (const n of Object.keys(FR).filter((k) => k !== "slime_block")) { const bad = lane(s, n, FR); ok(!bad, bad); }
// the registry itself holds the table
for (const n of Object.keys(FR)) ok(near(R.friction[R.id[n]], FR[n], 1e-6), `registry ${n} friction ${R.friction[R.id[n]]}`);
// anti-vacuity: wrong reference constants must be caught
{ const t = Object.assign({}, FR, { blue_ice: 0.99 }); let c = 0; for (let s = 0; s < 20; s++) if (lane(s, 'blue_ice', t)) c++; okAv(c > 0, 'anti-vacuity: blue ice 0.989 -> 0.99 caught'); if (c > 0) breaks++; }
{ const t = Object.assign({}, FR, { ice: 0.6 }); let c = 0; for (let s = 0; s < 20; s++) if (lane(s, 'ice', t)) c++; okAv(c > 0, 'anti-vacuity: ice 0.98 -> 0.6 caught'); if (c > 0) breaks++; }
console.log(`lockstep-iceslide: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const m of fails) console.log('  FAIL ' + m);
process.exit(fails.length ? 1 : 0);
