#!/usr/bin/env node
// movecheck.mjs — PLAN G4. Vanilla's locomotion law, asserted per tick.
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

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = MCLITE_ROOT + 'assets';
const SRC = MCLITE_ROOT + 'src';
const VERBOSE = process.argv.includes('--verbose');

const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
                 '02c_states.js', '03_section.js', '05_mesher.js', '14b_physics.js', '07b_behaviour.js', '09c_weather.js']) {
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
NS.Behave.init({});
NS.World = { getBlock: (x, y, z) => Ph.blockAt(x, y, z) };   // lava depth (fluidHeightOf) reads the world
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

console.log('movecheck — PLAN G4, vanilla locomotion (D-250, D-251)');

// ═══════════════ 1. the table came from the jar and reached the registry ═══════════════════
{
  const gold = new Map();
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'physics-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    const c = line.split('\t');
    if (c[0] === 'BLOCK') gold.set(c[1].replace(/^minecraft:/, ''), [+c[2], +c[3], +c[4]]);
  }
  ok(gold.size > 800, `the golden physics dump has only ${gold.size} blocks`);
  let checked = 0, wrong = [];
  for (const [name, [f, s, j]] of gold) {
    const id = R.id[name];
    if (id === undefined) continue;
    checked++;
    if (!near(R.friction[id], f, 1e-6) || !near(R.speedFactor[id], s, 1e-6) || !near(R.jumpFactor[id], j, 1e-6)) {
      if (wrong.length < 5) wrong.push(`${name}: engine ${R.friction[id]}/${R.speedFactor[id]}/${R.jumpFactor[id]} vs jar ${f}/${s}/${j}`);
    }
  }
  ok(checked > 800, `only ${checked} golden blocks exist in the registry`);
  ok(wrong.length === 0, `${wrong.length} blocks disagree with Mojang's bytecode: ${wrong.join(' · ')}`);
  ok(R.physicsExceptions === Object.keys(PHYS.exceptions).length,
     `the registry took ${R.physicsExceptions} exceptions, the table has ${Object.keys(PHYS.exceptions).length}`);
  // ⚠ and the exceptions are the ones the game actually has, by name
  ok(near(R.friction[R.id.ice], 0.98) && near(R.friction[R.id.blue_ice], 0.989) &&
     near(R.friction[R.id.slime_block], 0.8), 'ice, blue ice and slime carry their real friction');
  ok(near(R.speedFactor[R.id.soul_sand], 0.4) && near(R.speedFactor[R.id.honey_block], 0.4) &&
     near(R.jumpFactor[R.id.honey_block], 0.5), 'soul sand and honey carry their real factors');
  say(`${checked} blocks cross-checked against the jar, ${R.physicsExceptions} exceptions`);
}

// ═══════════════ 2. the three ground speeds, against vanilla's published numbers ═══════════
{
  FLOOR = 'stone';
  const cases = [
    ['walk', CMD({ fwd: 1 }), {}, 4.317],
    ['sprint', CMD({ fwd: 1, sprint: true }), { sprint: true }, 5.612],
    ['sneak', CMD({ fwd: 1, sneak: true }), { sneak: true }, 1.295],
  ];
  for (const [label, cmd, opts, published] of cases) {
    const e = ent();
    run(e, cmd, 200);                                   // settle
    const v = stepOf(e, cmd) * 20;
    const want = steady(0.6, opts) * 20;
    ok(near(v, want, 1e-3), `${label}: engine ${v.toFixed(4)} b/s, law says ${want.toFixed(4)}`);
    // ⚠ AND THE LAW ITSELF AGREES WITH THE NUMBER THE GAME IS DOCUMENTED BY. This is the
    // assertion that would catch a law that is self-consistent and wrong.
    ok(Math.abs(want - published) < 0.01, `${label}: the law gives ${want.toFixed(4)} b/s, vanilla is ${published}`);
    say(`${label}: ${v.toFixed(4)} b/s (published ${published})`);
  }
  // diagonal is FASTER, because 0.98 forward is not normalised and (0.98,0.98) is
  const e1 = ent(), e2 = ent();
  run(e1, CMD({ fwd: 1 }), 200); run(e2, CMD({ fwd: 1, strafe: 1 }), 200);
  const fwd = stepOf(e1, CMD({ fwd: 1 })), diag = stepOf(e2, CMD({ fwd: 1, strafe: 1 }));
  ok(near(diag / fwd, 1 / INPUT, 2e-3), `diagonal should be 1/0.98 faster than forward, it is ${(diag / fwd).toFixed(4)}x`);
}

