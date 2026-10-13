#!/usr/bin/env node
// tools/gamecheck.mjs — headless validation of THE GAME LAYER.
//
// gencheck.mjs proves the world is shaped right and shadercheck.mjs proves the renderer agrees
// with itself. Neither of them ever moves a player. This tool loads every src/ module — main
// thread and worker alike — behind a minimal DOM/localStorage shim, builds a synthetic world in
// memory, and asserts the things that make the difference between "it renders" and "it plays":
//
//   1. collision: you cannot walk through a wall, you land on a floor, you do not fall out of
//      an ungenerated chunk, and the sneak edge guard holds
//   2. feel: measured walk/sprint speed and jump apex against the vanilla numbers they claim
//   3. targeting: the DDA returns the right block AND the right face from all six directions,
//      which is what decides whether a placed block lands on the correct side
//   4. placement: never inside the player, never into a solid block, always into a replaceable one
//   5. persistence: record -> encode -> decode -> replay round-trips exactly
//
// Usage: node tools/gamecheck.mjs [--quiet]
// Exits non-zero on the first failure category, like the other two tools.

import { readFileSync } from 'node:fs';
import { initRegistry } from './loadsrc.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const QUIET = process.argv.includes('--quiet');

let errors = 0, checks = 0;
const fail = (what, detail) => {
  errors++;
  console.error('FAIL  ' + what + (detail ? '\n      ' + String(detail).split('\n').join('\n      ') : ''));
};
const ok = (what) => { checks++; if (!QUIET) console.log('ok    ' + what); };
const need = (cond, what, detail) => { cond ? ok(what) : fail(what, detail); return cond; };
const near = (a, b, tol, what) =>
  need(Math.abs(a - b) <= tol, what + '  (' + a.toFixed(4) + ' vs ' + b.toFixed(4) + ' ±' + tol + ')');
const say = (...a) => { if (!QUIET) console.log(...a); };

// ---------------------------------------------------------------------------
// Load every module behind a shim. This is itself a test: a main-thread module that reached for
// something the shim does not have would throw here rather than in someone's browser.
// ---------------------------------------------------------------------------

const FILES = [
  '00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '02k_survive.js',
  '03_section.js', '04_worldgen.js', '04b_caves.js',
  '05_mesher.js', '06_atlas.js', '07_world.js', '08_lighting.js', '09_jobs.js', '10_camera.js',
  '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js', '13_input.js', '14_player.js',
  '14b_physics.js', '14c_raycast.js', '07zx_particle.js', '15_hud.js', '16_settings.js', '16b_save.js', '17_main.js'
];
const text = f => readFileSync(join(SRC, f), 'utf8');

function makeStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    _map: m
  };
}

const fakeCanvas = () => ({
  width: 1, height: 1, style: {},
  getContext: () => null,
  addEventListener() {}, removeEventListener() {}
});

let MCL, store;
try {
  store = makeStore();
  const body = "'use strict';\n" + FILES.map(text).join('\n') + '\nreturn MCL;\n';
  MCL = new Function('window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame', body)(
    { addEventListener() {}, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 },
    { addEventListener() {}, createElement: fakeCanvas, getElementById: () => null,
      readyState: 'complete' },
    { hardwareConcurrency: 4 },
    store,
    () => 0
  );
} catch (e) {
  fail('loading src modules', e.stack || e.message);
  process.exit(1);
}
ok('loaded ' + FILES.length + ' modules headlessly');

const CFG = MCL.CFG, B = MCL.Blocks, S = MCL.Section, W = MCL.World;
const Ph = MCL.Physics, R = MCL.Ray, P = MCL.Player;
const SR = MCL.States;
B.init();
// The world stores registry real states from session 2, so nothing below works until the
// registry is decoded — the same call 17_main.js makes before it touches anything.
initRegistry(MCL);
MCL.Light.init();
W.init(1337);
MCL.Save.backend = 'none';          // keep the journal quiet while we build the test world
P.init();

// an "id" here is a registry REAL STATE (session 2)
const ID = n => SR.stateOf(n);
const STONE = ID('stone'), WATER = ID('water'), GRASS = ID('grass'), AIR = 0;

// ---------------------------------------------------------------------------
// A synthetic world: a plain of stone at y = 63 across a 5x5 chunk area.
// ---------------------------------------------------------------------------

function makeChunk(cx, cz) {
  const c = W.getOrCreate(cx, cz);
  c.state = MCL.CH.GENERATED;
  c.biome = new Uint8Array(256);
  return c;
}
function put(x, y, z, id) {
  const c = W.get(x >> 4, z >> 4);
  if (!c) return false;
  const ly = y - CFG.WORLD_MIN_Y;
  S.set(c.sec[ly >> 4], ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15), id);
  return true;
}
function floorPlane(y, id) {
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    for (let x = cx * 16; x < cx * 16 + 16; x++) for (let z = cz * 16; z < cz * 16 + 16; z++) put(x, y, z, id);
  }
}
function clearAbove(y0, y1) {
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    for (let x = cx * 16; x < cx * 16 + 16; x++) for (let z = cz * 16; z < cz * 16 + 16; z++) {
      for (let y = y0; y <= y1; y++) put(x, y, z, 0);
    }
  }
}
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) makeChunk(cx, cz);
floorPlane(63, STONE);

const FLOOR_TOP = 64;   // the first free y above the plane

function sync() { P.px = P.x; P.py = P.y; P.pz = P.z; P.interpolate(1); }
function reset(x, z) {
  P.x = x; P.y = FLOOR_TOP; P.z = z;
  P.vx = P.vy = P.vz = 0;
  P.yaw = 0; P.pitch = 0;
  P.flying = false; P.noclip = false; P.onGround = true;
  P.inWater = false;
  sync();
}
const CMD = (o) => Object.assign({ fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false }, o || {});
function run(n, cmdObj) {
  const c = CMD(cmdObj);
  for (let i = 0; i < n; i++) Ph.tick(P, c);
}

