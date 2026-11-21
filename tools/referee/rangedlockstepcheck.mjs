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
  '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js', '07zzi_ghast.js', '07zzk_shulker.js', '07y_equip.js', '07zk_undead.js', '02m_jrandom.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '14f_inventory.js', '07q_effects.js', '14h_brigadier.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Behave.init(M.World); M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Combat.init(); M.Explosion.init(); M.EntityRender.init();
const { EntityList: EL, Ai, Combat: Cb } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 150, DIFFS = ['easy', 'normal', 'hard'], f32 = Math.fround;
const diffOf = (salt) => DIFFS[salt % 3];
const seedOf = (salt) => 0x6294 + salt * 7919;
// independent nextGaussian (Marsaglia polar, spare cached) over a java.util.Random
const mkGauss = (r) => { let have = false, spare = 0; return () => { if (have) { have = false; return spare; } let v1, v2, s; do { v1 = 2 * r.nextDouble() - 1; v2 = 2 * r.nextDouble() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0); const m = Math.sqrt(-2 * Math.log(s) / s); spare = v2 * m; have = true; return v1 * m; }; };
const params = (salt) => { const r = new M.JRandom(salt + 1); return { dx: r.nextDouble() * 2 - 1, dy: r.nextDouble() * 2 - 1 }; };
const EYE = 1.74, SX = 0.5, SY = 80, SZ = 0.5;
function reference(salt, p) {
  const diffId = DIFFS.indexOf(diffOf(salt)) + 1, interval = diffId === 3 ? 20 : 40;
  const rnd = new M.JRandom(seedOf(salt)), g = mkGauss(rnd);
  const tg = { x: SX + p.dx, y: SY + p.dy, z: SZ + 12, h: 1.8 };
  const rows = [], arrows = [], shots = [];
  let seeing = 0, combat = -1, cooldown = -1, using = false, use = 0, left = false, back = false;
  for (let t = 1; t <= TICKS; t++) {
    for (const a of arrows) { a.x += a.vx; a.y += a.vy; a.z += a.vz; a.vx *= f32(0.99); a.vy *= f32(0.99); a.vz *= f32(0.99); a.vy -= f32(0.05); }
    if (using) use++;
    // always seen: the ticker counts 1, 2, 3 ... from the first tick
    seeing = t;
    const dSq = (tg.x - SX) ** 2 + (tg.y - SY) ** 2 + (tg.z - SZ) ** 2;
    let strafe = null;
    if (dSq <= 225 && seeing >= 20) combat++; else combat = -1;
    if (combat >= 20) { if (rnd.nextFloat() < 0.3) left = !left; if (rnd.nextFloat() < 0.3) back = !back; combat = 0; }
    if (combat > -1) { if (dSq > 225 * f32(0.75)) back = false; else if (dSq < 225 * f32(0.25)) back = true; strafe = [back ? -0.5 : 0.5, left ? 0.5 : -0.5]; }
    let shot = 0;
    if (using) { if (use >= 20) {
      using = false; use = 0; shot = 1; cooldown = interval;
      const dmg = f32(1 * 2) + g() * 0.25 + f32(diffId * f32(0.11));
      const ax = SX, ay = SY + EYE - f32(0.1), az = SZ;
      const dx = tg.x - SX, dz = tg.z - SZ, dy = tg.y + 1.8 * 0.3333333333333333 - ay, dh = Math.sqrt(dx * dx + dz * dz);
      let vx = dx, vy = dy + dh * f32(0.2), vz = dz; const l = Math.sqrt(vx * vx + vy * vy + vz * vz); vx /= l; vy /= l; vz /= l;
      const sc = f32(0.0075) * (14 - diffId * 4);
      vx = (vx + g() * sc) * f32(1.6); vy = (vy + g() * sc) * f32(1.6); vz = (vz + g() * sc) * f32(1.6);
      rnd.nextFloat();   // the shoot sound's pitch
      const sp = f32(Math.sqrt(vx * vx + vy * vy + vz * vz)), hit = Math.ceil(sp * dmg);
      const a = { x: ax, y: ay, z: az, vx, vy, vz, dmg, hit }; arrows.push(a); shots.push(a);
    } } else if (--cooldown <= 0) { using = true; use = 0; }
    rows.push({ tick: t, shot, strafe, arrows: arrows.map((a) => [a.x, a.y, a.z, a.vx, a.vy, a.vz]) });
  }
  return { rows, shots };
}
function engine(salt, p) {
  M.World.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
  EL.init(); M.Player = null; M.Diff.set(diffOf(salt));
  const e = EL.spawn('skeleton', SX, SY, SZ); e.silent = true; e.random = new M.JRandom(seedOf(salt));
  const tg = { type: 'dummy', x: SX + p.dx, y: SY + p.dy, z: SZ + 12, height: 1.8, width: 0.6 };
  const interval = diffOf(salt) === 'hard' ? 20 : 40;
  let strafe = null; const realStrafe = Ai.strafeTo; Ai.strafeTo = (m, f, s) => { strafe = [f, s]; };
  const goal = new Ai.BowAttackGoal(e, 1.0, (m, t, pull) => Cb.mobShoot(m, t, pull), undefined, () => true);
  e.target = tg; goal.start();
  const rows = [], shots = [];
  for (let n = 1; n <= TICKS; n++) {
    for (const a of EL.list.filter((q) => q.type === 'arrow')) Cb.tickArrow(a);
    const before = EL.list.filter((q) => q.type === 'arrow').length; strafe = null;
    goal.tick();
    const arrows = EL.list.filter((q) => q.type === 'arrow');
    for (const a of arrows.slice(before)) shots.push({ dmg: a.arrowDamage, hit: Cb.arrowHitDamage(a) });
    rows.push({ tick: n, shot: arrows.length - before, strafe, arrows: arrows.map((a) => [a.x, a.y, a.z, a.vx, a.vy, a.vz]) });
  }
  Ai.strafeTo = realStrafe;
  return { rows, shots };
}
const norm = (rows) => rows.map((r) => ({ tick: r.tick, goals: [[0, 'shot' + r.shot], [1, 'n' + r.arrows.length], [2, r.strafe ? r.strafe.join('/') : 'none']],
  pos: r.arrows.length ? r.arrows[r.arrows.length - 1].slice(0, 3) : [0, 0, 0], vel: r.arrows.length ? r.arrows[r.arrows.length - 1].slice(3) : [0, 0, 0] }));
