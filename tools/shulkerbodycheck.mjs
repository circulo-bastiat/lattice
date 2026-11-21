#!/usr/bin/env node
// shulkerbodycheck.mjs — #657: the shulker's hitbox growth, moveEntities, isCollidable, pushAwayFrom,
// ShulkerLookControl, colour and spawnNewShulker (src/07zzk_shulker.js, ShulkerEntity.java).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('  ✓ ' + m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
console.log('shulkerbodycheck -- #657 hitbox/moveEntities/collidable/push/look/colour/duplication');

const EXTRA = ['07h_entities.js', '07_world.js', '07b_behaviour.js', '14b_physics.js',
               '07i_entitylist.js', '07k_goals.js', '07zzk_shulker.js', '07zzl_shulkerdraw.js',
               '14j_combat.js', '14f_inventory.js', '14d_survival.js', '07zx_particle.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init(); M.Shulker.init();
const EL = M.EntityList, Sh = M.Shulker, W = M.World, R = M.Reg;
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
for (let x = -48; x <= 48; x++) for (let z = -48; z <= 48; z++) W.setBlock(x, 4, z, def('stone'));

// 1. hitbox at openProgress 1 along each face (extra length 1.0: the box is 2 long along the opening)
ok(near(Sh.extraLength(0), 0) && near(Sh.extraLength(1), 1), 'extraLength is 0 closed and 1 fully open');
const dims = (b) => [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
for (let face = 0; face < 6; face++) {
  const s = EL.spawn('shulker', 0.5, 5, 0.5); s.shulkerFace = face; s.shulkerOpen = 1;
  const b = Sh.boundingBox(s), d = dims(b), o = Sh.OPPOSITE[face];
  const ax = [Sh.DX[o] !== 0, Sh.DY[o] !== 0, Sh.DZ[o] !== 0];
  ok([0, 1, 2].every((a) => near(d[a], ax[a] ? 2 : 1)), `face ${face}: open box is 2 long along the opening axis, 1 elsewhere`);
  const grow = (Sh.DX[o] + Sh.DY[o] + Sh.DZ[o]) > 0 ? [b[3], b[4], b[5]] : [b[0], b[1], b[2]];
  const a = ax.indexOf(true), base = [0, 5, 0][a] + (a === 1 ? 0 : 0);
  const lo = [0, 5, 0][a], edge = (Sh.DX[o] + Sh.DY[o] + Sh.DZ[o]) > 0 ? lo + 2 : lo - 1;
  ok(near(grow[a], a === 1 ? edge : edge), `face ${face}: the far edge sits one block past the cell on the opening side`);
  s.shulkerOpen = 0;
  ok(dims(Sh.boundingBox(s)).every((v) => near(v, 1)), `face ${face}: closed box is the unit cube`);
}
{
  const s = EL.spawn('shulker', 0.5, 5, 0.5); s.shulkerFace = 0; s.shulkerOpen = 1;
  okAv(dims(Sh.boundingBox(s))[1] > 1.5, 'a floor shulker\'s open box really is taller than a unit cube');
}

// 2. moveEntities pushes an entity standing in the opening lid
{
  const s = EL.spawn('shulker', 20.5, 5, 20.5); s.shulkerFace = 0; s.shulkerOpen = 0; s.shulkerPeek = 100;
  const v = EL.spawn('cow', 20.5, 5.2, 20.5);
  const y0 = v.y; s.shulkerOpenO = 0; s.shulkerOpen = 0.05;
  const n = Sh.moveEntities(s);
  okAv(n >= 1 && v.y > y0, 'an entity inside the opening slab is carried up by the growth in extra length');
  const far = EL.spawn('cow', 30.5, 5, 30.5); const fy = far.y;
  Sh.moveEntities(s);
  ok(near(far.y, fy), 'an entity outside the slab is untouched');
  s.shulkerOpenO = 0.5; s.shulkerOpen = 0.45;
  const y1 = v.y; Sh.moveEntities(s);
  ok(near(v.y, y1), 'a closing lid (negative delta) moves nothing');
  const s2 = EL.spawn('shulker', 20.5, 5, 21.5); s2.shulkerOpenO = 0; s2.shulkerOpen = 0.05;
  const y2 = s2.y; Sh.moveEntities(s);
  ok(near(s2.y, y2), 'another shulker is never moved');
}

// 3. collidable, targeting margin, pushAwayFrom
{
  const s = EL.spawn('shulker', -20.5, 5, -20.5);
  okAv(Sh.isCollidable(s) === true, 'a live shulker is collidable');
  s.dead = true;
  ok(Sh.isCollidable(s) === false, 'a dead shulker is not');
  ok(Sh.TARGETING_MARGIN === 0, 'getTargetingMargin is 0');
  const a = EL.spawn('shulker', -10.5, 5, -10.5), c = EL.spawn('cow', -10.2, 5, -10.5);
  M.Physics.push(a, c);
  okAv(a.vx === 0 && a.vz === 0, 'pushing never gives a shulker velocity');
  ok(c.vx !== 0, 'the other entity is still pushed');
}

// 4. ShulkerLookControl yaw relative to the attached face
{
  const s = EL.spawn('shulker', 0.5, 5, 0.5); s.shulkerFace = 0;
  const yz = Sh.targetYawDeg(s, 0.5, 5, 10.5), yx = Sh.targetYawDeg(s, 10.5, 5, 0.5);
  ok(Sh.targetYawDeg(s, 0.5, 15, 0.5) === null, 'a target straight along the face axis gives no yaw');
  okAv(Math.abs(yz - yx) > 45, 'yaw differs by direction of the target');
  s.shulkerFace = 4;   // west wall
  const yw = Sh.targetYawDeg(s, 0.5, 5, 10.5);
  ok(Math.abs(yw - yz) > 1, 'the same target reads a different yaw once the attached face changes');
  M.Ai.tickHead(s);
  ok(s.look instanceof Sh.LookControl, 'the roster head is a ShulkerLookControl');
}

// 5. colour
{
  const s = EL.spawn('shulker', 0.5, 5, 0.5);
  ok(Sh.getColor(s) === null, 'default colour is null');
  Sh.readColorNbt(s, { Color: 5 });
  okAv(Sh.getColor(s) === 5, 'NBT Color 5 is read');
  Sh.readColorNbt(s, { Color: 16 });
  ok(Sh.getColor(s) === null, 'Color 16 means undyed');
  const o = {}; Sh.writeColorNbt(s, o);
  ok(o.Color === 16, 'Color is written back');
}

// 6. spawnNewShulker
{
  const count = () => EL.list.filter((e) => e.type === 'shulker' && !e.removed).length;
  // a pocket to teleport to: stone floor y=4, attach DOWN anywhere; rand sequence forces a landing
  const s = EL.spawn('shulker', 40.5, 5, 40.5); s.shulkerFace = 0; s.shulkerPeek = 100; Sh.setColor(s, 3);
  const before = count();
  const seq = [0.5, 0.5, 0.5, 0.5, 0.5, 0.99];   // teleport offsets (0.5 -> 0), then the 1-(n-1)/5 roll
  let i = 0; const rand = () => seq[Math.min(i++, seq.length - 1)];
  // offset 0,0,0 lands on its own cell (non-air? own cell is air): tryTeleport succeeds in place
  const r = Sh.spawnNewShulker(s, rand);
  okAv(!!r && count() === before + 1, 'an open shulker hit by a bullet duplicates');
  ok(r && Sh.getColor(r) === 3, 'the copy inherits the colour');
  const c = EL.spawn('shulker', 42.5, 5, 42.5); c.shulkerFace = 0; c.shulkerPeek = 0;
  const b2 = count();
  ok(Sh.spawnNewShulker(c, () => 0.5) === null && count() === b2, 'a closed shulker does not duplicate');
  // crowd: 6+ shulkers nearby -> probability (n-1)/5 >= 1 -> never duplicates
  for (let k = 0; k < 6; k++) EL.spawn('shulker', 40.5 + k, 5, 44.5);
  const d = EL.spawn('shulker', 40.5, 5, 46.5); d.shulkerFace = 0; d.shulkerPeek = 100;
  const b3 = count();
  okAv(Sh.spawnNewShulker(d, () => 0.5) === null && count() === b3, 'a crowd of shulkers suppresses duplication');
}

// 6b. a neighbour whose centre is outside box+-8 but whose AABB straddles the edge still counts
{
  const s = EL.spawn('shulker', 40.5, 5, 80.5); s.shulkerFace = 0; s.shulkerPeek = 100;
  for (let k = 0; k < 4; k++) EL.spawn('shulker', 49.3, 5, 80.5 + k * 0.01);   // centre 8.3 from box edge x=41
  const b = EL.list.filter((e) => e.type === 'shulker' && !e.removed).length;
  let i = 0; const seq = [0.5, 0.5, 0.5, 0.7]; const rand = () => seq[Math.min(i++, 3)];
  ok(Sh.spawnNewShulker(s, rand) === null && EL.list.filter((e) => e.type === 'shulker' && !e.removed).length === b,
    'edge-straddling neighbours count: n=5 -> roll 0.7 < 4/5 suppresses the copy');
}

// 7. isCollidable wired into Ph.move: an open shulker's grown box blocks a walker
{
  const P = M.Physics;
  const s = EL.spawn('shulker', -20.5, 5, -20.5); s.shulkerFace = 0; s.shulkerOpen = 1;   // box y 5..7
  const w = { x: -20.5, y: 8, z: -20.5, width: 0.6, height: 1.8, vx: 0, vy: 0, vz: 0 };
  P.move(w, 0, -3, 0);
  okAv(near(w.y, 7) && w.onGround, 'a body falling onto an open shulker lands on the grown lid box (y 7), not the floor');
  const a = { x: -22.5, y: 5.2, z: -20.5, width: 0.6, height: 1.8, vx: 0, vy: 0, vz: 0 };
  P.move(a, 3, 0, 0);
  okAv(a.x < -20.5 - 0.5 - 0.3 + 1e-6 && a.x > -22.5, 'a body walking sideways into the shulker is stopped at its wall');
  s.shulkerOpen = 0; s.removed = true;
  const b = { x: -20.5, y: 8, z: -20.5, width: 0.6, height: 1.8, vx: 0, vy: 0, vz: 0 };
  P.move(b, 0, -3, 0);
  ok(near(b.y, 5), 'a removed shulker is no longer solid');
}

// 8. the 16 dyed sheets: skinKey picks family member colour+1 (mob atlas 'shulker#1'..'shulker#16')
{
  const e = EL.spawn('shulker', 30.5, 5, 30.5);
  ok(Sh.skinKey(e) === null, 'an undyed shulker draws the base sheet (no family key)');
  Sh.setColor(e, 0);
  okAv(Sh.skinKey(e) === 'shulker#1', 'colour 0 (white) draws shulker#1');
  Sh.setColor(e, 15);
  okAv(Sh.skinKey(e) === 'shulker#16', 'colour 15 (black) draws shulker#16');
  Sh.setColor(e, 16);
  okAv(Sh.skinKey(e) === null, 'colour 16 is the undyed default');
  const src = readFileSync(join(MCLITE_ROOT, 'tools', 'extract-mob-textures.mjs'), 'utf8');
  okAv(/shulker: \[P\('shulker\/shulker\.png'\)\]\.concat\(DYES\.map/.test(src), 'the mob-texture extractor packs the 16 dyed sheets after the base');
}

// 9. #1752: knockback / any velocity never moves a shulker (getVelocity ZERO, setVelocity no-op)
{
  const kb = (type, x) => {
    const s = EL.spawn(type, x, 5, 36.5); s.shulkerFace = 0; s.shulkerPeek = 100; const x0 = s.x, z0 = s.z;
    M.Combat.knockback(s, 0.4, 1, 0); s.vx = 0.5;
    for (let i = 0; i < 20; i++) EL.tick(0.05);
    return [s, s.x - x0, s.z - z0];
  };
  const [s, dx, dz] = kb('shulker', 40.5);
  ok(near(dx, 0) && near(dz, 0) && s.vx === 0 && s.vz === 0, 'knockback + 20 ticks leaves a shulker on its block centre');
  const [, cx] = kb('cow', -40.5);
  okAv(Math.abs(cx) > 0.5, 'the same knockback does move a cow');
}
console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log('  x ' + f); process.exit(1); }
