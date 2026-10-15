// bedexplodelockstepcheck.mjs -- #7082 (G17-L219): lockstep scenario 'bedexplode': a scripted player uses a bed in a 9x9 stone arena with a cow nearby,
// in the_nether (BedBlock.onUse: !isBedWorking -> both halves removed, createExplosion(null, badRespawnPoint, null, head+0.5, 5.0F, true, DESTROY)) and in
// the overworld (control: the bed is not worked on, nothing explodes), 20 salts. Reference = .decomp Explosion.collectBlocksAndDamageEntities (16^3 surface rays,
// power*(0.7+r*0.6), 0.3 step, -(res+0.3)*0.3, -0.22500001), shuffle, createFire tail (1/3, air above an opaque full cube), getExposure, damage (s*s+s)/2*7*d+1, no
// attacker so no takeKnockback, then the explosion's own push. Per tick: blocks (destroyed + fire cells), entities (cow pos/vel), cow health, explosion tick via compareTraces.
// OWED: vanilla's Explosion.random is an unseeded `new Random()` (fire decisions are not reproducible server-side) and the engine draws them from the shared stream (FireBlock's schedule-delay draw is moved off it via Behave.rng); vanilla's affectedBlocks starts in HashSet order, the engine's in ray order; the lane substitutes NS.wrand with the salt stream on both sides; loot draws of the broken blocks are not modelled (Loot not loaded, vanilla draws them between
// the shuffle and the fire tail); the cow stands in for the player's damage path (both go through Combat.hurt); the cow is pinned 0.5 above the floor (a sample ray ending exactly on a block face is a boundary case the reference does not model) and its vy is not compared.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '07za_explosion.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07h_entities.js',
  '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14e_gamemode.js', '09b_sky.js', '14f_inventory.js',
  '14j_combat.js', '14_player.js', '14l_use.js', '07m_breed.js', '07q_effects.js', '07k_goals.js', '14m_sleep.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
const { World: W, EntityList: EL, States: S, Sleep, Explosion: Ex, Reg: R } = M;
W.init(1); M.Behave.init(W); EL.init(); M.Ai.init(); M.Use.init(W); Sleep.init(W);
M.Particle = { spawn() {} }; M.Hud = { say() {} }; M.Diff = { get: () => 'normal' };
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
Ex.init();
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const f = Math.fround, stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TICKS = 12, USE = 5, salts = Array.from({ length: 20 }, (_, i) => i);
const STONE = S.stateOf('stone'), key = (x, y, z) => x + ',' + y + ',' + z;
const bedState = (part) => { const b = R.id.red_bed; for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) if (S.propValue(s, R.PROP.part) === R.PVAL[part] && S.propValue(s, R.PROP.facing) === R.PVAL.south && S.propValue(s, R.PROP.occupied) === R.PVAL['false']) return s; };
const FOOT = bedState('foot'), HEAD = bedState('head');
const COW = [3.5, 1.5, 0.5], BED = [0, 1, 0];
const arena = (set) => { for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) { set(x, 0, z, STONE); if (Math.max(Math.abs(x), Math.abs(z)) === 4) { set(x, 1, z, STONE); set(x, 2, z, STONE); } } set(BED[0], 1, BED[2], FOOT); set(BED[0], 1, BED[2] + 1, HEAD); };
const q = (v) => Math.round(v * 1e4) / 1e4 + 0;
const hashOf = (ks) => ks.slice().sort().join(';').split('').reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
const row = (tick, cells, cow, boom) => { const ks = [...cells.entries()].filter(([k, v]) => v !== (baseCells.get(k) || 0)).map(([k, v]) => k + '=' + v);
  return { tick, blocks: [ks.length, hashOf(ks)], entities: [['cow', q(cow.x), q(cow.y), q(cow.z), q(cow.vx), 0, q(cow.vz)]], health: cow.health, explosion: boom }; };