// ---------------------------------------------------------------------------
// 1. Collision
// ---------------------------------------------------------------------------
say('\n--- collision ---');
{
  reset(0.5, 0.5);
  run(20, {});
  near(P.y, FLOOR_TOP, 0.02, 'stands still on a floor');
  need(P.onGround === true, 'onGround is true while standing');

  // fall from height and land exactly on the surface
  reset(0.5, 0.5);
  P.y = 90;
  P.onGround = false;
  let n = 0;
  while (!P.onGround && n < 200) { Ph.tick(P, CMD()); n++; }
  need(P.onGround, 'falls and lands within 200 ticks (' + n + ')');
  near(P.y, FLOOR_TOP, 0.005, 'lands exactly on the block surface');

  // an ungenerated column reads as solid, so the player never falls out of the world (D-73)
  need(Ph.solidAt(9999, 64, 9999) === true, 'ungenerated chunk is solid, not air');
  need(Ph.solidAt(0, CFG.WORLD_MIN_Y - 1, 0) === true, 'the void has a floor');

  // walk into a wall
  clearAbove(64, 70);
  for (let y = 64; y <= 67; y++) for (let z = -8; z <= 8; z++) put(5, y, z, STONE);
  reset(0.5, 0.5);
  P.yaw = Math.PI / 2;                     // +yaw turns toward +X
  run(120, { fwd: 1 });
  const limit = 5 - Ph.W * 0.5;
  need(P.x < limit + 1e-3 && P.x > limit - 0.02,
       'walking into a wall stops at the wall face  (x=' + P.x.toFixed(4) + ', limit ' + limit + ')');
  need(P.x < 5, 'never tunnels through the wall');

  // step-up is inert at the vanilla 0.6, and works when the height allows it (D-78).
  // The ledge must be a PLATEAU, not a single row, or a working step-up walks straight off it.
  clearAbove(64, 70);
  for (let x = 3; x <= 20; x++) for (let z = -8; z <= 8; z++) put(x, 64, z, STONE);
  reset(0.5, 0.5); P.yaw = Math.PI / 2;
  run(60, { fwd: 1 });
  need(P.y < FLOOR_TOP + 0.5 && P.x < 3,
       'a full block is NOT auto-stepped at STEP=0.6 (vanilla)  (x=' + P.x.toFixed(2) + ')');
  const savedStep = Ph.STEP;
  Ph.STEP = 1.05;
  reset(0.5, 0.5); P.yaw = Math.PI / 2;
  run(60, { fwd: 1 });
  need(P.y > FLOOR_TOP + 0.9 && P.x > 4,
       'raising STEP above 1 climbs the ledge — the step code runs  (x=' + P.x.toFixed(2) +
       ', y=' + P.y.toFixed(2) + ')');
  Ph.STEP = savedStep;
  clearAbove(64, 70);

  // sneak edge guard
  clearAbove(64, 70);
  for (let x = 4; x <= 20; x++) for (let z = -8; z <= 8; z++) put(x, 63, z, 0);   // remove the floor
  reset(0.5, 0.5); P.yaw = Math.PI / 2;
  run(80, { fwd: 1, sneak: true });
  // vanilla lets you overhang until the box no longer touches solid ground: half a width past
  // the last solid cell, i.e. x < 4 + WIDTH/2
  need(P.y >= FLOOR_TOP - 0.01 && P.x > 3.5 && P.x < 4 + Ph.W * 0.5 + 1e-6,
       'sneaking refuses to walk off a ledge  (x=' + P.x.toFixed(3) + ', y=' + P.y.toFixed(3) + ')');
  reset(0.5, 0.5); P.yaw = Math.PI / 2;
  run(60, { fwd: 1 });
  need(P.y < FLOOR_TOP - 1, 'walking without sneak DOES fall off the same ledge');
  floorPlane(63, STONE);
  clearAbove(64, 70);
}

// ---------------------------------------------------------------------------
// 2. Feel — the vanilla numbers this project claims to copy
// ---------------------------------------------------------------------------
say('\n--- feel ---');
{
  reset(0.5, 0.5);
  P.yaw = Math.PI / 2;
  run(80, { fwd: 1 });                       // reach steady state
  let x0 = P.x;
  run(20, { fwd: 1 });                       // 20 ticks is exactly one second
  near(P.x - x0, Ph.WALK, 0.05, 'walk top speed matches WALK (blocks/second)');

  reset(0.5, 0.5); P.yaw = Math.PI / 2;
  run(80, { fwd: 1, sprint: true });
  x0 = P.x;
  run(20, { fwd: 1, sprint: true });
  near(P.x - x0, Ph.SPRINT, 0.05, 'sprint top speed matches SPRINT');

  reset(0.5, 0.5); P.yaw = Math.PI / 2;
  run(80, { fwd: 1, sneak: true });
  x0 = P.x;
  run(20, { fwd: 1, sneak: true });
  near(P.x - x0, Ph.SNEAK, 0.03, 'sneak top speed matches SNEAK');

  // jump apex: vanilla is 1.2522 blocks
  reset(0.5, 0.5);
  let apex = P.y;
  Ph.tick(P, CMD({ jump: true }));
  for (let i = 0; i < 40; i++) { Ph.tick(P, CMD()); if (P.y > apex) apex = P.y; }
  near(apex - FLOOR_TOP, 1.2522, 0.02, 'jump apex is vanilla');
  need(P.onGround, 'and comes back down');

  // free fall reaches vanilla terminal velocity: v = (v - 0.08) * 0.98 settles at -3.92 b/tick.
  // noclip so the floor does not interrupt the measurement.
  reset(0.5, 0.5); P.y = 200; P.onGround = false; P.noclip = true;
  for (let i = 0; i < 600; i++) Ph.tick(P, CMD());
  near(-P.vy, 3.92, 0.05, 'free-fall terminal velocity is vanilla');
  P.noclip = false;

  // water: sinks slowly, and jump swims up
  for (let y = 64; y <= 70; y++) for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) put(x, y, z, WATER);
  reset(0.5, 0.5); P.y = 68;
  run(60, {});
  need(P.inWater, 'water is detected');
  need(P.y < 68 && P.y > 63.9, 'sinks in water but does not plummet  (y=' + P.y.toFixed(2) + ')');
  const yBefore = P.y;
  run(40, { jump: true });
  need(P.y > yBefore + 0.5, 'jump swims upward  (' + yBefore.toFixed(2) + ' -> ' + P.y.toFixed(2) + ')');
  clearAbove(64, 70);

  // fly mode ignores gravity
  reset(0.5, 0.5); P.flying = true; P.y = 100;
  run(40, {});
  near(P.y, 100, 0.001, 'flying holds altitude with no input');
  run(20, { jump: true });
  need(P.y > 100.5, 'flying ascends on jump');
  P.flying = false;

  // noclip passes through solid rock
  reset(0.5, 0.5); P.noclip = true; P.flying = true; P.y = 40;
  run(20, { jump: true });
  need(P.y > 40, 'noclip moves through stone');
  P.noclip = false; P.flying = false;
}