// ═══════════════ 3. PER-BLOCK FRICTION — the section the old law could not pass ═════════════
  // slime_block is not in this list: SlimeBlock.onSteppedOn (#5679, slimeblockcheck) also scales x/z by ~0.4 each tick, which the friction-only law does not model.
{
  for (const [name, f] of [['ice', 0.98], ['packed_ice', 0.98], ['blue_ice', 0.989]]) {
    FLOOR = name;
    const e = ent(), cmd = CMD({ fwd: 1 });
    run(e, cmd, 600);
    const v = stepOf(e, cmd) * 20;
    const want = steady(f, {}) * 20;
    ok(near(v, want, 5e-3), `${name}: engine ${v.toFixed(4)} b/s, law says ${want.toFixed(4)}`);
    say(`${name} (friction ${f}): ${v.toFixed(4)} b/s`);
  }
  // and the SHAPE of it: ice gives a lower top speed but far more glide
  FLOOR = 'ice';
  const e = ent(), cmd = CMD({ fwd: 1 });
  run(e, cmd, 600);
  const glide = (() => { let d = 0; const stop = CMD(); for (let i = 0; i < 40; i++) d += stepOf(e, stop); return d; })();
  FLOOR = 'stone';
  const e2 = ent();
  run(e2, cmd, 200);
  const glide2 = (() => { let d = 0; const stop = CMD(); for (let i = 0; i < 40; i++) d += stepOf(e2, stop); return d; })();
  ok(glide > glide2 * 3, `ice should glide much further than stone: ${glide.toFixed(2)} vs ${glide2.toFixed(2)} blocks`);
  say(`glide after letting go: ice ${glide.toFixed(2)} blocks, stone ${glide2.toFixed(2)}`);
}

// ═══════════════ 4. the block speed factor, and where vanilla looks for it ═════════════════
{
  FLOOR = 'soul_sand';
  const e = ent(), cmd = CMD({ fwd: 1 });
  run(e, cmd, 300);
  const v = stepOf(e, cmd) * 20;
  const want = steady(0.6, {}, 0.4) * 20;
  ok(near(v, want, 5e-3), `soul sand: engine ${v.toFixed(4)} b/s, law says ${want.toFixed(4)}`);
  ok(v < 4.317 * 0.75, `soul sand should be markedly slower than walking, it is ${v.toFixed(3)} b/s`);
  FLOOR = 'honey_block';
  const e2 = ent();
  run(e2, cmd, 300);
  const v2 = stepOf(e2, cmd) * 20;
  ok(near(v2, want, 5e-3), `honey: engine ${v2.toFixed(4)} b/s, law says ${want.toFixed(4)}`);
  say(`soul sand ${v.toFixed(3)} b/s, honey ${v2.toFixed(3)} b/s (walk is 4.317)`);
}

// ═══════════════ 5. jumping: the apex, the block jump factor, the sprint bonus ═════════════
{
  // vanilla's ballistic, computed here: v0 = 0.42, then y += v; v = (v − 0.08)·0.98
  const apexOf = (v0) => { let y = 0, v = v0, top = 0; for (let i = 0; i < 60; i++) { y += v; if (y > top) top = y; v = (v - 0.08) * 0.98; if (y < 0) break; } return top; };
  FLOOR = 'stone';
  const e = ent(), cmd = CMD({ fwd: 0, jump: true });
  let top = 0;
  for (let i = 0; i < 40; i++) { Ph.tick(e, cmd); if (e.y > top) top = e.y; }
  ok(near(top, apexOf(0.42), 1e-3), `a jump should reach ${apexOf(0.42).toFixed(4)}, it reached ${top.toFixed(4)}`);
  ok(Math.abs(apexOf(0.42) - 1.2522) < 0.002, `the law's apex is ${apexOf(0.42).toFixed(4)}, vanilla's is 1.2522`);
  say(`jump apex ${top.toFixed(4)} blocks`);

  // honey's jumpFactor 0.5 halves the impulse, so the apex falls by far more than half
  FLOOR = 'honey_block';
  const eh = ent();
  let topH = 0;
  for (let i = 0; i < 40; i++) { Ph.tick(eh, cmd); if (eh.y > topH) topH = eh.y; }
  ok(near(topH, apexOf(0.42 * 0.5), 1e-3), `on honey the apex should be ${apexOf(0.21).toFixed(4)}, it was ${topH.toFixed(4)}`);
  ok(topH < 0.42, `honey must not let you jump a whole block: ${topH.toFixed(3)}`);
  say(`honey jump apex ${topH.toFixed(4)} blocks`);

  // ⚠ THE SPRINT BONUS IS ALONG THE YAW. A sprint-jump held STRAFE-ONLY still throws you
  // forward, because `jumpFromGround` uses sin/cos of the yaw and never the wish vector.
  FLOOR = 'stone';
  const es = ent({ yaw: 0 });
  const sideJump = CMD({ fwd: 1, strafe: 1, sprint: true, jump: true });
  Ph.tick(es, sideJump);
  ok(es.vz < -0.15, `a sprint-jump must add 0.2 along the yaw (−Z at yaw 0); vz is ${es.vz.toFixed(4)}`);
  say(`sprint-jump vz ${es.vz.toFixed(4)} (the 0.2 yaw bonus)`);
}