const baseCells = new Map(); arena((x, y, z, s) => baseCells.set(key(x, y, z), s));
const RES = { [STONE]: 6.0 };
const fireAt = (x, y, z) => M.Behave.fireStateAt(x, y, z, 0);
function blocked(cx, cy, cz, tx, ty, tz, solid) {
  const dx = tx - cx, dy = ty - cy, dz = tz - cz, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) * 64);
  for (let i = 1; i < n; i++) { const k = i / n; if (solid(Math.floor(cx + dx * k), Math.floor(cy + dy * k), Math.floor(cz + dz * k))) return true; }
  return false;
}
function reference(salt, nether) {
  const cells = new Map(baseCells), r = stream(salt + 100), get = (x, y, z) => cells.get(key(x, y, z)) || 0, solid = (x, y, z) => get(x, y, z) !== 0;
  const cow = { x: COW[0], y: COW[1], z: COW[2], vx: 0, vy: 0, vz: 0, health: 10, w: 0.9, h: 1.4 }, rows = [];
  const exposure = (cx, cy, cz, e) => {
    const hw = e.w / 2, x0 = e.x - hw, x1 = e.x + hw, y0 = e.y, y1 = e.y + e.h, z0 = e.z - hw, z1 = e.z + hw;
    const sx = 1 / ((x1 - x0) * 2 + 1), sy = 1 / ((y1 - y0) * 2 + 1), sz = 1 / ((z1 - z0) * 2 + 1);
    const ox = (1 - Math.floor(1 / sx) * sx) / 2, oz = (1 - Math.floor(1 / sz) * sz) / 2; let hits = 0, tot = 0;
    for (let fx = 0; fx <= 1; fx += sx) for (let fy = 0; fy <= 1; fy += sy) for (let fz = 0; fz <= 1; fz += sz) {
      if (!blocked(cx, cy, cz, x0 + (x1 - x0) * fx + ox, y0 + (y1 - y0) * fy, z0 + (z1 - z0) * fz + oz, solid)) hits++; tot++;
    }
    return hits / tot;
  };
  const explode = () => {
    cells.set(key(BED[0], 1, BED[2]), 0); cells.set(key(BED[0], 1, BED[2] + 1), 0);
    const cx = BED[0] + 0.5, cy = 1.5, cz = BED[2] + 1.5, POW = 5.0, hit = new Map();
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (let c = 0; c < 16; c++) {
      if (a && a !== 15 && b && b !== 15 && c && c !== 15) continue;
      let dx = f(f(f(a / 15) * 2) - 1), dy = f(f(f(b / 15) * 2) - 1), dz = f(f(f(c / 15) * 2) - 1);
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= len; dy /= len; dz /= len;
      let p = f(POW * f(f(0.7) + f(f(r()) * f(0.6)))), px = cx, py = cy, pz = cz;
      while (p > 0) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz), v = get(bx, by, bz);
        if (v !== 0) p = f(p - f(f(RES[v] + f(0.3)) * f(0.3)));
        if (p > 0) hit.set(key(bx, by, bz), [bx, by, bz]);
        px += dx * f(0.3); py += dy * f(0.3); pz += dz * f(0.3);
        p = f(p - f(0.22500001));
      }
    }
    const dia = POW * 2, dx = cow.x - cx, dy = cow.y - cy, dz = cow.z - cz, dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / dia;
    if (dist <= 1) {
      const ey = cow.y + f(1.3) - cy, len = Math.sqrt(dx * dx + ey * ey + dz * dz), s = (1 - dist) * exposure(cx, cy, cz, cow);
      if (s > 0 && len > 0) { cow.health = Math.max(0, f(cow.health - Math.floor((s * s + s) / 2 * 7 * dia + 1))); cow.vx += dx / len * s; cow.vy += ey / len * s; cow.vz += dz / len * s; }
    }
    const order = [...hit.values()];
    for (let i = order.length; i > 1; i--) { const j = Math.floor(r() * i), t = order[i - 1]; order[i - 1] = order[j]; order[j] = t; }
    for (const c of order) if (get(c[0], c[1], c[2]) !== 0) cells.set(key(c[0], c[1], c[2]), 0);
    for (const c of order) if (Math.floor(r() * 3) === 0 && get(c[0], c[1], c[2]) === 0 && get(c[0], c[1] - 1, c[2]) === STONE) { cells.set(key(c[0], c[1], c[2]), fireAt(c[0], c[1], c[2])); }
  };
  for (let t = 1; t <= TICKS; t++) { cow.vx = cow.vy = cow.vz = 0; const boom = nether && t === USE; if (boom) explode(); rows.push(row(t, cells, cow, boom ? 1 : 0)); }
  return rows;
}
const realExplode = Ex.explode, real = { setBlock: W.setBlock, getBlock: W.getBlock };
function engine(salt, nether, tweak) {
  EL.list.length = 0; const r = stream(salt + 100); Math.random = r; EL.random = r; M.wrand = r;
  for (let x = -6; x <= 6; x++) for (let y = 0; y <= 4; y++) for (let z = -6; z <= 6; z++) W.setBlock(x, y, z, 0);
  arena((x, y, z, s) => W.setBlock(x, y, z, s));
  const cow = EL.spawn('cow', COW[0], COW[1], COW[2]); cow.persistent = true; cow.noAI = true;
  M.Behave.rng = () => 0.5;   // FireBlock.onBlockAdded schedule delay draw: off the explosion stream (see OWED)
  Sleep.dimension = nether ? 'nether' : 'overworld'; M.Sky.dayTime = 6000; M.Sky.weather = M.Sky.newWeather();
  const P = { x: 0.5, y: 1, z: -1.5, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, yaw: 0, sleeping: false, sleepPos: null, sleepTimer: 0, spawnPoint: null, dead: false, mode: 0 };
  let boom = 0;
  Ex.explode = function (...a) { boom++; const r2 = stream(salt + 100); Math.random = r2; EL.random = r2; M.wrand = r2; cow.vx = cow.vy = cow.vz = 0; if (tweak) tweak(a); return realExplode.apply(this, a); };
  const rows = [];
  for (let t = 1; t <= TICKS; t++) {
    cow.x = COW[0]; cow.y = COW[1]; cow.z = COW[2]; cow.onGround = true; if (t !== USE) cow.vx = cow.vy = cow.vz = 0;
    boom = 0; if (t === USE) Sleep.use(P, BED[0], 1, BED[2] + 1, W.getBlock(BED[0], 1, BED[2] + 1));
    cow.x = COW[0]; cow.z = COW[2];
    const cells = new Map(); for (let x = -6; x <= 6; x++) for (let y = 0; y <= 4; y++) for (let z = -6; z <= 6; z++) { cells.set(key(x, y, z), W.getBlock(x, y, z)); }
    rows.push(row(t, cells, cow, boom));
  }
  Ex.explode = realExplode; return rows;
}
const FIELDS = ['blocks', 'entities', 'health', 'explosion'];
const lane = (salt, nether, tweak) => { const R_ = reference(salt, nether), E = engine(salt, nether, tweak); return { R: R_, d: compareTraces(R_, E, { fields: FIELDS }) }; };
for (const nether of [true, false]) {
  const all = salts.map((salt) => ({ salt, ...lane(salt, nether) }));
  ok(all.every((r) => !r.d), (nether ? 'nether' : 'overworld') + ' lane: ' + all.filter((r) => r.d).map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3).join(' | '));
  const L = all[0].R[TICKS - 1];
  if (nether) {
    ok(all[0].R[USE - 2].explosion === 0 && all[0].R[USE - 1].explosion === 1, 'reference: explosion at the use tick');
    ok(L.blocks[0] > 2 && L.health < 10, 'reference: blocks changed ' + L.blocks[0] + ', cow health ' + L.health);
    ok(new Set(all.map((r) => r.R[TICKS - 1].blocks[1])).size > 1, 'reference: block set varies with the salt');
    ok(all.some((r) => r.R[TICKS - 1].blocks[0] > 0) && all.some((r) => lane(r.salt, true).R.length), 'reference ran');
  } else ok(L.blocks[0] === 0 && L.health === 10, 'control: nothing explodes, no block change');
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
brk(salts.some((s) => lane(s, true, (a) => { a[4] = 4.0; }).d), 'power 5.0 -> 4.0 is reported');
brk(salts.some((s) => lane(s, true, (a) => { a[9] = false; }).d), 'fire flag false is reported');
const dd = lane(0, true, (a) => { a[4] = 4.0; }).d; brk(dd && dd.tick === USE, 'power break caught at the explosion tick ' + (dd && dd.tick));
brk(salts.every((s) => !lane(s, true).d), 'unfaulted lane still passes after the faults are restored');
console.log(`bedexplodelockstepcheck: ${8 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
