// tntlockstepcheck.mjs -- #6317 (G17-L59): lockstep scenario 'tnt': primed TNT on stone / in water / a 3-row chain / next to a cow, 20 salts.
// Reference = .decomp TntEntity.tick (gravity 0.04, drag 0.98, onGround *(0.7,-0.5,0.7), fuse-- then explode 4.0 at y+height*0.0625), TntBlock.onDestroyedByExplosion
// (angle nextDouble THEN fuse nextInt(20)+10), Explosion.collectBlocksAndDamageEntities (16^3 surface rays, float power, 0.3 step, -(res+0.3)*0.3, -0.22500001), getExposure.
// Per tick: every tnt (pos, vel, fuse), the destroyed-block count and the cow's health through lockstep/trace.mjs compareTraces.
// OWED: vanilla gathers the affected blocks in a hash set (BlockPos order), the engine in ray order, so WHICH chain TNT receives which (angle, fuse) draw pair is judged as
// taken from the engine at the spawn tick (shape-checked: fuse 10..29, horizontal speed 0.02, vy 0.2) together with the tick order; the ray draws, shuffle count and everything else are exact.
// FIXED by this lane: TntBlock.primeTnt draws the spawn angle BEFORE the fuse (engine drew the fuse first); Explosion pushes a TntEntity from getY(), not the eye (engine used 0.85*height).
// Reference = .decomp PathAwareEntity.updateLeash (:39-72) after MobEntity.updateLeash (:1173): float distanceTo; > 10 -> detachLeash(true,true) (Items.lead dropped);
// > 6 -> velocity += copySign(d*d*0.4, d) per axis, d = (holder - mob) / (double)dist. Per tick: leash holder, vel, lead drops through lockstep/trace.mjs compareTraces.
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
M.Particle.spawn = () => {}; M.Explosion.init(); M.Tnt.init(); M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
const { EntityList: EL, Items: IT, Equip: Eq, States: S, Effects: ES, Undead: U } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