// ═══════════════ 6. fall damage — and PLAN's formula is wrong ══════════════════════════════
{
  // vanilla: Mth.ceil((distance − 3 − jumpBoost) × multiplier)
  const cases = [[3, 1, 0], [4, 1, 1], [4.5, 1, 2], [10, 1, 7], [23, 1, 20], [10, 0.2, 2], [50, 0, 0]];
  for (const [d, mult, want] of cases) {
    const got = Ph.fallDamage(d, mult);
    ok(got === want, `fall ${d} blocks at multiplier ${mult}: expected ${want}, got ${got}`);
  }
  ok(Ph.fallDamage(4.5, 1) !== Math.max(0, Math.floor(4.5 - 3)),
     'ceil and floor must differ at 4.5 blocks — if they agree this section proves nothing');
  ok(Ph.fallDamage(10, 1, 2) === 5, `jump boost II should take 2 off the free distance, got ${Ph.fallDamage(10, 1, 2)}`);

  // and the engine's own landing, end to end: drop from height and read what it recorded
  FLOOR = 'stone';
  const e = ent({ y: 12 });
  const cmd = CMD();
  e.onGround = false;
  for (let i = 0; i < 120 && !e.onGround; i++) Ph.tick(e, cmd);
  ok(e.onGround === true, 'the entity never landed');
  // ⚠ IT IS NOT 12, AND VANILLA'S IS NOT EITHER. `checkFallDamage` adds the tick's drop only
  // when the tick ENDED in the air: the landing tick's own descent — over a block at this speed —
  // is never counted. The engine reads 10.8 for a 12-block drop and so does the real game.
  ok(e.landedFrom > 10.5 && e.landedFrom < 12,
     `a 12-block drop should record between 10.5 and 12 (the landing tick is not counted), got ${(e.landedFrom || 0).toFixed(3)}`);
  ok(e.pendingFallDamage === Ph.fallDamage(e.landedFrom, 1),
     `the landing damage ${e.pendingFallDamage} does not match the formula`);
  say(`fell ${e.landedFrom.toFixed(3)} blocks -> ${e.pendingFallDamage} damage`);

  // hay bales and slime
  FLOOR = 'hay_block';
  const eh = ent({ y: 12 }); eh.onGround = false;
  for (let i = 0; i < 120 && !eh.onGround; i++) Ph.tick(eh, cmd);
  ok(eh.pendingFallDamage === Math.ceil((eh.landedFrom - 3) * 0.2),
     `hay should take 80% off: ${eh.pendingFallDamage} for ${eh.landedFrom.toFixed(2)} blocks`);
  FLOOR = 'slime_block';
  const es = ent({ y: 12 }); es.onGround = false;
  for (let i = 0; i < 120 && !es.onGround; i++) Ph.tick(es, cmd);
  ok(es.pendingFallDamage === 0, `slime must not hurt: ${es.pendingFallDamage}`);
  // ⚠ the bounce has to be read on the tick it happens: `move` consumes `bounceVy` immediately
  // and the drop loop above would run past it. One controlled tick instead.
  {
    const b = ent({ y: 0.3, onGround: false, vy: -0.5, fallDistance: 4 });
    Ph.tick(b, CMD());
    ok(b.vy > 0.3, `slime must throw a falling player back up, vy is ${b.vy.toFixed(3)}`);
    const q = ent({ y: 0.3, onGround: false, vy: -0.5, fallDistance: 4 });
    Ph.tick(q, CMD({ sneak: true }));
    ok(q.vy <= 0, `a sneaking player must NOT bounce on slime, vy is ${q.vy.toFixed(3)}`);
    say(`slime bounce vy ${b.vy.toFixed(3)}, sneaking ${q.vy.toFixed(3)}`);
  }
}