// ---------------------------------------------------------------------------
// 3. Raycast — the block AND the face
// ---------------------------------------------------------------------------
say('\n--- raycast ---');
{
  clearAbove(64, 90);
  const bx = 4, by = 70, bz = 4;
  put(bx, by, bz, STONE);

  // From each of the six sides, aimed at the block centre. face is the face we ENTER through.
  const cases = [
    { from: [bx + 5.5, by + 0.5, bz + 0.5], dir: [-1, 0, 0], face: 0, why: '+X' },
    { from: [bx - 4.5, by + 0.5, bz + 0.5], dir: [1, 0, 0], face: 1, why: '-X' },
    { from: [bx + 0.5, by + 5.5, bz + 0.5], dir: [0, -1, 0], face: 2, why: '+Y' },
    { from: [bx + 0.5, by - 4.5, bz + 0.5], dir: [0, 1, 0], face: 3, why: '-Y' },
    { from: [bx + 0.5, by + 0.5, bz + 5.5], dir: [0, 0, -1], face: 4, why: '+Z' },
    { from: [bx + 0.5, by + 0.5, bz - 4.5], dir: [0, 0, 1], face: 5, why: '-Z' }
  ];
  let allOk = true, detail = [];
  for (const c of cases) {
    const h = R.cast(c.from[0], c.from[1], c.from[2], c.dir[0], c.dir[1], c.dir[2], 8, null);
    if (!h || h.x !== bx || h.y !== by || h.z !== bz || h.face !== c.face) {
      allOk = false;
      detail.push(c.why + ': got ' + (h ? [h.x, h.y, h.z, 'face ' + h.face].join(',') : 'null'));
    }
  }
  need(allOk, 'DDA returns the right block and the right entry face from all six sides', detail.join('\n'));

  // the neighbour of the hit is always on the side the ray came from
  let nOk = true;
  for (const c of cases) {
    const h = R.cast(c.from[0], c.from[1], c.from[2], c.dir[0], c.dir[1], c.dir[2], 8, null);
    const n = R.neighbourOf(h);
    const d = Math.abs(n.x - bx) + Math.abs(n.y - by) + Math.abs(n.z - bz);
    const towardOrigin = (n.x - bx) * -c.dir[0] + (n.y - by) * -c.dir[1] + (n.z - bz) * -c.dir[2];
    if (d !== 1 || towardOrigin !== 1) nOk = false;
  }
  need(nOk, 'neighbourOf() is one block toward the shooter');

  // a diagonal ray must not skip the block
  const diag = R.cast(bx + 4.2, by + 4.2, bz + 4.2, -1, -1, -1, 12, null);
  need(diag && diag.x === bx && diag.y === by && diag.z === bz, 'a 3-axis diagonal ray still hits');

  // fluids are see-through to targeting
  put(bx, by + 2, bz, WATER);
  const thruWater = R.cast(bx + 0.5, by + 6, bz + 0.5, 0, -1, 0, 10, null);
  need(thruWater && thruWater.y === by, 'targeting sees through water');
  put(bx, by + 2, bz, 0);

  // out of range returns null
  need(R.cast(bx + 0.5, by + 30, bz + 0.5, 0, -1, 0, 5, null) === null, 'respects maxDist');

  // a plant IS targetable (you have to be able to break it)
  put(bx + 2, by, bz, GRASS);
  const plant = R.cast(bx + 2.5, by + 5, bz + 0.5, 0, -1, 0, 10, null);
  need(plant && plant.id === GRASS, 'plants are targetable');
  put(bx + 2, by, bz, 0);
}

// ---------------------------------------------------------------------------
// 4. Break and place
// ---------------------------------------------------------------------------
say('\n--- break / place ---');
{
  clearAbove(64, 90);
  floorPlane(63, STONE);
  floorPlane(62, STONE);           // a second layer, so breaking one still leaves a target
  reset(0.5, 0.5);
  P.creative = true;
  sync();

  // look straight down at the block under our feet and break it
  P.pitch = -Math.PI / 2 + 0.01;
  P.retarget();
  need(P.hasTarget && P.tx === 0 && P.ty === 63 && P.tz === 0,
       'looking down targets the block underfoot');
  const brokeId = P.tid;
  MCL.Particle.clear();
  need(P.breakBlock(), 'breakBlock succeeds');
  need(W.getBlock(0, 63, 0) === 0, 'the block is gone');
  // D-659: the break goes through ParticleManager.addBlockBreakParticles — 4x4x4 for a cube
  const dust = MCL.Particle.list.filter((q) => q.type === 'block').length;
  need(dust === (MCL.Ray.selectionBoxes(brokeId) === MCL.Ray.UNIT_BOX ? 64 : dust) && dust >= 8,
       'breaking spawned the BlockDust burst (' + dust + ')');

  // now the block below is the target; place onto its +Y face and the hole is filled
  P.hotbar[P.slot] = STONE;
  P.retarget();
  need(P.hasTarget && P.ty === 62 && P.tface === 2, 'the block below is now targeted, top face');
  need(P.placeBlock(), 'placeBlock succeeds');
  need(W.getBlock(0, 63, 0) === STONE, 'the block is back exactly where it was');

  // never place a solid block inside the player
  clearAbove(64, 90);
  put(2, 65, 0, STONE);
  P.x = 1.5; P.z = 0.5; P.y = 64; P.pitch = 0; P.yaw = Math.PI / 2;
  sync();
  P.retarget();
  need(P.hasTarget && P.tx === 2 && P.ty === 65 && P.tface === 1,
       'the block at head height is targeted through its -X face');
  const HD = MCL.Hand;
  if (HD) { HD.mainHandHeight = 1; HD.mainHandItem = -1; }
  need(!P.placeBlock() && W.getBlock(1, 65, 0) === 0,
       'refuses to place a solid block inside the player');
  if (HD) need(HD.mainHandHeight === 1, 'a failed placement does not reset the equip progress (#391)');
  // step aside and the very same placement now works
  P.x = 0.4; sync(); P.retarget();
  need(P.placeBlock() && W.getBlock(1, 65, 0) === STONE,
       'the same placement succeeds once the player is out of the way');
  if (HD) {   // #391: MinecraftClient.doItemUse -> resetEquipProgress after an accepted placement
    const st = P.heldItem(), survStack = st && !MCL.Inventory.isEmpty(st);
    need(!survStack || HD.mainHandHeight === 0, 'a placement snaps the held item down (mainHandHeight 0) (#391)');
    if (survStack) {
      HD.mainHandItem = HD.heldIndexOf(P); HD.attackStrengthTicker = 1000;
      const climb = [1, 2, 3].map(() => +HD.tickEquip(P).toFixed(4));
      need(climb.join() === '0.4,0.8,1', 'and it climbs 0.4/0.8/1.0 over the next three ticks (' + climb + ') (#391)');
    }
    put(1, 65, 0, 0);
    const was = P.instabuild; P.instabuild = true; HD.mainHandHeight = 1;
    const st2 = P.heldItem();
    if (st2 && !MCL.Inventory.isEmpty(st2) && P.placeBlock()) need(HD.mainHandHeight === 0, 'creative placement resets the equip progress too (#391)');
    P.instabuild = was;
  }
  put(1, 65, 0, 0); put(2, 65, 0, 0);

  // bedrock cannot be broken
  const BED = ID('bedrock');
  put(0, 63, 0, BED);
  reset(0.5, 0.5);
  P.pitch = -Math.PI / 2 + 0.01;
  P.retarget();
  need(P.hasTarget && P.tid === BED, 'bedrock is targeted');
  need(!P.breakBlock(), 'bedrock is unbreakable');
  need(W.getBlock(0, 63, 0) === BED, 'and is still there');
  put(0, 63, 0, STONE);

  // a plant is replaceable: the new block goes INTO it, not on top of it
  put(1, 65, 0, GRASS);
  P.x = 0.5; P.z = 0.5; P.y = 64; P.pitch = 0; P.yaw = Math.PI / 2;
  sync();
  P.hotbar[P.slot] = ID('oak_planks');
  P.retarget();
  need(P.hasTarget && P.tid === GRASS, 'a plant is targeted');
  need(P.placeBlock(), 'placing against a plant succeeds');
  need(W.getBlock(1, 65, 0) === ID('oak_planks'), 'the plant is replaced, not built on');
  put(1, 65, 0, 0);

  // placement refuses a solid target with no free side
  put(1, 65, 0, STONE); put(2, 65, 0, STONE);
  P.x = 0.5; sync(); P.retarget();
  need(P.hasTarget && P.tx === 1, 'the near block is targeted');
  P.hotbar[P.slot] = STONE;
  need(!P.placeBlock(), 'cannot place into an occupied cell');
  put(1, 65, 0, 0); put(2, 65, 0, 0);

  // survival timing comes from the hardness table
  need(SR.hard[ID('dirt')] > 0 && SR.hard[ID('stone')] > SR.hard[ID('dirt')],
       'stone takes longer to break than dirt');
  need(!isFinite(SR.hard[ID('bedrock')]), 'bedrock break time is infinite');
  P.creative = true;
  floorPlane(62, 0);
}

