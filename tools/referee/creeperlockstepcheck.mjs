// creeperlockstepcheck.mjs -- #6292 (G17-L44): lockstep scenario 'explode': an ignited creeper (fuse 30) beside a stone/dirt/glass patch and a cow, 20 salts.
// Reference = .decomp CreeperEntity.tick (currentFuseTime += 1, explode at >= fuseTime 30) / explode() (createExplosion at the FEET, power 3 * 1, DestructionType.DESTROY),
// Explosion.collectBlocksAndDamageEntities (16^3 surface rays, power*(0.7+r*0.6), 0.3 step, -(res+0.3)*0.3, -0.22500001), getExposure, damage (s*s+s)/2*7*d+1, knockback from
// getEyeY (cow 1.3F). Per tick: swell counter, the cow (pos, vel, health) and the destroyed-block set through lockstep/trace.mjs compareTraces.
// OWED: world.random is a JRandom whose nextDouble feeds the ray power (vanilla nextFloat): the lane substitutes NS.wrand with the salt stream on both sides; the cow's vy is not compared (the engine's pinned cow is not onGround when the blast hurts it, so takeKnockback's ground bump differs); item drops of the broken blocks (loot draws follow the shuffle) are not modelled.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cellOf(cells, x, y, z), set: (x, y, z, s) => { cells.set(key(x, y, z), s); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Particle.spawn = () => {}; M.Explosion.init(); M.Tnt.init(); if (M.Creeper && M.Creeper.init) M.Creeper.init(); M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
const { EntityList: EL, Items: IT, Equip: Eq, States: S, Effects: ES, Undead: U } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

const TICKS = 40, f = Math.fround;
const salts = Array.from({ length: 20 }, (_, i) => i);
const STONE = S.stateOf('stone'), DIRT = S.stateOf('dirt'), GLASS = S.stateOf('glass');
const RES = { [DIRT]: 0.5, [STONE]: 6.0, [GLASS]: Math.fround(0.3) };
const base = (x, y, z) => (y <= 0 && Math.abs(x) < 40 && Math.abs(z) < 30 ? (y === 0 && x >= -10 && x < 10 ? DIRT : STONE) : 0);
const CR = [0.5, 1, 0.5], COW = [5.5, 1, 0.5];
const patch = [[-1, 1, 0, STONE], [-1, 2, 0, STONE], [-2, 1, 0, STONE], [0, 1, 2, DIRT], [0, 2, 2, DIRT], [1, 1, 2, DIRT], [0, 1, -2, GLASS], [0, 2, -2, GLASS], [-1, 1, -2, GLASS]];
const cellOf = (cells, x, y, z) => { const v = cells.get(key(x, y, z)); return v === undefined ? base(x, y, z) : v; };
const mkWorld = (cells) => { cells.clear(); for (const p of patch) cells.set(key(p[0], p[1], p[2]), p[3]); };
const q = (v) => Math.round(v * 1e4) / 1e4 + 0;
const hashOf = (ks) => ks.slice().sort().join(';').split('').reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
const row = (tick, fuse, alive, cow, broken) => ({ tick, entities: [['cow', q(cow.x), q(cow.y), q(cow.z), q(cow.vx), 0, q(cow.vz)]].concat(alive ? [['creeper', CR[0], CR[1], CR[2], 0, 0, 0]] : []),
  health: cow.health, goals: [[0, 'swell' + fuse]], drops: [[broken.length, hashOf(broken)]] });