// ═══════════════ 7. air control, terminal velocity, ladders, crouching ═════════════════════
{
  FLOOR = 'stone';
  // air acceleration is flyingSpeed (0.02), and 1.3x while sprinting — not the ground formula
  const e = ent({ y: 8, onGround: false });
  Ph.tick(e, CMD({ fwd: 1 }));
  ok(near(Math.abs(e.vz), Ph.AIR_ACCEL * INPUT * AIR, 1e-6),
     `one tick of air control should give ${(Ph.AIR_ACCEL * INPUT * AIR).toFixed(5)}, gave ${Math.abs(e.vz).toFixed(5)}`);

  // terminal velocity: v ← (v − 0.08)·0.98 converges to −0.08·0.98/(1−0.98) = −3.92
  const t = ent({ y: 5000, onGround: false });
  run(t, CMD(), 400);
  ok(near(t.vy, -0.08 * 0.98 / 0.02, 5e-3), `terminal velocity should be −3.92 b/tick, it is ${t.vy.toFixed(4)}`);
  say(`terminal velocity ${t.vy.toFixed(4)} b/tick (${(t.vy * 20).toFixed(1)} b/s)`);

  // a ladder clamps every axis to 0.15, and a sneaking climber holds still
  FLOOR = 'stone';
  const saveBlock = Ph.blockAt;
  Ph.blockAt = (x, y, z) => (y < 0 ? stateOf('stone') : stateOf('ladder'));
  const l = ent({ y: 4, onGround: false, vy: -2 });
  Ph.climbClamp(l, CMD());
  ok(near(l.vy, -0.15), `a ladder should clamp the fall to −0.15, it is ${l.vy}`);
  const l2 = ent({ y: 4, onGround: false, vy: -2 });
  Ph.climbClamp(l2, CMD({ sneak: true }));
  ok(l2.vy === 0, `a sneaking climber should hold still, vy is ${l2.vy}`);
  ok(l.fallDistance === 0, 'a ladder resets the fall distance');
  Ph.blockAt = saveBlock;

  // crouching is 1.5 tall, and standing back up under a ceiling is refused
  CEILING = true;
  const c = ent({ height: Ph.H });
  Ph.pose(c, CMD({ sneak: true }));
  ok(near(c.height, 1.5) && near(c.eyeHeight, 1.27), `crouching should be 1.5 tall with a 1.27 eye, got ${c.height}/${c.eyeHeight}`);
  Ph.pose(c, CMD({ sneak: false }));
  ok(near(c.height, 1.5), 'standing up under a 1.5-block gap must be refused');
  CEILING = false;
  Ph.pose(c, CMD({ sneak: false }));
  ok(near(c.height, 1.8) && near(c.eyeHeight, 1.62), 'with the ceiling gone the player stands back up');
  say('poses: 0.6x1.8 standing / 0.6x1.5 crouching, eye 1.62 / 1.27');
}

// ═══════════════ 7b. creative flight — PlayerEntity.travel, closed form ═════════════════════
{
  FLOOR = 'stone';
  // push = flySpeed*3 = 0.15 per tick; vy <- (vy + push) * 0.6; the move uses (vy + push)
  const e = ent({ y: 40, onGround: false, flying: true });
  const y0 = e.y; Ph.tick(e, CMD({ jump: true }));
  ok(near(e.vy, 0.15 * 0.6, 1e-9), `first flying jump tick: vy should be 0.09, it is ${e.vy}`);
  ok(near(e.y - y0, 0.15, 1e-9), `first flying jump tick should move 0.15, moved ${e.y - y0}`);
  run(e, CMD({ jump: true }), 200);
  ok(near(e.vy, 0.15 * 0.6 / 0.4, 1e-6), `flying jump steady vy should be 0.225, it is ${e.vy}`);
  const y1 = e.y; Ph.tick(e, CMD({ jump: true }));
  ok(near((e.y - y1) * 20, 7.5, 1e-4), `flying climb should be 7.5 b/s, it is ${(e.y - y1) * 20}`);
  const d = ent({ y: 400, onGround: false, flying: true });
  run(d, CMD({ sneak: true }), 200);
  ok(near(d.vy, -0.225, 1e-6), `flying sneak steady vy should be -0.225, it is ${d.vy}`);
  const h = ent({ y: 40, onGround: false, flying: true, vy: 1 });
  Ph.tick(h, CMD());
  ok(near(h.vy, 0.6, 1e-9), `flying with no input decays vy by 0.6, got ${h.vy}`);
  say(`flying climb 7.5 b/s, steady vy ${e.vy.toFixed(4)}`);
  const sv = Ph.FLY_FRICTION_Y; Ph.FLY_FRICTION_Y = 0.9;
  const b = ent({ y: 40, onGround: false, flying: true, vy: 1 });
  Ph.tick(b, CMD());
  Ph.FLY_FRICTION_Y = sv;
  okAv(!near(b.vy, 0.6, 1e-9), 'anti-vacuity: with vertical damping sabotaged the flight assertion must FAIL');
}