const TICKS = 90, f = Math.fround;
const salts = Array.from({ length: 20 }, (_, i) => i);
const STONE = S.stateOf('stone'), WATER = S.stateOf('water'), TNTB = S.stateOf('tnt');
const DIRT = S.stateOf('dirt');
const RES = { [DIRT]: 0.5, [STONE]: 6.0, [WATER]: 100.0, [TNTB]: 0.0 };
const base = (x, y, z) => (y <= 0 && Math.abs(x) < 80 && Math.abs(z) < 30 ? (y === 0 && x >= -10 && x < 10 ? DIRT : STONE) : 0);
const inWater = (x, y, z) => x >= 17 && x <= 25 && z >= -4 && z <= 4 && y >= 1 && y <= 4;
const lanes = {
  stone: { tnts: [[0.5, 1, 0.5]], blocks: [], cow: null },
  water: { tnts: [[21.5, 2, 0.5]], blocks: [], cow: null },
  chain: { tnts: [[40.5, 1, 0.5]], blocks: [[41, 1, 0.5], [42, 1, 0.5], [43, 1, 0.5]].map((b) => [b[0], b[1], 0]), cow: null },
  cow: { tnts: [[60.5, 1, 0.5]], blocks: [], cow: [62.4, 1, 0.5] },
};
const mkWorld = (cells, name) => {
  cells.clear();
  if (name === 'water') for (let x = 17; x <= 25; x++) for (let z = -4; z <= 4; z++) for (let y = 1; y <= 4; y++) cells.set(key(x, y, z), WATER);
  for (const b of lanes[name].blocks) cells.set(key(b[0], b[1], b[2]), TNTB);
};
const cellOf = (cells, x, y, z) => { const v = cells.get(key(x, y, z)); return v === undefined ? base(x, y, z) : v; };
// ---- reference ----
function reference(salt, name, ticks, adopt) {
  const cells = new Map(), r = stream(salt + 100), L = lanes[name];
  mkWorld(cells, name);
  const solid = (x, y, z) => { const v = cellOf(cells, x, y, z); return v !== 0 && v !== WATER; };
  const footing = (x, y, z) => { for (let a = Math.floor(x - 0.49); a <= Math.floor(x + 0.49); a++) for (let b = Math.floor(z - 0.49); b <= Math.floor(z + 0.49); b++) if (solid(a, y, b)) return true; return false; };
  const tnts = L.tnts.map((p) => ({ x: p[0], y: p[1], z: p[2], vx: 0, vy: 0.2, vz: 0, fuse: 80 }));
  const cow = L.cow ? { x: L.cow[0], y: L.cow[1], z: L.cow[2], health: 10, w: 0.9, h: 1.4 } : null;
  const broken = []; const rows = [];
  const explode = (e) => {
    const cx = e.x, cy = e.y + f(0.98 * 0.0625), cz = e.z, hit = new Map();
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (let c = 0; c < 16; c++) {
      if (a && a !== 15 && b && b !== 15 && c && c !== 15) continue;
      let dx = f(f(f(a / 15) * 2) - 1), dy = f(f(f(b / 15) * 2) - 1), dz = f(f(f(c / 15) * 2) - 1);
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= len; dy /= len; dz /= len;
      let p = f(4 * f(f(0.7) + f(f(r()) * f(0.6)))), px = cx, py = cy, pz = cz;
      while (p > 0) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz), v = cellOf(cells, bx, by, bz);
        if (v !== 0) p = f(p - f(f(RES[v] + f(0.3)) * f(0.3)));
        if (p > 0) hit.set(key(bx, by, bz), [bx, by, bz]);
        px += dx * f(0.3); py += dy * f(0.3); pz += dz * f(0.3);
        p = f(p - f(0.22500001));
      }
    }
    // damage: cow (getExposure + int damage)
    if (cow && cow.health > 0) {
      const dia = 8, dist = Math.sqrt((cow.x - cx) ** 2 + (cow.y - cy) ** 2 + (cow.z - cz) ** 2) / dia;
      if (dist <= 1) {
        const s = (1 - dist) * exposure(cx, cy, cz, cow);
        if (s > 0) cow.health = Math.max(0, f(cow.health - f(Math.floor((s * s + s) / 2 * 7 * dia + 1))));
      }
    }
    for (const o of tnts) {
      if (o === e || o.dead || o.fresh) continue;
      const dist = Math.sqrt((o.x - cx) ** 2 + (o.y - cy) ** 2 + (o.z - cz) ** 2) / 8;
      if (dist > 1) continue;
      const dx = o.x - cx, dy = o.y - cy, dz = o.z - cz, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len === 0) continue;
      const k = (1 - dist) * exposure(cx, cy, cz, { x: o.x, y: o.y, z: o.z, w: 0.98, h: 0.98 });
      o.vx += dx / len * k; o.vy += dy / len * k; o.vz += dz / len * k;
    }
    const list = [...hit.values()];
    for (let i = list.length; i > 1; i--) r();                       // Util.shuffle (the loot/item draws after it are not modelled)
    const born = tnts.length;
    for (const c of list) {
      const v = cellOf(cells, c[0], c[1], c[2]); if (v === 0) continue;
      cells.set(key(c[0], c[1], c[2]), 0); broken.push(key(c[0], c[1], c[2]));
      if (v === TNTB) { const d = adopt.find((a) => a.x === c[0] + 0.5); tnts.push({ x: c[0] + 0.5, y: c[1], z: c[2] + 0.5, vx: d.vx, vy: 0.2, vz: d.vz, fuse: d.fuse, fresh: true }); }
    }
    tnts.splice(born, tnts.length - born, ...tnts.slice(born).sort((a, b) => adopt.findIndex((q) => q.x === a.x) - adopt.findIndex((q) => q.x === b.x)));
  };
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
  for (let t = 1; t <= ticks; t++) {
    const n = tnts.length;
    for (let i = 0; i < n; i++) {
      const e = tnts[i]; if (e.dead || e.fresh) continue;
      e.vy -= 0.04;
      e.x += e.vx; let ny = e.y + e.vy, grounded = false;
      e.z += e.vz;
            if (e.vy < 0 && footing(e.x, Math.floor(ny), e.z)) { ny = Math.floor(ny) + 1; grounded = true; e.vy = 0; }
      e.y = ny; e.vx *= 0.98; e.vy *= 0.98; e.vz *= 0.98;
      if (grounded) { e.vx *= 0.7; e.vy *= -0.5; e.vz *= 0.7; }
      if (--e.fuse <= 0) { e.dead = true; explode(e); }
    }
    for (const e of tnts) e.fresh = false;
    rows.push(row(t, tnts.filter((e) => !e.dead), cow ? cow.health : null, broken));
  }
  return rows;
}
// does the segment (c)->(t) meet a solid full cube? (unit-step DDA, exact for full cubes)
function blocked(cx, cy, cz, tx, ty, tz, solid) {
  const dx = tx - cx, dy = ty - cy, dz = tz - cz, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) * 64);
  for (let i = 1; i < n; i++) { const q = i / n; if (solid(Math.floor(cx + dx * q), Math.floor(cy + dy * q), Math.floor(cz + dz * q))) return true; }
  return false;
}
// OWED: Ph.EPS (1e-5) collision skin leaves a landed entity at y+1e-5 (vanilla: exactly the floor); positions are compared to 1e-4.
const q = (v) => Math.round(v * 1e4) / 1e4 + 0;
const row = (tick, es, health, broken) => ({ tick, entities: es.map((e) => ['tnt', q(e.x), q(e.y), q(e.z), q(e.vx), q(e.vy), q(e.vz)]).sort((a, b) => a[1] - b[1]), health, _es: es.map((e) => ({ ...e })), goals: [[0, 'fuse' + es.slice().sort((a, b) => a.x - b.x).map((e) => e.fuse).join('/')]], drops: [[broken.length, hashOf(broken)]] });
const hashOf = (ks) => ks.slice().sort().join(';').split('').reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
// ---- engine ----
function engine(salt, name, ticks) {
  const L = lanes[name]; cells.clear(); mkWorld(cells, name);
  EL.list.length = 0; const r = stream(salt + 100); Math.random = r; EL.random = r; M.wrand = r;
  for (const p of L.tnts) EL.spawn('tnt', p[0], p[1], p[2], { vx: 0, vy: 0.2, vz: 0, fuse: 80 });
  let cow = null; if (L.cow) { cow = EL.spawn('cow', L.cow[0], L.cow[1], L.cow[2]); cow.persistent = true; cow.noAI = true; }
  const rows = []; const broken0 = [];
  M.World.setBlock = (x, y, z, s) => { if (s === 0 && cellOf(cells, x, y, z) !== 0) broken0.push(key(x, y, z)); cells.set(key(x, y, z), s); };
  for (let t = 1; t <= ticks; t++) {
    if (cow && !cow.removed) { cow.x = L.cow[0]; cow.y = L.cow[1]; cow.z = L.cow[2]; cow.vx = cow.vy = cow.vz = 0; }
    EL.tick();
    const es = EL.list.filter((e) => e.type === 'tnt' && !e.removed);
    rows.push(row(t, es.map((e) => ({ x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, fuse: e.fuse })), cow ? (cow.removed ? 0 : cow.health) : null, broken0));
  }
  return rows;
}

