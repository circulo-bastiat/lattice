// blazefirelockstepcheck.mjs -- #6603 (G17-L78): lockstep scenario 'blazefire': a blaze 10 blocks from a standing dummy, in the open then with a wall; 20 salts.
// Reference = .decomp BlazeEntity.ShootFireballGoal.tick (cooldown-- first; fireballsFired 1 -> 60, 2..4 -> 6 and one SmallFireball each, else 100 and reset;
// velocity = (dx + gauss*spread, dy, dz + gauss*spread), spread = sqrt(sqrt(dist))*0.5) + ExplosiveProjectileEntity flight + SmallFireballEntity.onEntityHit (setOnFireFor 5).
// Per tick: fireball count, burst counter (fireActive), fireball pos+velocity, dummy on fire. The Gaussian is java.util.Random's polar method on one shared stream.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07zf_bat.js', '07zq_snowgolem.js', '07zg_enderman.js', '02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js', '07zzi_ghast.js', '07zzk_shulker.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '14f_inventory.js', '07q_effects.js', '14h_brigadier.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Behave.init(M.World); M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Combat.init(); M.Explosion.init(); M.EntityRender.init(); M.Blaze.init(); M.Ghast.init();
const { EntityList: EL, Blaze: Bl } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);

const params = (salt) => { const r = stream(salt); return { dy: r() * 4 - 2, dx: r() * 3 - 1.5, wallAt: 5 + Math.floor(r() * 60) }; };
const TICKS = 200, D = 10;
const seesAt = (lane, p, t) => lane === 'open' || t < p.wallAt || t >= p.wallAt + 30;
const DUM = (p) => ({ x: 0.5 + p.dx, y: 80 + p.dy, z: 0.5 + D, h: 2.7, w: 1.4 });
const polar = (r) => { if (r.have) { r.have = false; return r.nx; } let a, b, s; do { a = 2 * r() - 1; b = 2 * r() - 1; s = a * a + b * b; } while (s >= 1 || s === 0); const m = Math.sqrt(-2 * Math.log(s) / s); r.nx = b * m; r.have = true; return a * m; };
function hitT(f, d) {   // slab test of the segment (f.x-v .. f.x) against the dummy box, ct in [0,1]
  const lo = [d.x - d.w / 2, d.y, d.z - d.w / 2], hi = [d.x + d.w / 2, d.y + d.h, d.z + d.w / 2], o = [f.x - f.vx, f.y - f.vy, f.z - f.vz], v = [f.vx, f.vy, f.vz];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (v[i] === 0) { if (o[i] < lo[i] || o[i] > hi[i]) return false; continue; }
    let a = (lo[i] - o[i]) / v[i], b = (hi[i] - o[i]) / v[i]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
  }
  return true;
}
function reference(lane, p, rnd) {
  const rows = [], d = DUM(p), bz = { x: 0.5, y: 80, z: 0.5, h: 1.8 };
  let fired = 0, cd = 0, active = false, fire = false; const fbs = [];
  for (let t = 1; t <= TICKS; t++) {
    for (const f of fbs) {   // position uses the old velocity, then v = (v + power) * 0.95
      f.x += f.vx; f.y += f.vy; f.z += f.vz;
      if (hitT(f, d)) { f.dead = true; fire = true; continue; }
      if (f.z > 26) { f.dead = true; continue; }   // a miss leaves the loaded area: both sides drop it
      f.vx = (f.vx + f.px) * 0.95; f.vy = (f.vy + f.py) * 0.95; f.vz = (f.vz + f.pz) * 0.95;
    }
    for (let i = fbs.length - 1; i >= 0; i--) if (fbs[i].dead) fbs.splice(i, 1);
    cd--;
    const dx = d.x - bz.x, dy = d.y + d.h / 2 - (bz.y + bz.h / 2), dz = d.z - bz.z, fy = d.y - bz.y, dist = dx * dx + fy * fy + dz * dz;
    if (dist < 48 * 48 && seesAt(lane, p, t) && cd <= 0) {
      fired++;
      if (fired === 1) { cd = 60; active = true; } else if (fired <= 4) cd = 6; else { cd = 100; fired = 0; active = false; }
      if (fired > 1) {
        const sp = Math.sqrt(Math.sqrt(dist)) * 0.5, vx = dx + polar(rnd) * sp, vy = dy, vz = dz + polar(rnd) * sp, l = Math.sqrt(vx * vx + vy * vy + vz * vz);
        fbs.push({ x: bz.x, y: bz.y + 0.9 + 0.5, z: bz.z, vx: 0, vy: 0, vz: 0, px: vx / l * 0.1, py: vy / l * 0.1, pz: vz / l * 0.1 });
      }
    }
    rows.push({ tick: t, fired, cd, active, fire, fb: fbs.map((f) => [f.x, f.y, f.z, f.vx, f.vy, f.vz]) });
  }
  return rows;
}
function engine(lane, p, rnd) {
  M.World.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
  EL.init(); M.Player = null;
  const b = EL.spawn('blaze', 0.5, 80, 0.5); b.silent = true;
  const d = DUM(p), tg = EL.spawn('iron_golem', d.x, d.y, d.z); tg.silent = true; tg.maxHealth = tg.health = 1000; tg.noAi = true;
  EL.random = rnd; const goal = new Bl.ShootFireballGoal(b); b.target = tg; goal.start();
  let t = 0; M.Ai.canSee = () => seesAt(lane, p, t);
  const rows = [];
  for (let n = 1; n <= TICKS; n++) {
    t = n;
    for (const f of EL.list.filter((q) => q.type === 'small_fireball' && !q.removed)) { EL.tickOne(f); if (f.z > 26) f.removed = true; }
    goal.tick();
    rows.push({ tick: n, active: !!b.fireActive, fire: (tg.remainingFireTicks | 0) > 0, fb: EL.list.filter((q) => q.type === 'small_fireball' && !q.removed).map((f) => [f.x, f.y, f.z, f.vx, f.vy, f.vz]) });
  }
  return rows;
}
const norm = (rows) => rows.map((r) => ({ tick: r.tick, goals: [[0, r.active ? 'active' : 'idle'], [1, 'fb' + r.fb.length], [2, r.fire ? 'burning' : 'cool']], pos: r.fb[0] ? r.fb[0].slice(0, 3) : [0, 0, 0], vel: r.fb[0] ? r.fb[0].slice(3) : [0, 0, 0] }));
const lane = (name, salt) => { const p = params(salt), R = reference(name, p, stream(salt + 1000)), E = engine(name, p, stream(salt + 1000)); return { R, d: compareTraces(norm(R), norm(E), { fields: ['goals', 'pos', 'vel'] }) }; };
for (const name of ['open', 'wall']) {
  const res = salts.map((s) => ({ s, ...lane(name, s) }));
  ok(res.every((r) => !r.d), name + ' lane: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
  ok(res.every((r) => r.R.some((x) => x.fb.length >= 1)), name + ' reference fires');
  if (name === 'open') ok(res.every((r) => Math.max(...r.R.map((x) => x.fb.length)) === 3 || r.R.some((x) => x.fire)), 'open: a burst of 3 flies or already hit');
  ok(res.some((r) => r.R.some((x) => x.fire)), name + ' reference sets the dummy on fire');
}
const burst = lane('open', 0).R.filter((r, i, a) => (i ? r.fired !== a[i - 1].fired : r.fired > 0)).map((r) => r.tick);
ok(JSON.stringify(burst.slice(0, 5)) === '[1,61,67,73,79]', 'burst ticks 1,61,67,73,79 (got ' + burst.slice(0, 5) + ')');
ok(lane('open', 0).R.find((x) => x.tick === 178).cd === 1 && lane('open', 0).R.find((x) => x.tick === 179).fired === 1, 'second burst opens 100 ticks after the cycle ends');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
Bl.BURST_MID_COOLDOWN = 5;
brk(salts.some((s) => lane('open', s).d), 'burst spacing 6 -> 5 is reported'); Bl.BURST_MID_COOLDOWN = 6;
Bl.BURST_END_COOLDOWN = 99;
brk(salts.some((s) => lane('open', s).d), 'cycle cooldown 100 -> 99 is reported'); Bl.BURST_END_COOLDOWN = 100;
const pg = M.U.polarGaussian; M.U.polarGaussian = (r, nd) => pg(r, nd) * 1.1;
brk(salts.some((s) => lane('open', s).d), 'spread factor +10% is reported'); M.U.polarGaussian = pg;
console.log(`blazefirelockstepcheck: ${breaks + 8} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