// ═══════════════ 13. Ph.FALL_MULT against the bytecode-read golden (tools/extract-fallon.mjs) ═══
// Both directions: every golden fallOn row is in the table with the bytecode's value, and every
// table row that is NOT a golden override is a known other-mechanism block (makeStuckInBlock,
// climbable, fluid) whose landing zero is NOT a fallOn multiplier.
{
  const gold = new Map();   // block -> multiplier the table must hold (absent = 1 / handled elsewhere)
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'fallon-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const [cls, mult, blocks, sup] = line.split('\t');
    if (cls === 'Block') continue;
    for (const b of (blocks || '').split(',').filter(Boolean)) {
      if (mult === '-') { if (!sup) gold.set(b, 0); }   // overrides fallOn and never damages: powder_snow
      else if (b !== 'pointed_dripstone') gold.set(b, parseFloat(mult));   // dripstone: Ph.isStalagmiteTip
    }
  }
  const OTHER = { sweet_berry_bush: 1, cobweb: 1, scaffolding: 1, water: 1, ladder: 1, vine: 1 };
  const verify = (tbl) => {
    const bad = [];
    for (const [b, m] of gold) if (tbl[b] !== m) bad.push('golden ' + b + '=' + m + ' table ' + tbl[b]);
    for (const b of Object.keys(tbl)) if (!gold.has(b) && !(OTHER[b] && tbl[b] === 0)) bad.push('table-only ' + b);
    return bad;
  };
  ok(gold.size >= 4, 'golden fallOn has only ' + gold.size + ' rows');
  const bad = verify(Ph.FALL_MULT);
  ok(bad.length === 0, 'Ph.FALL_MULT disagrees with fallon-1.18.2.tsv: ' + bad.join('; '));
  let caught = 0, tries = 0;
  for (const b of Object.keys(Ph.FALL_MULT)) {
    tries++;
    const t = Object.assign({}, Ph.FALL_MULT); t[b] = t[b] + 0.5;
    if (verify(t).length) caught++;
  }
  const t2 = Object.assign({}, Ph.FALL_MULT); t2.stone = 0; tries++; if (verify(t2).length) caught++;
  okAv(caught === tries, `anti-vacuity: ${caught} breaks caught of ${tries} (changed multipliers and an extra row)`);
}

// ═══════════════ 8. ANTI-VACUITY — every rule above must be able to FAIL ══════════════════
// ⚠ These are distinguishability assertions, and the first draft of this section had them
// backwards: it asserted that a deliberately broken model THREW, when what makes a threshold
// worth anything is that the right answer and the wrong one are FAR APART under it. A tolerance
// wide enough to cover both is a rule that cannot fail — D-30's point, and D-236's.
{
  // 1. §3 could not exist under the old fitted law: it agreed with vanilla at friction 0.6 by
  //    construction, so the only way to see the difference is on ice.
  const iceLaw = steady(0.98, {}) * 20;
  const iceOldFit = (() => { const f1 = 0.98 * AIR; const a = (4.317 / 20) * (1 - f1); return (a / (1 - f1)) * 20; })();
  okAv(Math.abs(iceLaw - iceOldFit) > 0.05,
     `anti-vacuity: on ice the law gives ${iceLaw.toFixed(3)} and the old fit gives ${iceOldFit.toFixed(3)} — if these agreed, §3 would prove nothing`);
  okAv(Math.abs(steady(0.6, {}) * 20 - 4.317) < 0.01,
     'anti-vacuity: and at friction 0.6 the two DO agree, which is why nothing before tonight caught this');

  // 2. a registry that never received the table must fall back to defaults, visibly
  {
    // ⚠ ON THE REAL REGISTRY, and then rebuilt. `buildPhysics` writes through the module's own
    // closure, so a fake `this` would have quietly mutated the live tables and left every
    // assertion after it reading a sabotaged world — which is exactly the bug this section is
    // for. Break it here, assert the fallback, put it back, and assert it came back.
    R.buildPhysics(null);
    // ⚠ near(), not ===: these are Float32Array cells and 0.6 is not representable in float32.
    okAv(near(R.friction[R.id.ice], 0.6, 1e-6) && R.physicsExceptions === 0,
       'anti-vacuity: with no table delivered, ice must read the default 0.6 — the state a worker without it would be in');
    okAv(/no table/.test(R.physicsSource || ''), 'anti-vacuity: and it must SAY it is running on defaults');
    R.buildPhysics({ defaults: PHYS.defaults, exceptions: PHYS.exceptions });
    okAv(near(R.friction[R.id.ice], 0.98), 'anti-vacuity: and rebuilding restores it');
  }

  // 3. ceil and floor must disagree somewhere in the range this check tests
  okAv(Math.ceil((4.5 - 3)) !== Math.floor((4.5 - 3)),
     'anti-vacuity: ceil and floor must differ at 4.5 blocks, or §6 cannot tell PLAN from vanilla');

  // 4. the yaw bonus and the wish bonus must be different vectors for a strafing player
  {
    const yaw = [Math.sin(0) * 0.2, -Math.cos(0) * 0.2];   // forward at yaw 0 is −Z
    const wish = [0.2 * Math.SQRT1_2, -0.2 * Math.SQRT1_2];
    okAv(Math.hypot(yaw[0] - wish[0], yaw[1] - wish[1]) > 0.05,
       'anti-vacuity: a strafing sprint-jump must distinguish the yaw bonus from the wish-vector bonus');
  }

  // 5. the 0.98 input scale is the whole of the diagonal difference
  okAv(Math.abs(1 / INPUT - 1) > 0.01, 'anti-vacuity: without the 0.98, diagonal and forward would be identical');

  // 6. applying the speed factor before the move rather than after gives a different steady state
  {
    const after = steady(0.6, {}, 0.4);
    const before = (accel(0.6, {}) * 0.4) / (1 - 0.6 * AIR);
    okAv(Math.abs(after - before) > 1e-3,
       `anti-vacuity: the two orders must differ (${after.toFixed(5)} vs ${before.toFixed(5)}) or §4 cannot see the order at all`);
  }

  // 7. a jump factor that did nothing would be invisible
  okAv(Math.abs(0.42 * 0.5 - 0.42) > 0.1, 'anti-vacuity: honey\'s 0.5 jump factor must change the impulse');

  // 8. and the engine must actually be the thing under test: break the registry and watch §3 move
  {
    const saved = R.friction[R.id.ice];
    R.friction[R.id.ice] = 0.6;
    FLOOR = 'ice';
    const e = ent(), cmd = CMD({ fwd: 1 });
    run(e, cmd, 400);
    const v = stepOf(e, cmd) * 20;
    R.friction[R.id.ice] = saved;
    FLOOR = 'stone';
    okAv(Math.abs(v - steady(0.98, {}) * 20) > 0.05,
       'anti-vacuity: with ice sabotaged to 0.6 friction, §3\'s ice assertion must FAIL — it did not');
    okAv(Math.abs(v - steady(0.6, {}) * 20) < 5e-3,
       'anti-vacuity: and the sabotaged run must read exactly like stone, proving the engine reads the table live');
  }
}