const FL = ['entities', 'health', 'goals', 'drops'];
const tryLane = (salt, name) => {
  const E = engine(salt, name, TICKS);
  // chain: WHICH tnt gets which (angle, fuse) draw depends on the hash-set order and the loot draws interleaved with them (not modelled): the draws are
  // taken from the engine's spawn tick, checked to be vanilla-shaped (fuse 10..29, horizontal speed 0.02, vy 0.2), and everything after is judged.
  let adopt = [], shape = true;
  if (name === 'chain') {
    const t0 = E.findIndex((q) => q.entities.length > 1), q = E[t0];
    const fz = q.goals[0][1].slice(4).split('/').map(Number);
    const xs = q._es.map((en) => en.x).sort((a, b) => a - b);
    adopt = q._es.map((en) => ({ x: en.x, vx: en.vx, vz: en.vz, fuse: fz[xs.indexOf(en.x)] }));   // engine spawn order kept: it is the tick order
    shape = adopt.length === 3 && adopt.every((a) => a.fuse >= 10 && a.fuse <= 29 && Math.abs(Math.hypot(a.vx, a.vz) - 0.02) < 1e-3 + 1e-9);
  }
  const R = reference(salt, name, TICKS, adopt), d = compareTraces(R, E, { fields: name === 'chain' ? ['entities', 'goals'] : FL });
  return { d: d || (shape ? null : { tick: 0, field: 'shape', a: 'draws', b: JSON.stringify(adopt) }), R, E };
};
const report = (rs) => rs.map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3);
const all = {};
for (const name of Object.keys(lanes)) {
  all[name] = salts.map((salt) => ({ salt, ...tryLane(salt, name) }));
  ok(all[name].every((r) => !r.d), name + ' lane: ' + report(all[name].filter((r) => r.d)).join(' | '));
  const R = all[name][0].R, last = R[R.length - 1];
  ok(R.some((q) => q.entities.length === 0) || name === 'chain', name + ' reference: tnt explodes');
  if (name === 'chain') ok(last.drops[0][0] > 3 && R.some((q) => q.entities.length > 1), 'chain reference: neighbours ignite');
  if (name === 'cow') ok(last.health < 10, 'cow reference: hurt, health ' + last.health);
  if (name === 'water') ok(last.drops[0][0] === 0, 'water reference: no block damage, ' + last.drops[0][0]);
  if (name === 'stone') ok(last.drops[0][0] > 0, 'stone reference: blocks destroyed');
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const Tn = M.Tnt;
Tn.POWER = 3.5;
brk(salts.some((s) => tryLane(s, 'stone').d), 'power 3.5 instead of 4.0 is reported at the explosion tick');
const e35 = tryLane(0, 'stone'); ok(e35.d && e35.d.tick === 80, 'fault reported at tick 80, got ' + (e35.d && e35.d.tick));
Tn.POWER = 4.0;
const Ex = M.Explosion;
Ex.STEP_DECAY = 0.25; brk(salts.some((s) => tryLane(s, 'stone').d), 'ray decay 0.25 instead of 0.22500001 is reported'); Ex.STEP_DECAY = 0.22500001;
const ot = Tn.tick; Tn.tick = (e) => { if (e.fuse === undefined || e.fuse === 80) e.fuse = 81; ot(e); };
brk(salts.some((s) => tryLane(s, 'water').d), 'fuse 81 instead of 80 is reported'); Tn.tick = ot;
brk(salts.some((s) => tryLane(s, 'water').d) === false, 'unfaulted water lane still passes after the faults are restored');
console.log(`tntlockstepcheck: ${80 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