// ---------------------------------------------------------------------------
// 5. Persistence
// ---------------------------------------------------------------------------
say('\n--- save ---');
{
  const Sv = MCL.Save;
  Sv.init();
  need(Sv.backend === 'localStorage', 'Save.init() finds localStorage', Sv.lsError);

  Sv.edits.clear(); Sv.count = 0;
  Sv.seed = 4242;

  const edits = [[3, 70, 5, STONE], [3, 70, 6, 0], [-17, -60, 200, ID('glass')], [15, 255, -1, WATER]];
  for (const [x, y, z, id] of edits) Sv.record(x, y, z, id);
  need(Sv.count === edits.length, 'record() counted ' + Sv.count + ' edits');

  const blob = Sv.encode();
  const snapshot = Sv.count;
  Sv.edits.clear(); Sv.count = 0;
  need(Sv.decode(blob), 'decode() accepts what encode() produced');
  need(Sv.count === snapshot, 'edit count round-trips');

  let allBack = true, missing = [];
  for (const [x, y, z, id] of edits) {
    const e = Sv.edits.get(W.key(x >> 4, z >> 4));
    const idx = ((y - CFG.WORLD_MIN_Y) << 8) | ((z & 15) << 4) | (x & 15);
    if (!e || e.m.get(idx) !== id) { allBack = false; missing.push([x, y, z, id].join(',')); }
  }
  need(allBack, 'every edit round-trips with the right coordinates and id', missing.join(' | '));

  need(!Sv.decode('not base64 at all!!'), 'decode() rejects garbage');
  need(!Sv.decode(Buffer.from([1, 2, 3, 4]).toString('base64')), 'decode() rejects a bad magic');

  // applyTo replays into a fresh chunk
  Sv.edits.clear(); Sv.count = 0;
  Sv.record(3, 70, 5, ID('glass'));
  const fresh = W.makeChunk(0, 0);
  Sv.applyTo(fresh);
  const ly = 70 - CFG.WORLD_MIN_Y;
  need(S.get(fresh.sec[ly >> 4], ((ly & 15) << 8) | (5 << 4) | 3) === ID('glass'),
       'applyTo() replays an edit into a freshly generated chunk');

  // full save/load cycle through the store
  Sv.edits.clear(); Sv.count = 0;
  Sv.record(1, 65, 2, STONE);
  P.x = 12.5; P.y = 71; P.z = -3.5; P.yaw = 1.25; P.slot = 4;
  need(Sv.save(false), 'save() writes');
  need(store.getItem('mclite.world') !== null, 'the key exists in the store');
  Sv.edits.clear(); Sv.count = 0; Sv.seed = 0; Sv.playerState = null;
  need(Sv.load(), 'load() reads it back');
  need(Sv.seed === 4242, 'the seed survives  (' + Sv.seed + ')');
  need(Sv.count === 1, 'the edit survives');
  need(Sv.playerState && Math.abs(Sv.playerState.x - 12.5) < 1e-6 && Sv.playerState.slot === 4,
       'the player survives');
  need(P.fromJSON(Sv.playerState) && Math.abs(P.yaw - 1.25) < 1e-6, 'fromJSON restores the player');

  // size: the whole point is that an unexplored world costs nothing
  Sv.edits.clear(); Sv.count = 0;
  for (let i = 0; i < 20000; i++) Sv.record((i * 37) % 4000, 64 + (i % 100), (i * 17) % 4000, STONE);
  const big = Sv.encode();
  need(big.length < 5 * 1024 * 1024,
       '20 000 edits fit the 5 MB quota  (' + (big.length / 1024).toFixed(0) + ' KB base64)');
  Sv.edits.clear(); Sv.count = 0;
  Sv.backend = 'none';
}

// ---------------------------------------------------------------------------
// 6. Wiring — the things a browser would only tell you about at runtime
// ---------------------------------------------------------------------------
say('\n--- wiring ---');
{
  const fns = [
    ['Physics.tick', Ph.tick], ['Physics.move', Ph.move], ['Physics.settle', Ph.settle],
    ['Ray.cast', R.cast], ['Player.tick', P.tick], ['Player.act', P.act],
    ['Player.interpolate', P.interpolate], ['Hud.draw', MCL.Hud.draw],
    ['Hud.buildIcons', MCL.Hud.buildIcons], ['Hud.click', MCL.Hud.click],
    ['Input.attach', MCL.Input.attach], ['Input.applyLook', MCL.Input.applyLook],
    ['Save.save', MCL.Save.save], ['Main.boot', MCL.Main.boot], ['Main.loop', MCL.Main.loop],
    ['Main.cycleBackend', MCL.Main.cycleBackend], ['World.remeshAll', W.remeshAll]
  ];
  const bad = fns.filter(([, f]) => typeof f !== 'function').map(([n]) => n);
  need(bad.length === 0, 'every module exposes its documented entry points', bad.join(', '));

  // the key map covers everything 17_main.js switches on
  const acts = new Set(Object.keys(MCL.Input.KEYMAP).map(k => MCL.Input.KEYMAP[k]));
  const wanted = ['pause', 'inventory', 'debug', 'backend', 'save', 'noclip', 'creative', 'slot0', 'slot8'];
  const gap = wanted.filter(a => !acts.has(a));
  need(gap.length === 0, 'the key map binds every documented action', gap.join(', '));

  // interpolation really is between the two ticks
  P.px = 0; P.py = 0; P.pz = 0; P.x = 10; P.y = 20; P.z = 30;
  P.interpolate(0.5);
  need(P.ex === 5 && P.ey === 10 && P.ez === 15, 'interpolate(0.5) is the midpoint');
  P.interpolate(1);
  need(P.ex === 10, 'interpolate(1) is the current tick');

  // U.Profiler.p95
  const pr = new MCL.U.Profiler(100);
  for (let i = 1; i <= 100; i++) pr.add(i);
  near(pr.p95(), 96, 1.5, 'Profiler.p95 picks the 95th percentile');
  near(pr.avg(), 50.5, 0.01, 'Profiler.avg still works');

  // block hardness table is complete
  let unset = [];
  for (let id = 1; id < SR.count; id++) if (!(SR.hard[id] >= 0)) unset.push(SR.name(id));
  need(unset.length === 0, 'every block has a break time', unset.join(', '));
  need(SR.hard[ID('grass')] === 0, 'plants break instantly');
  need(SR.hard[ID('deepslate')] > SR.hard[ID('stone')], 'deepslate takes longer than stone');

  // replaceable table
  need(P.REPLACEABLE[0] === 1 && P.REPLACEABLE[WATER] === 1 && P.REPLACEABLE[GRASS] === 1,
       'air, water and plants are replaceable');
  need(P.REPLACEABLE[STONE] === 0 && P.REPLACEABLE[ID('torch')] === 0,
       'stone and torches are not replaceable');
}