function reference(salt, ticks) {
  const cells = new Map(), r = stream(salt + 100); mkWorld(cells);
  const solid = (x, y, z) => cellOf(cells, x, y, z) !== 0;
  const cow = { x: COW[0], y: COW[1], z: COW[2], vx: 0, vy: 0, vz: 0, health: 10, w: 0.9, h: 1.4 };
  const broken = [], rows = []; let fuse = 0, alive = true;
  const exposure = (cx, cy, cz, e) => {
    const hw = e.w / 2, x0 = e.x - hw, x1 = e.x + hw, y0 = e.y, y1 = e.y + e.h, z0 = e.z - hw, z1 = e.z + hw;
    const sx = 1 / ((x1 - x0) * 2 + 1), sy = 1 / ((y1 - y0) * 2 + 1), sz = 1 / ((z1 - z0) * 2 + 1);
    const ox = (1 - Math.floor(1 / sx) * sx) / 2, oz = (1 - Math.floor(1 / sz) * sz) / 2; let hits = 0, tot = 0;
    for (let fx = 0; fx <= 1; fx += sx) for (let fy = 0; fy <= 1; fy += sy) for (let fz = 0; fz <= 1; fz += sz) {
      const tx = x0 + (x1 - x0) * fx + ox, ty = y0 + (y1 - y0) * fy, tz = z0 + (z1 - z0) * fz + oz;
      if (!blocked(cx, cy, cz, tx, ty, tz, solid)) hits++; tot++;
    }
    return hits / tot;
  };
  const explode = () => {
    const cx = CR[0], cy = CR[1], cz = CR[2], hit = new Map();
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (let c = 0; c < 16; c++) {
      if (a && a !== 15 && b && b !== 15 && c && c !== 15) continue;
      let dx = f(f(f(a / 15) * 2) - 1), dy = f(f(f(b / 15) * 2) - 1), dz = f(f(f(c / 15) * 2) - 1);
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= len; dy /= len; dz /= len;
      let p = f(3 * f(f(0.7) + f(f(r()) * f(0.6)))), px = cx, py = cy, pz = cz;
      while (p > 0) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz), v = cellOf(cells, bx, by, bz);
        if (v !== 0) p = f(p - f(f(RES[v] + f(0.3)) * f(0.3)));
        if (p > 0) hit.set(key(bx, by, bz), [bx, by, bz]);
        px += dx * f(0.3); py += dy * f(0.3); pz += dz * f(0.3);
        p = f(p - f(0.22500001));
      }
    }
    const dia = 6, dx = cow.x - cx, dy = cow.y - cy, dz = cow.z - cz, dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / dia;
    if (dist <= 1) {
      const ey = cow.y + f(1.3) - cy, len = Math.sqrt(dx * dx + ey * ey + dz * dz), s = (1 - dist) * exposure(cx, cy, cz, cow);
      if (s > 0 && len > 0) {
        cow.health = Math.max(0, f(cow.health - Math.floor((s * s + s) / 2 * 7 * dia + 1)));
        // LivingEntity.damage: attacker (the creeper) -> takeKnockback(0.4, creeper - cow): v/2 - dir*0.4, y min(0.4, vy/2+0.4) on the ground; THEN the explosion's own push
        const hl = Math.hypot(dx, dz); cow.vx = cow.vx / 2 + dx / hl * 0.4; cow.vy = Math.min(0.4, cow.vy / 2 + 0.4); cow.vz = cow.vz / 2 + dz / hl * 0.4;
        cow.vx += dx / len * s; cow.vy += ey / len * s; cow.vz += dz / len * s;
      }
    }
    for (const c of hit.values()) { const v = cellOf(cells, c[0], c[1], c[2]); if (v === 0) continue; cells.set(key(c[0], c[1], c[2]), 0); broken.push(key(c[0], c[1], c[2])); }
  };
  for (let t = 1; t <= ticks; t++) {
    cow.vx = cow.vy = cow.vz = 0;
    if (alive) { fuse++; if (fuse >= 30) { alive = false; explode(); } }
    rows.push(row(t, fuse, alive, cow, broken));
  }
  return rows;
}
function blocked(cx, cy, cz, tx, ty, tz, solid) {
  const dx = tx - cx, dy = ty - cy, dz = tz - cz, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) * 64);
  for (let i = 1; i < n; i++) { const k = i / n; if (solid(Math.floor(cx + dx * k), Math.floor(cy + dy * k), Math.floor(cz + dz * k))) return true; }
  return false;
}
const realExplode = M.Explosion.explode;
function engine(salt, ticks) {
  mkWorld(cells); EL.list.length = 0; const r = stream(salt + 100); Math.random = r; EL.random = r; M.wrand = r;
  const cow = EL.spawn('cow', COW[0], COW[1], COW[2]); cow.persistent = true; cow.noAI = true;
  const cr = EL.spawn('creeper', CR[0], CR[1], CR[2]); cr.persistent = true; cr.noAI = true; cr.noGravity = true; cr.ignited = true;
  const rows = [], broken = [];
  // OWED: ambient mob draws (the cow's tick) before the blast are not modelled; the ray stream is re-seeded at the createExplosion call
  M.Explosion.explode = function (...a) { const r2 = stream(salt + 100); Math.random = r2; EL.random = r2; M.wrand = r2; cow.x = COW[0]; cow.y = COW[1]; cow.z = COW[2]; cow.vx = cow.vy = cow.vz = 0; return realExplode.apply(this, a); };
  M.World.setBlock = (x, y, z, s) => { if (s === 0 && cellOf(cells, x, y, z) !== 0) broken.push(key(x, y, z)); cells.set(key(x, y, z), s); };
  for (let t = 1; t <= ticks; t++) {
    cow.x = COW[0]; cow.y = COW[1]; cow.z = COW[2]; cow.vx = cow.vy = cow.vz = 0; cow.onGround = true;
    if (!cr.removed && !cr.dead) { cr.x = CR[0]; cr.y = CR[1]; cr.z = CR[2]; cr.vx = cr.vy = cr.vz = 0; }
    EL.tick();
    cow.x = COW[0]; cow.y = COW[1]; cow.z = COW[2]; cow.onGround = true; if (t !== 30) cow.vx = cow.vy = cow.vz = 0;
    rows.push(row(t, cr.currentFuseTime, !cr.removed && !cr.dead, cow, broken));
  }
  return rows;
}
const tryLane = (salt) => { const R = reference(salt, TICKS), E = engine(salt, TICKS); return { R, E, d: compareTraces(R, E, { fields: ['entities', 'health', 'goals', 'drops'] }) }; };
const all = salts.map((salt) => ({ salt, ...tryLane(salt) }));
ok(all.every((r) => !r.d), 'explode lane: ' + all.filter((r) => r.d).map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3).join(' | '));
const last = all[0].R[TICKS - 1];
ok(all[0].R[28].goals[0][1] === 'swell29' && all[0].R[28].entities.length === 2, 'reference: swell 29 at tick 29, creeper alive');
ok(all[0].R[29].entities.length === 1, 'reference: blast at tick 30');
ok(last.drops[0][0] > 0, 'reference: blocks destroyed ' + last.drops[0][0]);
ok(last.health < 10 && last.health > 0, 'reference: cow hurt, health ' + last.health);
ok(new Set(all.map((r) => r.R[TICKS - 1].drops[0][1])).size > 1, 'reference: block set varies with the salt');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const Ex = M.Explosion;
Ex.RAY_STEP = 0.31; brk(salts.some((s) => tryLane(s).d && tryLane(s).d.field === 'drops'), 'ray step 0.31 instead of 0.3 gives a different block set'); Ex.RAY_STEP = 0.3;
const Cr = M.Creeper, ot = Cr.tick; Cr.tick = (e) => { ot(e); if (e.currentFuseTime === 15) e.currentFuseTime = 16; };
brk(tryLane(0).d !== null, 'swell skipping a tick is reported'); Cr.tick = ot;
Ex.POWER_MIN = 0.8; brk(salts.some((s) => tryLane(s).d), 'ray power min 0.8 is reported'); Ex.POWER_MIN = 0.7;
brk(salts.every((s) => !tryLane(s).d), 'unfaulted lane still passes after the faults are restored');
console.log(`creeperlockstepcheck: ${6 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