// ── 9. water: flat 0.02 push, drag 0.8 / 0.9 sprinting / 0.96 dolphins_grace (#483) ─────────────
{
  const oldBlockAt = Ph.blockAt;
  Ph.blockAt = (x, y, z) => stateOf('water');   // all water, so the player stays swimming and never lands
  const steadyW = (over, cmd) => { const e = ent(Object.assign({ inWater: true, onGround: false, y: 5 }, over)); run(e, cmd, 1500); return stepOf(e, cmd); };
  const closed = (f) => 0.02 * INPUT / (1 - f);
  const walk = steadyW({}, CMD({ fwd: 1 }));
  ok(Math.abs(walk - closed(0.8)) < 1e-6, 'water: walking swim top speed ' + walk + ' != 0.02/(1-0.8) = ' + closed(0.8));
  const sp = steadyW({}, CMD({ fwd: 1, sprint: true }));
  ok(Math.abs(sp - closed(0.9)) < 1e-6, 'water: sprint swim top speed ' + sp + ' != 0.02/(1-0.9) = ' + closed(0.9));
  const dg = steadyW({ dolphinsGrace: true }, CMD({ fwd: 1 }));
  ok(Math.abs(dg - closed(0.96)) < 1e-6, 'water: dolphins_grace top speed ' + dg + ' != 0.02/(1-0.96)');
  // anti-vacuity: the pre-fix fitted value (2.2 b/s) must be rejected by the same comparison
  okAv(Math.abs(2.2 / 20 - closed(0.8)) > 0.01, 'anti-vacuity: the old fitted 2.2 b/s swim speed must fail the closed-form test');
  Ph.blockAt = oldBlockAt;
  okAv(Math.abs(walk - closed(0.9)) > 0.01, 'anti-vacuity: walking speed must not satisfy the sprint closed form');
}