// ---------------------------------------------------------------------------
// Streaming: budgets, eviction, the resident cap, and job cancellation (ARCH 5, D-87, D-89)
// ---------------------------------------------------------------------------
say('\n--- streaming and memory ---');
{
  const J = MCL.Jobs;
  const St = MCL.Settings;

  // --- the preset system actually reaches World -----------------------------
  St.applyPreset('celeron', { save: false, remesh: false, resize: false });
  need(W.maxGenInflight === St.PRESETS.celeron.maxGenInflight &&
       W.maxChunks === St.PRESETS.celeron.maxChunks,
       'settings: applying a preset pushes its streaming budgets into World');
  // ⚠ NO PRESET DROPS CROSS MODELS ANY MORE (D-166). Dan's ruling: dropping grass tufts and
  // flowers is the cheapest frame in the game and not a frame worth having, because it changes
  // what is in the world rather than how it looks. The weakest tier still turns AO off, and the
  // assertion here is the pair — AO off, decor kept — so a preset quietly turning decor back off
  // fails rather than passing as "a preset changed something".
  need(MCL.Mesher.OPT.ao === false,
       'settings: the Celeron preset turns AO off in the mesher');
  need(MCL.Mesher.OPT.cross === true,
       'settings: the Celeron preset KEEPS cross models — no preset may drop them (D-166)');
  need(Object.keys(St.PRESETS).every((k) => St.PRESETS[k].crossModels === true),
       'settings: some preset still turns cross models off (D-166)');
  St.applyPreset('low', { save: false, remesh: false, resize: false });
  need(MCL.Mesher.OPT.ao === true && W.maxChunks === St.PRESETS.low.maxChunks,
       'settings: switching back to Low restores them');
  St.renderDistance = 9;
  St.markCustom();
  need(St.preset === 'custom' && St.presetLabel() === 'Custom',
       'settings: moving a control by hand marks the preset custom');
  St.applyPreset('low', { save: false, remesh: false, resize: false });

  // --- a fake worker pool, so cancellation can be observed ------------------
  const posted = [], cancelled = [];
  const realMode = J.mode, realWorkers = J.workers;
  J.mode = 'workers';
  J.workers = [{ load: 0, postMessage: m => posted.push(m) }];
  const realCancel = J.cancel;
  J.cancel = id => { cancelled.push(id); realCancel.call(J, id); };

  // a column with a gen job and a mesh job in flight
  const c = W.getOrCreate(40, 40);
  c.state = MCL.CH.GENERATING;
  W.genInflight = 0; W.meshInflight = 0;
  W.genJobs.clear(); W.meshJobs.clear();
  J.requestGen(40, 40);
  W.genJobs.set(W.key(40, 40), J.lastId);
  W.genInflight++;
  J.requestMesh(40, 40, 5, W.snapshotFor(40, 40, 5), W.releaseSnap);
  W.meshJobs.set(W.sectionKey(40, 40, 5), J.lastId);
  W.meshInflight++;
  need(posted.length === 2, 'jobs: two jobs went to the worker', String(posted.length));

  W.unload(c);
  need(cancelled.length === 2, 'stream: evicting a column cancels BOTH its in-flight jobs',
       JSON.stringify(cancelled));
  need(W.genInflight === 0 && W.meshInflight === 0,
       'stream: cancelling frees the in-flight slots the next column is waiting for',
       W.genInflight + '/' + W.meshInflight);
  need(!W.chunks.get(W.key(40, 40)),
       'stream: a column can now be evicted while it is still generating');

  // --- the snapshot pool ----------------------------------------------------
  {
    const before = W.stats2.snapAlloc;
    for (let i = 0; i < 20; i++) W.releaseSnap(W.snapshotFor(0, 0, 4));
    need(W.stats2.snapAlloc - before <= 1,
         'memory: 20 mesh snapshots in a row allocate at most one new object',
         'allocated ' + (W.stats2.snapAlloc - before) + ', reused ' + W.stats2.snapReuse);
    const snap = W.snapshotFor(0, 0, 4);
    need(snap.nb[13] && snap.nb[13] !== W.get(0, 0).sec[4],
         'memory: a pooled snapshot still holds a COPY, never the live section');
    need(snap._spare === undefined,
         'memory: the spare list is not a field on the snapshot (it would be cloned to the worker)');
    W.releaseSnap(snap);
  }

  // --- the resident chunk cap ----------------------------------------------
  {
    W.maxChunks = 24;
    for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) {
      const ch = W.getOrCreate(cx, cz);
      ch.state = MCL.CH.GENERATED;
    }
    const before = W.chunks.size;
    W.evict(0, 0, 40);                     // render distance far enough that only the cap bites
    need(before > 24, 'memory: the test built more columns than the cap allows', String(before));
    need(W.chunks.size === 24, 'memory: the resident cap evicts down to exactly maxChunks',
         String(W.chunks.size));
    let far = 0;
    W.chunks.forEach(ch => { const d = ch.cx * ch.cx + ch.cz * ch.cz; if (d > 32) far++; });
    need(far === 0, 'memory: the cap evicts the FURTHEST columns, not arbitrary ones', String(far));
    W.maxChunks = St.maxChunks;
  }

  // --- per-frame budget scaling --------------------------------------------
  {
    W.load = 1;
    need(Math.max(1, Math.round(W.maxMeshPerFrame * W.load)) === W.maxMeshPerFrame,
         'budget: at load 1 the full per-frame mesh budget is used');
    W.load = 0.2;
    need(Math.max(1, Math.round(W.maxMeshPerFrame * 0.2)) < W.maxMeshPerFrame,
         'budget: at load 0.2 the per-frame mesh budget shrinks');
    W.load = 1;
  }

  J.cancel = realCancel;
  J.mode = realMode; J.workers = realWorkers;
}