const run = (salt) => {
  const p = params(salt), R = reference(salt, p), E = engine(salt, p);
  let d = compareTraces(norm(R.rows), norm(E.rows), { fields: ['goals', 'pos', 'vel'] });
  const armored = (h) => M.Survival.afterArmor(h, 20, 8);
  if (!d) for (let i = 0; i < Math.max(R.shots.length, E.shots.length); i++) {
    const a = R.shots[i], b = E.shots[i];
    if (!a || !b || Math.abs(a.dmg - b.dmg) > 1e-9 || a.hit !== b.hit || Math.abs(armored(a.hit) - armored(b.hit)) > 1e-9) { d = { tick: -1, field: 'damage', a: a && a.hit + '/' + a.dmg, b: b && b.hit + '/' + b.dmg }; break; }
  }
  return { R, d };
};
const res = salts.map((s) => ({ s, ...run(s) }));
ok(res.every((r) => !r.d), 'zero divergences: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
ok(res.every((r) => r.R.shots.length >= 2), 'every salt fires at least two volleys');
ok(res.every((r) => r.R.rows.filter((x) => x.shot)[0].tick === 21), 'first shot at tick 21 (1 + 20 draw)');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
Cb.ARROW_SPREAD_BASE = 13;
brk(run(0).d && run(0).d.tick === 21, 'spread 14 -> 13 is caught at the first shot');
Cb.ARROW_SPREAD_BASE = 14;
Ai.BOW_DRAW_TICKS = 21;
brk(salts.some((s) => run(s).d), 'draw 20 -> 21 is reported'); Ai.BOW_DRAW_TICKS = 20;
const fl = Cb.ARROW_ARC; Cb.ARROW_ARC = f32(0.25);
brk(salts.some((s) => run(s).d), 'arc 0.2 -> 0.25 is reported'); Cb.ARROW_ARC = fl;
console.log(`rangedlockstepcheck: ${breaks + 3} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