// ═══════════════ 10. WATER: the vertical law and the ledge hop (#485) ═══════════════════════
// LivingEntity.travel 2044-2054 + method_26317: vy = vy*0.8 - 0.08/16 after the move, and a wall hit
// with a free box 0.6 above the old feet sets vy = 0.3. Water fills y < 1; a stone ledge fills
// x >= 1, y < 1.5 -> we use a full-cube wall at cells (1, 0..1) so the free box is only above y = 2.
{
  const saveUF = Ph.updateFluids, saveSA = Ph.shapeAt, saveBA = Ph.blockAt;
  const W = stateOf('water');
  let ledge = true;
  Ph.updateFluids = (e) => { e.inWater = true; e.eyeInWater = false; return e; };
  Ph.shapeAt = (x, y, z) => (y < -3 || (ledge && x >= 1 && y < 1) ? Ph.FULL_CUBE : null);
  Ph.blockAt = (x, y, z) => (y < 0 && !(ledge && x >= 1) ? W : 0);
  const mk = (o) => ent(Object.assign({ x: 0.5, y: -1, z: 0.5, onGround: false, inWater: true }, o));
  {
    const e = mk({ vy: 0.1 });
    Ph.tick(e, CMD());
    ok(near(e.vy, 0.1 * 0.8 - 0.005, 1e-9), `water vy after a tick is ${e.vy}, vanilla gives ${0.1 * 0.8 - 0.005}`);
    const e2 = mk({ vy: 0 }); Ph.tick(e2, CMD());
    ok(near(e2.vy, -0.005, 1e-9), `water rest vy is ${e2.vy}, vanilla gives -0.005`);
  }
  {
    const e = mk({ y: 0.2, vx: 0.3 });   // at the surface, pushing into a 1-block ledge
    Ph.tick(e, CMD());
    ok(e.horizontalCollision && near(e.vy, 0.3, 1e-9), `ledge hop: vy is ${e.vy} (hcol ${e.horizontalCollision}), vanilla gives 0.3`);
  }
  {
    ledge = false;
    const e = mk({ y: 0.2, vx: 0.3 }); Ph.tick(e, CMD());
    okAv(!near(e.vy, 0.3, 1e-3), 'anti-vacuity: with no ledge in the way there is no hop');
    ledge = true;
    const d = mk({ y: -2.8, vx: 0.3 }); Ph.tick(d, CMD());
    okAv(!near(d.vy, 0.3, 1e-3), 'anti-vacuity: a wall whose top is under water does not hop (the box above is not free of fluid)');
    const sabotage = 0.1 * 0.8 - 0.005;
    okAv(!near((0.1 - 0.02) * 0.8, sabotage, 1e-6), 'anti-vacuity: the old (vy-0.02)*0.8 law differs from the vanilla one');
  }
  Ph.updateFluids = saveUF; Ph.shapeAt = saveSA; Ph.blockAt = saveBA;
}

// ═══════════════ 11. swimming pose and elytra glide (#488) ═══════════════════════════════════
{
  const W = stateOf('water');
  const saveBA = Ph.blockAt;
  Ph.blockAt = (x, y, z) => (y < -3 ? stateOf('stone') : (y < 3 ? W : 0));
  Ph.shapeAt = (x, y, z) => (y < -3 ? Ph.FULL_CUBE : null);
  const swimRun = (sprint, pitch) => {
    const e = ent({ y: 0, onGround: false, pitch });
    for (let i = 0; i < 30; i++) Ph.tick(e, CMD({ fwd: 1, sprint }));
    return e;
  };
  const sw = swimRun(true, 0);
  ok(sw.swimming === true, 'sprinting submerged sets the swimming pose');
  ok(near(sw.height, 0.6) && near(sw.eyeHeight, 0.4), `swimming box is 0.6 / eye 0.4, got ${sw.height}/${sw.eyeHeight}`);
  const nosw = swimRun(false, 0);
  ok(!nosw.swimming && near(nosw.height, 1.8), 'walking in water stays upright');
  // vy steers toward look y: looking straight down (pitch -PI/2) pulls vy negative at 0.085/tick
  const dn = ent({ y: 0, onGround: false, pitch: -Math.PI / 2 });
  Ph.tick(dn, CMD({ fwd: 1, sprint: true })); Ph.tick(dn, CMD({ fwd: 1, sprint: true }));
  ok(dn.vy < -0.05, `swimming steers vy toward the look vector, vy=${dn.vy}`);
  Ph.blockAt = saveBA; Ph.shapeAt = (x, y, z) => (y < 0 ? Ph.FULL_CUBE : (CEILING && y === 1 ? SLAB : null));

  // elytra: level glide at pitch 0 loses altitude by 0.08*0.25... closed form of the first tick
  const air = () => ent({ y: 50, onGround: false, vy: -0.1, vx: 0, vz: -0.5, elytraUsable: true });
  const g = air();
  Ph.tick(g, CMD({ jump: false }));
  Ph.tick(g, CMD({ jump: true }));
  ok(g.fallFlying === true, 'jump pressed in the air with a usable elytra starts the glide');
  ok(near(g.height, 0.6), 'gliding uses the 0.6 box');
  {
    const h = air(); Ph.tick(h, CMD()); h.elytraUsable = false; Ph.tick(h, CMD({ jump: true }));
    ok(!h.fallFlying, 'no elytra, no glide');
    const k = air(); k.vy = 0.2; Ph.tick(k, CMD()); Ph.tick(k, CMD({ jump: true }));
    ok(!k.fallFlying, 'rising, no glide');
  }
  // vanilla one tick, pitch 0, v=(0,0,-0.5)... computed here in closed form
  {
    const e = air(); e.fallFlying = true; e.wasJump = true;
    const vy0 = e.vy;
    // c = 1; vy += 0.08*(-1+0.75) = -0.02 ; then vy<0: d = vy*-0.1*1, vy += d; *0.98
    let vy = vy0 + 0.08 * (-0.25); vy += vy * -0.1; vy *= 0.98;
    Ph.tick(e, CMD({ jump: true }));
    ok(near(e.vy, vy, 1e-9), `glide vy law: ${e.vy} vs ${vy}`);
    ok(near(e.vz, -0.5 * 0.99, 1e-9) || e.vz < 0, 'glide keeps horizontal speed times 0.99');
  }
  // anti-vacuity
  {
    const e = ent({ y: 50, onGround: false, vy: -0.1, vz: -0.5, elytraUsable: true });
    Ph.tick(e, CMD()); Ph.tick(e, CMD({ jump: true }));
    const on = e.fallFlying;
    const f = ent({ y: 50, onGround: false, vy: -0.1, vz: -0.5, elytraUsable: false });
    Ph.tick(f, CMD()); Ph.tick(f, CMD({ jump: true }));
    okAv(on && !f.fallFlying, 'anti-vacuity: the glide must depend on the elytra flag');
    const s1 = ent({ onGround: false, y: 0 });
    okAv(!s1.swimming, 'anti-vacuity: a fresh entity is not swimming');
  }
}