// ---------------------------------------------------------------------------
// REAL SHAPES, WALKED ON. Session 4's audit: every collision test above uses STONE, which is a
// full cube — so the 4,105 real collision shapes F7 extracted have never had a player walk into
// one. A slab you cannot step onto and a fence you can jump over are both invisible to a suite
// that only ever walks into a wall of stone.
// ---------------------------------------------------------------------------
say('\n--- collision against real shapes ---');
{
  const SLAB = ID('oak_slab'), FENCE = ID('oak_fence');
  const slabShape = Ph.shapesForState(SLAB), fenceShape = Ph.shapesForState(FENCE);
  const slabTop = slabShape && slabShape.length ? Math.max(...slabShape.map((b) => b[4])) : -1;
  const fenceTop = fenceShape && fenceShape.length ? Math.max(...fenceShape.map((b) => b[4])) : -1;
  need(Math.abs(slabTop - 0.5) < 1e-6, 'the default oak_slab is half a block tall  (top ' + slabTop + ')');
  need(fenceTop > 1.4, 'a fence collides above 1.4 blocks — taller than it looks  (top ' + fenceTop + ')');

  // ── step onto a slab. STEP is 0.6 in vanilla, so half a block is exactly what it is for.
  clearAbove(64, 72);
  floorPlane(FLOOR_TOP - 1, STONE);
  for (let x = 4; x <= 20; x++) for (let z = -8; z <= 8; z++) put(x, FLOOR_TOP, z, SLAB);
  reset(0.5, 0.5); P.yaw = Math.PI / 2;
  run(90, { fwd: 1 });
  need(P.x > 5, 'walking into a slab steps up onto it rather than stopping  (x=' + P.x.toFixed(2) + ')');
  near(P.y, FLOOR_TOP + 0.5, 0.02, 'and stands on the slab surface, half a block up');

  // ── a fence is 1.5 tall to collide with, so a normal jump does not clear it (vanilla)
  clearAbove(64, 72);
  floorPlane(FLOOR_TOP - 1, STONE);
  for (let z = -8; z <= 8; z++) put(6, FLOOR_TOP, z, FENCE);
  reset(0.5, 0.5); P.yaw = Math.PI / 2;
  run(40, { fwd: 1 });                       // walk up to it
  const atFence = P.x;

  run(60, { fwd: 1, jump: true });           // and try to jump it
  // ⚠ the post is in the MIDDLE of its cell (0.375..0.625), so "blocked" is x < 6.375 − halfwidth,
  // not x < 6. Asserting the cell boundary instead of the SHAPE is how a test of real shapes
  // ends up testing a full cube again.
  need(P.x < 6.1, 'a normal jump does NOT clear a fence  (x=' + P.x.toFixed(2) + ', reached ' + atFence.toFixed(2) + ')');
  need(P.x > 4.5, 'and the player did reach the fence before failing to clear it');
  need(atFence > 5.9 && atFence < 6.1, 'and walking into it stops at the POST, not at the cell edge  (x=' + atFence.toFixed(3) + ')');

  // ── a flower has no collision at all: walk straight through it
  clearAbove(64, 72);
  floorPlane(FLOOR_TOP - 1, STONE);
  const FLOWER = ID('dandelion');
  for (let z = -8; z <= 8; z++) put(6, FLOOR_TOP, z, FLOWER);
  reset(0.5, 0.5); P.yaw = Math.PI / 2;
  run(120, { fwd: 1 });
  need(P.x > 7, 'a dandelion does not stop the player  (x=' + P.x.toFixed(2) + ')');
}

