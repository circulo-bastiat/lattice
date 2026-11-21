// shulkerbulletlockstepcheck.mjs -- #6619 (G17-L93): lockstep scenario 'shulkerbullet': a shulker 8 blocks from a standing zombie, in the open then behind a stone wall; 20 salts.
// Reference = .decomp ShulkerEntity.ShootBulletGoal (counter 20, -1 per tick, shoot at <= 0, next 20 + nextInt(10)*10) + ShulkerBulletEntity.tick/method_7486
// (target *= 1.025 clamped, v += (target - v) * 0.2, then pos += v; stepCount countdown + blocked/aligned replan; despawn on block) + onEntityHit (4.0 damage, Levitation I 200 ticks).
// Per tick: bullet pos + velocity + steps + direction. Both sides draw from one seeded stream in the same order.
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
const { EntityList: EL, Shulker: Sh } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 260, WALLZ = 4;
const params = (salt) => { const r = stream(salt + 1000); return { dx: Math.round((r() * 6 - 3) * 2) / 2, dy: Math.floor(r() * 5) - 2, seed: salt + 7 }; };
// vanilla Direction order D,U,N,S,W,E
const DX = [0, 0, 0, 0, -1, 1], DY = [-1, 1, 0, 0, 0, 0], DZ = [0, 0, -1, 1, 0, 0], AXIS = ['y', 'y', 'z', 'z', 'x', 'x'];
const inWall = (x, y, z, lane) => lane === 'wall' && z === WALLZ && x >= -8 && x <= 9 && y >= 70 && y <= 95;
const TH = 1.95, TW = 0.6;   // zombie box, read back from the engine below
function rayBox(o, v, b) {   // slab test, t in [0,1] or null
  let t0 = 0, t1 = 1;
  for (let a = 0; a < 3; a++) {
    if (v[a] === 0) { if (o[a] < b[a] || o[a] > b[a + 3]) return null; continue; }
    let u = (b[a] - o[a]) / v[a], w = (b[a + 3] - o[a]) / v[a]; if (u > w) [u, w] = [w, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, w); if (t0 > t1) return null;
  }
  return t0;
}
function reference(lane, p, tgt) {
  const rng = stream(p.seed), rows = [], air = (x, y, z) => !inWall(x, y, z, lane), top = (x, y, z) => inWall(x, y, z, lane);
  const tx = tgt.x, ty = tgt.y, tz = tgt.z, half = tgt.h * 0.5;
  const sx = 0.5, sy = 80, sz = 0.5;
  let counter = 20, b = null, hitInfo = null;   // `b` is the bullet plan() is steering
  const plan = (axis) => {
    const ax0 = Math.floor(tx), ay0 = Math.floor(ty + half), az0 = Math.floor(tz);
    let ax = ax0 + 0.5, ay = ay0 + half, az = az0 + 0.5, dir = null;
    const cx = ax0 + 0.5 - b.x, cy = ay0 + 0.5 - b.y, cz = az0 + 0.5 - b.z;
    if (!(cx * cx + cy * cy + cz * cz < 4)) {
      const bx = Math.floor(b.x), by = Math.floor(b.y), bz = Math.floor(b.z), c = [];
      if (axis !== 'x') { if (bx < ax0 && air(bx + 1, by, bz)) c.push(5); else if (bx > ax0 && air(bx - 1, by, bz)) c.push(4); }
      if (axis !== 'y') { if (by < ay0 && air(bx, by + 1, bz)) c.push(1); else if (by > ay0 && air(bx, by - 1, bz)) c.push(0); }
      if (axis !== 'z') { if (bz < az0 && air(bx, by, bz + 1)) c.push(3); else if (bz > az0 && air(bx, by, bz - 1)) c.push(2); }
      dir = Math.floor(rng() * 6);
      if (!c.length) { for (let n = 5; n > 0 && !air(bx + DX[dir], by + DY[dir], bz + DZ[dir]); n--) dir = Math.floor(rng() * 6); }
      else dir = c[Math.floor(rng() * c.length)];
      ax = b.x + DX[dir]; ay = b.y + DY[dir]; az = b.z + DZ[dir];
    }
    b.dir = dir;
    const dx = ax - b.x, dy = ay - b.y, dz = az - b.z, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    b.t = len === 0 ? [0, 0, 0] : [dx / len * 0.15, dy / len * 0.15, dz / len * 0.15];
    b.steps = 10 + Math.floor(rng() * 5) * 10;
  };
  const mk = () => { b = { x: Math.floor(sx) + 0.5, y: Math.floor(sy) + 0.5, z: Math.floor(sz) + 0.5, v: [0, 0, 0], t: [0, 0, 0], dir: null, steps: 0 }; plan('y'); return b; };
  const step = (b, n) => {
    b.t = b.t.map((q) => Math.max(-1, Math.min(1, q * 1.025)));
    for (let a = 0; a < 3; a++) b.v[a] += (b.t[a] - b.v[a]) * 0.2;
    const o = [b.x, b.y, b.z];
    let f = 1, wall = false;
    if (lane === 'wall') {   // block hit: the segment reaches the z=4 slab (the wall spans far beyond the bullet's x/y)
      const z1 = o[2] + b.v[2];
      if (b.v[2] > 0 && z1 >= WALLZ && o[2] < WALLZ + 1 && Math.abs(o[0] + b.v[0]) < 8 && Math.abs(o[1] - 80) < 10) { f = Math.max(0, (WALLZ - o[2]) / b.v[2]); wall = true; }
    }
    const ct = rayBox(o, b.v.map((q) => q * f), [tx - TW / 2 - 0.3, ty - 0.3, tz - TW / 2 - 0.3, tx + TW / 2 + 0.3, ty + tgt.h + 0.3, tz + TW / 2 + 0.3]);
    if (ct !== null) { b.gone = true; if (!hitInfo) hitInfo = { tick: n, kind: 'entity' }; return; }
    if (wall) { b.gone = true; if (!hitInfo) hitInfo = { tick: n, kind: 'wall' }; return; }
    b.x += b.v[0]; b.y += b.v[1]; b.z += b.v[2];
    if (b.steps > 0 && --b.steps === 0) plan(b.dir === null ? null : AXIS[b.dir]);
    if (b.dir !== null) {
      const bx = Math.floor(b.x), by = Math.floor(b.y), bz = Math.floor(b.z), d = b.dir, ax = AXIS[d];
      if (top(bx + DX[d], by + DY[d], bz + DZ[d])) plan(ax);
      else if ((ax === 'x' && bx === Math.floor(tx)) || (ax === 'z' && bz === Math.floor(tz)) || (ax === 'y' && by === Math.floor(ty))) plan(ax);
    }
  };
  const all = [];
  for (let n = 1; n <= TICKS; n++) {
    const old = all.filter((q) => !q.gone);
    for (const q of old) { b = q; step(q, n); }
    if (!all.length) counter--;   // the goal ticks after the bullets: a bullet born now is not stepped yet
    if (!all.length && counter <= 0) { counter = 20 + Math.floor(rng() * 10) * 10; all.push(mk()); }
    const cur = all.filter((q) => !q.gone)[0] || old[0];
    rows.push({ tick: n, alive: !!cur && !cur.gone, b: cur ? [cur.x, cur.y, cur.z, ...cur.v] : null, steps: cur ? cur.steps : 0, dir: cur ? cur.dir : null });
  }
  return { rows, hitInfo };
}
function engine(lane, p, setup) {
  const { tg, stone } = setup;
  M.World.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
  if (lane === 'wall') for (let x = -8; x <= 9; x++) for (let y = 70; y <= 95; y++) M.World.setBlock(x, y, WALLZ, stone);
  EL.init(); M.Player = null;
  const rng = stream(p.seed);
  const sh = EL.spawn('shulker', 0.5, 80, 0.5); sh.silent = true; sh.shulkerFace = Sh.DOWN;
  const z = EL.spawn('zombie', 0.5 + p.dx, 80 + p.dy, 8.5); z.maxHealth = z.health = 20;
  EL.random = rng;
  const goal = new Sh.ShootBulletGoal(sh, { random: rng }); sh.target = z; goal.start();
  const rows = []; let hp0 = z.health, hit = null;
  for (let n = 1; n <= TICKS; n++) {
    const old = EL.list.filter((q) => q.type === 'shulker_bullet' && !q.removed);
    for (const bl of old) { Sh.tickBullet(bl);  if (bl.removed && !hit) hit = { tick: n, dmg: hp0 - z.health, lev: z.effects && z.effects.levitation ? { d: z.effects.levitation.duration, a: z.effects.levitation.amplifier } : null }; }
    goal.tick();
    if (EL.list.some((q) => q.type === 'shulker_bullet')) sh.target = null;   // one bullet per lane: bullets collide with each other (collides() true), which this lane does not model
    const bl = EL.list.filter((q) => q.type === 'shulker_bullet' && !q.removed)[0] || old[0];
    rows.push({ tick: n, alive: !!bl && !bl.removed, b: bl ? [bl.x, bl.y, bl.z, bl.vx, bl.vy, bl.vz] : null, steps: bl ? bl.bulletSteps : 0, dir: bl ? bl.bulletDir : null });
  }
  return { rows, hit, z };
}
const norm = (rows) => rows.map((r) => ({ tick: r.tick, goals: [[0, r.alive ? 'alive' : 'none'], [1, 's' + r.steps], [2, 'd' + r.dir]], pos: r.b ? r.b.slice(0, 3) : [0, 0, 0], vel: r.b ? r.b.slice(3) : [0, 0, 0] }));
const probe = (() => { M.World.init(1); EL.init(); const z = EL.spawn('zombie', 0, 80, 0); return { h: z.height, w: z.width }; })();
const setup = { stone: M.States.stateOf('stone') };
const lane = (name, salt) => {
  const p = params(salt), tgt = { x: 0.5 + p.dx, y: 80 + p.dy, z: 8.5, h: probe.h };
  const R = reference(name, p, tgt), E = engine(name, p, { ...setup }), d = compareTraces(norm(R.rows), norm(E.rows), { fields: ['goals', 'pos', 'vel'] });
  return { R, E, d };
};
ok(probe.h === TH && probe.w === TW, 'zombie box is ' + TW + 'x' + TH + ' (got ' + probe.w + 'x' + probe.h + ')');
for (const name of ['open', 'wall']) {
  const res = salts.map((s) => ({ s, ...lane(name, s) }));
  ok(res.every((r) => !r.d), name + ' lane: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
  ok(res.every((r) => (r.R.hitInfo && r.R.hitInfo.tick) === (r.E.hit && r.E.hit.tick)), name + ' bullet ends on the same tick in every salt');
  if (name === 'open') {
    ok(res.every((r) => r.R.hitInfo && r.R.hitInfo.kind === 'entity'), 'open lane: bullet hits the target');
    ok(res.every((r) => r.E.hit && r.E.hit.dmg === 4), 'open lane: 4.0 damage');
    ok(res.every((r) => r.E.hit && r.E.hit.lev && r.E.hit.lev.d === 200 && r.E.hit.lev.a === 0), 'open lane: Levitation I for 200 ticks');
  } else {
    // the steering sees the wall (isTopSolid in front -> replan) and detours: the bullet is never swallowed by it, but its path differs from the open lane's
    ok(res.some((r) => r.R.rows.some((x, i) => x.b && lane('open', r.s).R.rows[i].b && x.b[0] !== lane('open', r.s).R.rows[i].b[0])), 'wall lane: the wall changes the flight path');
    ok(res.every((r) => !r.E.hit || r.E.hit.dmg === 0 || r.R.hitInfo.kind === 'entity'), 'wall lane: damage only on an entity hit');
  }
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const anyD = (n) => salts.some((s) => { const l = lane(n, s); return l.d || (n === 'open' && !(l.E.hit && l.E.hit.dmg === 4 && l.E.hit.lev && l.E.hit.lev.d === 200)); });
const origRe = Sh.replanBullet;
Sh.replanBullet = function (e, ax) { return origRe(e, ax === 'y' ? 'x' : 'y'); };
brk(anyD('open'), 'injected steering axis choice is reported'); Sh.replanBullet = origRe;
Sh.BULLET_LEVITATION_TICKS = 100;
brk(anyD('open'), 'levitation duration 200 -> 100 is reported'); Sh.BULLET_LEVITATION_TICKS = 200;
Sh.BULLET_HIT_DAMAGE = 3;
brk(anyD('open'), 'damage 4 -> 3 is reported'); Sh.BULLET_HIT_DAMAGE = 4;
Sh.BULLET_BLEND = 0.25;
brk(anyD('open'), 'velocity blend 0.2 -> 0.25 is reported'); Sh.BULLET_BLEND = 0.2;
ok(!anyD('open') && !anyD('wall'), 'restored constants are clean again');
console.log(`shulkerbulletlockstepcheck: ${breaks + 9} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