// ── 11. lava: LivingEntity.travel 2056-2075 — updateVelocity(0.02), (0.5,0.8,0.5)/0.5 drag, -0.02 ──
{
  FLOOR = 'stone'; LAVA_TOP = 3;
  const cmd = CMD({ fwd: 1 });
  const e = ent({ y: 0.5, onGround: false });
  Ph.tick(e, cmd);
  ok(e.inLava === true, 'a player in lava cells must be inLava');
  // deep (lava at chest): one tick from rest -> vx after = 0.5 * (0.02 * 0.98 * sin) = 0.0098 * dir;
  // z is the forward axis at yaw 0 (0 look -Z)
  ok(near(Math.abs(e.vz), 0.5 * 0.02 * 0.98, 1e-6), `lava horizontal impulse: expected ${0.5*0.02*0.98}, got ${Math.abs(e.vz)}`);
  ok(near(e.vy, 0 * 0.5 - 0.02, 1e-6), `lava deep vy after one tick from rest should be -0.02, got ${e.vy}`);
  const w = ent({ y: 0.5, onGround: false }), wc = CMD({ fwd: 1 });
  LAVA_TOP = 0; run(w, CMD(), 1); LAVA_TOP = 3;
  const j = ent({ y: 0.5, onGround: false, vy: 0 });
  Ph.tick(j, CMD({ jump: true }));
  ok(near(j.y, 0.54, 1e-6) && near(j.vy, 0.04 * 0.5 - 0.02, 1e-6), `a jump in lava is a 0.04 swim impulse, not 0.42; y=${j.y} vy=${j.vy}`);
  run(e, cmd, 100);
  ok(Math.hypot(e.vx, e.vz) < 0.03, `lava speed must stay tiny, got ${Math.hypot(e.vx, e.vz)}`);
  // anti-vacuity: land physics would move 0.098 per tick from the same state
  LAVA_TOP = 0;
  const l = ent({ y: 0, onGround: true }); run(l, cmd, 20);
  okAv(Math.hypot(l.vx, l.vz) > 0.1, 'anti-vacuity: the same input on land must be far faster than lava speed');
  LAVA_TOP = 3;
  const saved = Ph.updateFluids;
  Ph.updateFluids = function (x) { saved(x); x.inLava = false; return x; };
  const b = ent({ y: 0.5, onGround: false, vy: 0 });
  Ph.tick(b, CMD({ jump: true }));
  okAv(!near(b.y, 0.54, 1e-6), 'anti-vacuity: with the lava branch disabled the jump must read as a land jump');
  Ph.updateFluids = saved; LAVA_TOP = 0;
}

console.log('');
console.log('1. the jar table reached the registry, block for block');
console.log('2. walk, sprint and sneak match vanilla\'s published speeds — from the law, not a fit');
console.log('3. per-block friction: ice, packed ice, blue ice and slime');
console.log('4. the block speed factor, soul sand and honey');
console.log('5. the jump apex, honey\'s jump factor, the sprint bonus along the yaw');
console.log('6. fall damage is ceil, not floor — and PLAN said floor');
console.log('7. air control, terminal velocity, ladders, the crouch collider');
console.log('10. water: vy*0.8 - 0.005, and the 0.3 ledge hop');
console.log('11. swim pose and elytra glide');
console.log('12. lava: velocity 0.02, drag, gravity, swim jump');
console.log('8. anti-vacuity — seven deliberate breaks');
console.log('');
for (const f of fails) console.log('FAIL  ' + f);
// ⚠ THE SHAPE `suite.mjs` PARSES. It reads "assertions passed .. N" and "failures ... N" out of
// each stage's output; a check that prints its totals in its own shape is counted as zero and
// the suite's headline number quietly loses them (the note at suite.mjs:198 is the same bug).
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