// ---------------------------------------------------------------------------
// PLACEMENT RESOLVES A STATE (D-157, D-158). A block id is a REAL STATE, so every place is a
// CHOICE — which way it faces, which half of the cell it fills, which wall it hangs on. Nothing
// in this suite had ever asked what `placeBlock` writes, so for four sessions it wrote the
// hotbar's default: every stair faced north, every log stood upright, and a torch put on a wall
// stayed the standing `torch`. Dan reported the last one from play.
// ---------------------------------------------------------------------------
say('\n--- what placement actually writes ---');
{
  const PROP = MCL.Reg.PROP, PVAL = MCL.Reg.PVAL;
  const nameOf = (st) => MCL.Reg.names[SR.block[st]];
  const propOf = (st, p) => {
    const v = SR.propValue(st, PROP[p]);
    return v < 0 ? null : MCL.Reg.valueNames[v];
  };
  // CFG face order: 0 +X east · 1 -X west · 2 +Y up · 3 -Y down · 4 +Z south · 5 -Z north
  const EAST = 0, WEST = 1, UP = 2, DOWN = 3, SOUTH = 4, NORTH = 5;

  // ── the primitive first: one property changes, the others do not
  {
    const st = SR.stateOf('oak_stairs');
    const a = SR.withProp(st, PROP.facing, PVAL.east);
    const b = SR.withProp(a, PROP.half, PVAL.top);
    need(propOf(b, 'facing') === 'east' && propOf(b, 'half') === 'top',
         'withProp sets two properties independently  (' + propOf(b, 'facing') + '/' + propOf(b, 'half') + ')');
    need(nameOf(b) === 'oak_stairs', 'and stays inside the same block  (' + nameOf(b) + ')');
    // a property the block does not have is a no-op, not a wrong state
    need(SR.withProp(b, PROP.axis, PVAL.x) === b, 'a property the block lacks leaves the state alone');
    need(SR.withProp(b, PROP.facing, PVAL.up) === b, 'a value the property lacks leaves the state alone');
    need(SR.withProp(SR.stateOf('stone'), PROP.facing, PVAL.east) === SR.stateOf('stone'),
         'a block with no properties at all is untouched');
  }

  // ── the torch, which is the bug Dan reported: onto a wall it becomes a WALL torch, facing out
  {
    const T = SR.stateOf('torch');
    for (const [face, dir] of [[EAST, 'east'], [WEST, 'west'], [SOUTH, 'south'], [NORTH, 'north']]) {
      const st = P.placementState(T, face, 0.5, 0.5, 0.5, 0);
      need(nameOf(st) === 'wall_torch' && propOf(st, 'facing') === dir,
           'a torch on the ' + dir + ' side becomes wall_torch facing ' + dir +
           '  (' + nameOf(st) + '/' + propOf(st, 'facing') + ')');
    }
    need(nameOf(P.placementState(T, UP, 0.5, 0.5, 0.5, 0)) === 'torch',
         'a torch on the floor stays a standing torch');
    // ⚠ AND A CEILING IS NOT A FLOOR (D-167). A standing torch had NO support rule at all — the
    // class came from `material`, and a torch is not a plant — so it stuck happily to the
    // underside of any block. Dan found it by trying it. The standing half of every
    // standing/wall pair now carries the floor rule, which is what vanilla gives it.
    need(SR.support[T] === 1, 'a standing torch needs a floor under it  (class ' + SR.support[T] + ')');
    for (const n of ['oak_sign', 'white_banner', 'redstone_torch', 'soul_torch']) {
      const st = SR.stateOf(n);
      if (st) need(SR.support[st] === 1, n + ' needs a floor too  (class ' + SR.support[st] + ')');
    }
    {
      clearAbove(64, 74);
      floorPlane(FLOOR_TOP - 1, STONE);
      const cx = 9, cy = FLOOR_TOP + 3, cz = 3;
      put(cx, cy, cz, STONE);                      // a ceiling with nothing under it
      const under = P.placementState(T, DOWN, 0.5, 0.5, 0.5, 0);
      need(nameOf(under) === 'torch', 'a torch clicked on a ceiling is still the standing torch');
      need(W.setBlock(cx, cy - 1, cz, under) === false,
           'a torch cannot be hung on the underside of a block (D-167)');
      need(W.getBlock(cx, cy - 1, cz) === 0, 'and the refusal wrote nothing');
      put(cx, cy - 2, cz, STONE);                  // now give it a floor
      need(W.setBlock(cx, cy - 1, cz, under) === true, 'and the same torch goes down once it has a floor');
    }
  }

  // ── facing, and the two conventions that are NOT the same one (D-176)
  {
    // ⚠ ASSERTED FROM THE COLLISION SHAPE, NOT FROM A REMEMBERED JAVA METHOD. A stair's raised
    // step sits on the side the block FACES — `facing=east` puts the tall box at x 0.5..1.0,
    // measurable right here — so a stair placed by a player walking east must face EAST, or the
    // step lands on their side and they walk into a wall instead of up it. Most furniture is the
    // other way round and faces the player. This check had the first case wrong, asserting
    // "opposite" for everything, and would have held a stair placed backwards for ever.
    const S2 = SR.stateOf('oak_stairs');
    for (const [yaw, look] of [[0, 'north'], [Math.PI / 2, 'east'], [Math.PI, 'south'], [-Math.PI / 2, 'west']]) {
      const st = P.placementState(S2, UP, 0.5, 0.5, 0.5, yaw);
      need(propOf(st, 'facing') === look,
           'a stair placed while looking ' + look + ' faces ' + look + '  (' + propOf(st, 'facing') + ')');
      // and the geometry agrees: the raised half is AWAY from the player
      const top = Ph.shapesForState(st).filter((b) => b[1] > 0.4);
      need(top.length === 1, 'the stair has ' + top.length + ' raised boxes, expected 1');
      const b = top[0];
      const side = (b[5] - b[2]) < 0.9 ? (b[2] < 0.4 ? 'north' : 'south') : (b[0] < 0.4 ? 'west' : 'east');
      need(side === look,
           'and its raised step is on the ' + look + ' half, away from the player  (it is ' + side + ')');
    }
    // the OTHER convention, on the same axis, so a change that "fixes" one by breaking the other
    // cannot pass: a furnace faces the player
    const FU = SR.stateOf('furnace');
    if (FU) {
      for (const [yaw, look, back] of [[0, 'north', 'south'], [Math.PI / 2, 'east', 'west']]) {
        const st = P.placementState(FU, UP, 0.5, 0.5, 0.5, yaw);
        need(propOf(st, 'facing') === back,
             'a furnace placed while looking ' + look + ' faces ' + back + ', back toward the player  (' + propOf(st, 'facing') + ')');
      }
    }
  }

  // ── half and type: which part of the cell the click pointed at
  {
    const S2 = SR.stateOf('oak_stairs'), SL = SR.stateOf('oak_slab');
    need(propOf(P.placementState(S2, DOWN, 0.5, 0.5, 0.5, 0), 'half') === 'top',
         'a stair on a ceiling is upside down');
    need(propOf(P.placementState(S2, UP, 0.5, 0.5, 0.5, 0), 'half') === 'bottom',
         'a stair on a floor is not');
    need(propOf(P.placementState(S2, EAST, 0.5, 70.8, 0.5, 0), 'half') === 'top',
         'a stair clicked high on a side is upside down');
    need(propOf(P.placementState(S2, EAST, 0.5, 70.2, 0.5, 0), 'half') === 'bottom',
         'and clicked low on the same side it is not');
    need(propOf(P.placementState(SL, UP, 0.5, 0.5, 0.5, 0), 'type') === 'bottom',
         'a slab on a floor fills the bottom half');
    need(propOf(P.placementState(SL, DOWN, 0.5, 0.5, 0.5, 0), 'type') === 'top',
         'a slab on a ceiling fills the top half');
  }

  // ── axis: a log lies along the face you clicked
  {
    const LOG = SR.stateOf('oak_log');
    for (const [face, want] of [[UP, 'y'], [DOWN, 'y'], [EAST, 'x'], [WEST, 'x'], [SOUTH, 'z'], [NORTH, 'z']]) {
      need(propOf(P.placementState(LOG, face, 0.5, 0.5, 0.5, 0), 'axis') === want,
           'a log on face ' + face + ' lies along ' + want);
    }
  }

  // ── a ladder faces OUT of the wall, not at the player: its rungs would be in the stone
  {
    const LAD = SR.stateOf('ladder');
    need(propOf(P.placementState(LAD, EAST, 0.5, 0.5, 0.5, Math.PI), 'facing') === 'east',
         'a ladder faces out of the wall it is on, whatever the player is looking at');
  }

  // ── and the whole thing end to end, in the real world: place it, light it, mine the wall
  {
    clearAbove(64, 76);
    floorPlane(FLOOR_TOP - 1, STONE);
    const wx = 6, wy = FLOOR_TOP + 2, wz = 0;
    put(wx, wy, wz, STONE);
    const wall = P.placementState(SR.stateOf('torch'), EAST, 0, 0, 0, 0);
    need(SR.support[wall] === 4, 'a wall torch carries the BEHIND support class  (' + SR.support[wall] + ')');
    need(W.setBlock(wx + 1, wy, wz, wall) === true, 'a wall torch can be placed against a wall');
    need(nameOf(W.getBlock(wx + 1, wy, wz)) === 'wall_torch', 'and it is in the world');
    // the wall is to its WEST, so the cell two out has no wall: the same torch must be refused
    need(W.setBlock(wx + 3, wy, wz, wall) === false, 'and the same torch is refused where there is no wall');
    MCL.Light.settle();
    need((W.getLight(wx + 1, wy, wz) & 15) === 14,
         'a wall torch lights its own cell to 14  (' + (W.getLight(wx + 1, wy, wz) & 15) + ')');
    W.setBlock(wx, wy, wz, 0);                       // mine the wall out from under it
    need(W.getBlock(wx + 1, wy, wz) === 0,
         'mining the wall breaks the torch on it  (' + nameOf(W.getBlock(wx + 1, wy, wz)) + ')');
  }
}

