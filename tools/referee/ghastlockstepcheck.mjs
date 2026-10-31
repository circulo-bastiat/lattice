// ghastlockstepcheck.mjs -- #6316 (G17-L65): lockstep scenario 'ghast': a ghast 12 blocks from a standing dummy, in the open then behind a wall; 20 salts.
// Reference = .decomp GhastEntity.ShootFireballGoal.tick (:286-318: cooldown++ while canSee && dist^2 < 4096, shoot at 20 -> cooldown -40, else decay; setShooting(cooldown > 10))
// + ExplosiveProjectileEntity (power = delta/|delta| * 0.1, velocity 0; tick: pos += v, v = (v + power) * 0.95). Per tick: isCharging, fireball pos + velocity.
// The impact explosion (power 1, mobGriefing) is proven by blazeghastcheck section 5; this lane compares the charge/shoot/flight state per tick.
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
const { EntityList: EL, Ghast: Gh } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 70;
const params = (salt) => { const r = stream(salt); return { yaw: Math.PI + (r() - 0.5) * 0.6, dy: r() * 6 - 3, dx: r() * 3 - 1.5, wallAt: 5 + Math.floor(r() * 25) }; };
// the dummy stands 12 blocks south (+z) of the ghast; the wall lane blocks sight from tick wallAt on, then lifts it 15 ticks later
const seesAt = (lane, p, t) => lane === 'open' || t < p.wallAt || t >= p.wallAt + 25;
function reference(lane, p) {
  const rows = [], g = { x: 0.5, y: 80, z: 0.5, h: 4 }, tg = { x: 0.5 + p.dx, y: 80 + p.dy, z: 12.5, h: 1.8 };
  let cd = 0; const fbs = [];
  for (let t = 1; t <= TICKS; t++) {
    for (const f of fbs) { f.x += f.vx; f.y += f.vy; f.z += f.vz; f.vx = (f.vx + f.px) * 0.95; f.vy = (f.vy + f.py) * 0.95; f.vz = (f.vz + f.pz) * 0.95; }   // spawned this tick: not stepped yet
    const dx = tg.x - g.x, dy = tg.y - g.y, dz = tg.z - g.z;
    if (dx * dx + dy * dy + dz * dz < 4096 && seesAt(lane, p, t)) {
      cd++;
      if (cd === 20) {
        const lx = Math.sin(p.yaw), lz = -Math.cos(p.yaw);
        const mx = g.x + lx * 4, mz = g.z + lz * 4, my = g.y + g.h * 0.5 + 0.5;
        const fx = tg.x - mx, fy = tg.y + tg.h * 0.5 - my, fz = tg.z - mz, d = Math.sqrt(fx * fx + fy * fy + fz * fz);
        fbs.push({ x: mx, y: my, z: mz, vx: 0, vy: 0, vz: 0, px: fx / d * 0.1, py: fy / d * 0.1, pz: fz / d * 0.1 });
        cd = -40;
      }
    } else if (cd > 0) cd--;
    rows.push({ tick: t, charging: cd > 10, fb: fbs.map((f) => [f.x, f.y, f.z, f.vx, f.vy, f.vz]) });
  }
  return rows;
}
function engine(lane, p) {
  M.World.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
  EL.init(); M.Player = null;
  const g = EL.spawn('ghast', 0.5, 80, 0.5); g.yaw = p.yaw; g.silent = true; g.fireballStrength = 1;
  const tg = { type: 'dummy', x: 0.5 + p.dx, y: 80 + p.dy, z: 12.5, height: 1.8, width: 0.6 };
  const goal = new Gh.ShootFireballGoal(g); g.target = tg; goal.start();
  let t = 0; M.Ai.canSee = () => seesAt(lane, p, t);
  const rows = [];
  for (let n = 1; n <= TICKS; n++) {
    t = n;
    const old = EL.list.filter((q) => q.type === 'fireball');
    for (const f of old) Gh.tickFireball(f);
    goal.tick();
    rows.push({ tick: n, charging: !!g.shooting, fb: EL.list.filter((q) => q.type === 'fireball').map((f) => [f.x, f.y, f.z, f.vx, f.vy, f.vz]) });
  }
  return rows;
}
const norm = (rows) => rows.map((r) => ({ tick: r.tick, goals: [[0, r.charging ? 'charging' : 'idle'], [1, 'fb' + r.fb.length]], pos: r.fb[0] ? r.fb[0].slice(0, 3) : [0, 0, 0], vel: r.fb[0] ? r.fb[0].slice(3) : [0, 0, 0] }));
const lane = (name, salt) => { const p = params(salt), R = reference(name, p), E = engine(name, p); return { R, d: compareTraces(norm(R), norm(E), { fields: ['goals', 'pos', 'vel'] }) }; };
for (const name of ['open', 'wall']) {
  const res = salts.map((s) => ({ s, ...lane(name, s) }));
  ok(res.every((r) => !r.d), name + ' lane: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
  ok(res.every((r) => r.R.some((x) => x.charging)), name + ' reference charges');
  ok(res.every((r) => r.R.some((x) => x.fb.length) === (name === 'open' || res[0].R.some((x) => x.fb.length))), name + ' fires consistently');
}
ok(lane('open', 0).R.some((x) => x.fb.length), 'open lane fires a fireball');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
Gh.SHOOT_FIRE_TICKS = 21;
brk(salts.some((s) => lane('open', s).d), 'charge 20 -> 21 is reported at the shot tick'); Gh.SHOOT_FIRE_TICKS = 20;
Gh.SHOOT_RECOVER = -39;
brk(salts.some((s) => lane('open', s).d), 'recovery -40 -> -39 is reported'); Gh.SHOOT_RECOVER = -40;
Gh.MUZZLE_DIST = 3;
brk(salts.some((s) => lane('open', s).d), 'muzzle offset 3 instead of 4 is reported'); Gh.MUZZLE_DIST = 4;
console.log(`ghastlockstepcheck: ${breaks + 7} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
