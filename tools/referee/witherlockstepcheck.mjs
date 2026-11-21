// witherlockstepcheck.mjs -- #6673 (G17-L102): lockstep scenario 'wither': a freshly summoned wither 8 blocks from a standing dummy; 20 salts.
// Reference = .decomp WitherEntity.mobTick (invuln branch: timer-- ; explosion power 7 when it reaches 0; heal(10) on age%10==0 while invulnerable;
// else branch: heal(1) on age%20==0), onSummoned (health = max/3, timer 220), shouldRenderOverlay (health <= max/2), shootSkullAt(0) +
// ExplosiveProjectileEntity (power = delta/|delta|*0.1; tick: pos += v, v = (v + power) * drag; drag 0.95, charged 0.73).
// Per tick: health, invul timer, half-health flag, explosion (tick + power), skull positions/velocities (normal and charged).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07zf_bat.js', '07zq_snowgolem.js', '07zg_enderman.js', '02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js', '07zzi_ghast.js', '07zzk_shulker.js', '07zzm_wither.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '14f_inventory.js', '07q_effects.js', '14h_brigadier.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Behave.init(M.World); M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Combat.init(); M.Explosion.init(); M.EntityRender.init(); M.Blaze.init();
const { EntityList: EL, Wither: Wi } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const INVUL = 220, TICKS = 300, MAXHP = 300;
const params = (salt) => { const r = stream(salt); return { age0: Math.floor(r() * 40), dy: r() * 4 - 2, dx: r() * 3 - 1.5, shots: [INVUL + 5 + Math.floor(r() * 20), INVUL + 50 + Math.floor(r() * 20)], hurtAt: INVUL + 30, hurtTo: 20 + Math.floor(r() * 250) }; };
const W = { x: 0.5, y: 80, z: 0.5 };
function aimOf(p) { return { x: 0.5 + p.dx, y: 80 + p.dy + 0.9, z: 8.5 }; }   // dummy 8 blocks south, aim at half height
function reference(p) {
  const rows = [], skulls = []; let hp = MAXHP / 3, timer = INVUL, age = p.age0;
  for (let t = 1; t <= TICKS; t++) {
    age++;
    for (const k of skulls) { k.x += k.vx; k.y += k.vy; k.z += k.vz; const d = k.c ? 0.73 : 0.95; k.vx = (k.vx + k.px) * d; k.vy = (k.vy + k.py) * d; k.vz = (k.vz + k.pz) * d; }
    let boom = 0;
    if (timer > 0) {
      timer--; if (timer <= 0) boom = 7;
      if (age % 10 === 0) hp = Math.min(MAXHP, hp + 10);
    } else if (age % 20 === 0) hp = Math.min(MAXHP, hp + 1);
    if (t === p.hurtAt) hp = p.hurtTo;
    p.shots.forEach((st, i) => {
      if (t !== st) return;
      const a = aimOf(p), mx = W.x, my = W.y + 3, mz = W.z, fx = a.x - mx, fy = a.y - my, fz = a.z - mz, d = Math.sqrt(fx * fx + fy * fy + fz * fz);
      skulls.push({ x: mx, y: my, z: mz, vx: 0, vy: 0, vz: 0, px: fx / d * 0.1, py: fy / d * 0.1, pz: fz / d * 0.1, c: i === 1 });
    });
    rows.push({ tick: t, hp, timer, half: hp <= MAXHP / 2, boom, sk: skulls.map((k) => [k.x, k.y, k.z, k.vx, k.vy, k.vz, k.c ? 1 : 0]) });
  }
  return rows;
}
function engine(p) {
  M.World.init(1);
  for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
  EL.init(); M.Player = null;
  const w = EL.spawn('wither', W.x, W.y, W.z); w.silent = true; w.age = p.age0; Wi.onSummoned(w);
  let boom = 0; const ex = M.Explosion.explode;
  M.Explosion.explode = function (src, x, y, z, power) { if (src === w && power > 1) boom = power; return undefined; };
  const rows = [];
  for (let n = 1; n <= TICKS; n++) {
    boom = 0; w.age++;
    for (const k of EL.list.filter((q) => q.type === 'wither_skull')) { k.x += k.vx; k.y += k.vy; k.z += k.vz; Wi.tickSkull(k); }
    Wi.tickMovement(w);
    if (n === p.hurtAt) w.health = p.hurtTo;
    p.shots.forEach((st, i) => { if (n === st) { const a = aimOf(p); Wi.shootSkullAt(w, 0, a.x, a.y, a.z, i === 1); } });
    rows.push({ tick: n, hp: w.health, timer: Wi.getInvulnerableTimer(w), half: w.health <= (w.maxHealth || MAXHP) / 2, boom, sk: EL.list.filter((q) => q.type === 'wither_skull').map((k) => [k.x, k.y, k.z, k.vx, k.vy, k.vz, k.charged ? 1 : 0]) });
  }
  M.Explosion.explode = ex;
  return rows;
}
const norm = (rows) => rows.map((r) => ({ tick: r.tick, goals: [[0, 'hp' + r.hp], [1, 'inv' + r.timer], [2, r.half ? 'half' : 'full'], [3, 'boom' + r.boom], [4, 'sk' + r.sk.length + ':' + r.sk.map((k) => k[6]).join('')], [5, r.sk.map((k) => k.join('|')).join(';')]], pos: r.sk[0] ? r.sk[0].slice(0, 3) : [0, 0, 0], vel: r.sk[0] ? r.sk[0].slice(3, 6) : [0, 0, 0] }));
const lane = (salt) => { const p = params(salt), R = reference(p), E = engine(p); return { R, E, d: compareTraces(norm(R), norm(E), { fields: ['goals', 'pos', 'vel'] }) }; };
const all = () => salts.map((s) => ({ s, ...lane(s) }));
const res = all();
ok(res.every((r) => !r.d), 'wither lane: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
ok(res.every((r) => r.R.some((x) => x.boom === 7)), 'reference explodes at power 7');
ok(res.every((r) => r.R.find((x) => x.boom).tick === INVUL), 'explosion on tick 220');
ok(res.every((r) => r.R.some((x) => x.half) && r.R.some((x) => !x.half)) || res.some((r) => r.R.some((x) => x.half)), 'half-health flag exercised');
ok(res.every((r) => r.R[TICKS - 1].sk.length === 2), 'two skulls in flight (normal + charged)');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
Wi.DEFAULT_INVUL_TIMER = 200;
brk(salts.some((s) => lane(s).d), 'invul 220 -> 200 is reported'); Wi.DEFAULT_INVUL_TIMER = 220;
Wi.SKULL_DRAG = 0.9;
brk(salts.some((s) => lane(s).d), 'skull drag 0.95 -> 0.9 is reported'); Wi.SKULL_DRAG = 0.95;
Wi.SKULL_DRAG_CHARGED = 0.8;
brk(salts.some((s) => lane(s).d), 'charged drag 0.73 -> 0.8 is reported'); Wi.SKULL_DRAG_CHARGED = 0.73;
Wi.INVUL_EXPLOSION_POWER = 5;
brk(salts.some((s) => lane(s).d), 'explosion power 7 -> 5 is reported'); Wi.INVUL_EXPLOSION_POWER = 7;
console.log(`witherlockstepcheck: ${breaks + 5} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