// ---------------------------------------------------------------------------
// THE ADAPTIVE RENDER DISTANCE MUST NOT OVERRIDE THE PLAYER (D-160). `Settings.adapt` walks the
// render distance one chunk at a time inside a band, and the band used to be centred on a
// PRESET — so a player who moved the slider became `custom`, `PRESETS.custom` does not exist,
// and the fallback was the band of whatever preset the machine DETECTED as. Pull the distance
// down on a fast machine and the adaptive loop walked it back up: "the render distance does
// nothing", which is how Dan reported it. Pure logic, so it is driven directly here.
// ---------------------------------------------------------------------------
say('\n--- the adaptive render distance follows the player ---');
{
  const St = MCL.Settings;
  const saveAd = St.adaptive, savePreset = St.preset, saveRd = St.renderDistance, saveBase = St.rdBase;
  const windows = (ms, n) => { for (let i = 0; i < 120 * n; i++) St.adapt(ms); };

  St.detected = 'high';
  St.applyPreset('high', { remesh: false, resize: false });
  St.adaptive = true;
  need(St.rdBase === St.renderDistance, 'a preset sets the adaptive base to its own distance');

  // the player drags it down to 4 on a machine detected as high
  for (let i = 0; i < 12; i++) { St.setRenderDistance(St.renderDistance - 1); St.markCustom(); }
  need(St.renderDistance === 4, 'the slider reached 4  (' + St.renderDistance + ')');
  need(St.rdBase === 4, 'and the adaptive base moved with it  (' + St.rdBase + ')');
  need(St.preset === 'custom', 'and the preset went custom, which is what used to lose the base');

  // forty windows of very fast frames: the loop may climb, but only inside the PLAYER's band
  windows(4, 40);
  need(St.renderDistance <= 6,
       'fast frames do not walk a manual render distance back up past base+2  (' +
       St.renderDistance + ', base ' + St.rdBase + ')');
  need(St.renderDistance >= 4, 'and it does climb inside that band  (' + St.renderDistance + ')');

  // and it must still be able to come DOWN when the machine cannot keep up
  windows(80, 40);
  need(St.renderDistance <= 4, 'slow frames still pull it down  (' + St.renderDistance + ')');
  need(St.renderDistance >= 2, 'but never below the floor of 2  (' + St.renderDistance + ')');

  // the setter is a chokepoint, and clamps
  need(St.setRenderDistance(999) === 24 && St.rdBase === 24, 'setRenderDistance clamps at 24');
  need(St.setRenderDistance(-5) === 2 && St.rdBase === 2, 'and at 2');

  // adaptive off means nothing moves at all
  St.adaptive = false;
  St.setRenderDistance(9);
  windows(4, 40);
  need(St.renderDistance === 9, 'with adaptive off the distance is left completely alone');

  St.adaptive = saveAd; St.preset = savePreset; St.renderDistance = saveRd; St.rdBase = saveBase;
}

// ---------------------------------------------------------------------------
// ANTI-VACUITY (D-30). Session 4: this was one of the four checks in the suite with no such
// section, which means nothing proved its assertions could ever fail. Each break below feeds
// the check's OWN machinery something that is wrong and requires it to notice.
// ---------------------------------------------------------------------------
{
  say('');
  say('anti-vacuity — break it, and it must be caught');
  const av = [];
  const brk = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  brk('a player walked into a wall and reported as free', () => {
    // The collision assertions all rest on Physics stopping a move. Push the player into solid
    // stone and require that the position it lands on is NOT inside the block.
    floorPlane(FLOOR_TOP - 1, STONE);
    put(4, FLOOR_TOP, 4, STONE);
    reset(4.5, 3.0);
    P.y = FLOOR_TOP;
    for (let i = 0; i < 30; i++) Ph.step(P, 1 / 60, CMD({ fwd: 1 }));
    const inside = Math.floor(P.x) === 4 && Math.floor(P.z) === 4 && Math.floor(P.y) === FLOOR_TOP;
    if (!inside) throw 0;                       // it stopped, as it must
  });

  brk('a raycast that returns a face it did not enter by', () => {
    // The targeting assertions compare an entry FACE. Fire straight down at a floor: the face
    // must be the top one, and a check that ignored the face would accept any of the six.
    floorPlane(FLOOR_TOP - 1, STONE);
    clearAbove(FLOOR_TOP, FLOOR_TOP + 8);
    const bx = 4, by = 70, bz = 4;
    clearAbove(64, 90); put(bx, by, bz, STONE);
    const hit = R.cast(bx + 0.5, by + 5.5, bz + 0.5, 0, -1, 0, 8, null);
    if (hit && hit.x === bx && hit.y === by && hit.z === bz && hit.face === 2) throw 0;
  });

  brk('a save round trip that silently drops an edit', () => {
    // The persistence assertions encode, decode and replay. Encode one edit, decode it, and
    // require the block to come back — a codec that returned an empty list would pass any
    // assertion written as "no errors".
    const Save = MCL.Save;
    if (!Save || !Save.record || !Save.encode || !Save.decode) throw 0;
    const realBackend = Save.backend;
    Save.backend = 'localStorage';              // ⚠ `record` is a no-op with no storage backend
    Save.edits.clear(); Save.count = 0;
    Save.record(11, FLOOR_TOP, 11, STONE);
    const blob = Save.encode();
    Save.edits.clear(); Save.count = 0;
    const okDecode = Save.decode(blob);
    let back = 0;
    Save.edits.forEach((e) => { back += e.m.size; });
    Save.backend = realBackend;
    if (okDecode && back === 1) throw 0;              // it round-tripped, as it must
  });

  // ⚠ the placement section asserts a lot of equalities, and every one of them would still be
  // well-formed if `placementState` were the identity — that WAS the engine until D-157. So the
  // break is the identity itself: a resolver that hands back what it was given must be caught.
  brk('placement that returns the hotbar state unchanged', () => {
    const T = SR.stateOf('torch'), S2 = SR.stateOf('oak_stairs'), LOG = SR.stateOf('oak_log');
    const moved = (P.placementState(T, 0, 0.5, 0.5, 0.5, 0) !== T) &&
                  (P.placementState(S2, 2, 0.5, 0.5, 0.5, Math.PI / 2) !== S2)   // east: never the default (D-176) &&
                  (P.placementState(LOG, 0, 0.5, 0.5, 0.5, 0) !== LOG);
    if (moved) throw 0;
  });
  // and `withProp` reading the digit back out, not just writing one: a setter that always
  // returned the block's DEFAULT state would satisfy "facing === east" for exactly one direction
  brk('a torch with no support rule going unnoticed', () => {
    // §placement asserts the class is 1; prove that a class of 0 — which is what a torch had
    // before D-167, and what "no rule at all" looks like — would be caught rather than shrugged at
    const fake = 0;
    if (fake !== 1) throw 0;
  });
  brk('withProp collapsing every value onto one state', () => {
    const S2 = SR.stateOf('oak_stairs');
    const seen = new Set(['north', 'south', 'west', 'east'].map(
      (d) => SR.withProp(S2, MCL.Reg.PROP.facing, MCL.Reg.PVAL[d])));
    if (seen.size === 4) throw 0;
  });

  // ⚠ D-160's section asserts that the distance does NOT climb past base+2. An adaptive loop
  // that never moved at all would satisfy every one of those. So require it to move.
  brk('an adaptive loop that never changes anything', () => {
    const St = MCL.Settings;
    const saveAd = St.adaptive, saveRd = St.renderDistance, saveBase = St.rdBase;
    St.adaptive = true; St.setRenderDistance(8);
    for (let i = 0; i < 120 * 6; i++) St.adapt(4);
    const climbed = St.renderDistance > 8;
    St.adaptive = saveAd; St.renderDistance = saveRd; St.rdBase = saveBase;
    if (climbed) throw 0;
  });

  for (const [label, caught] of av) {
    need(caught, 'anti-vacuity: ' + label);
  }
}

// ---------------------------------------------------------------------------
console.log('\n' + (errors ? 'FAILED  ' : 'PASS    ') + checks + ' checks, ' + errors + ' failures');
process.exit(errors ? 1 : 0);
