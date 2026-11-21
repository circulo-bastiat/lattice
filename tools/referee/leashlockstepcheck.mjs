// leashlockstepcheck.mjs -- #6289 (G17-L41): lockstep scenario 'leash': a cow leashed to a scripted player / a fence knot, the holder walks away; 20 salts.
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
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
const { EntityList: EL, Items: IT, Equip: Eq, States: S, Effects: ES, Undead: U } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 80;
const f = Math.fround;
const dist3 = (dx, dy, dz) => { dx = f(dx); dy = f(dy); dz = f(dz); return f(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)))); };   // Entity.distanceTo: (float) diffs, float maths
const sgn = (d) => Math.sign(d) || 0;
const params = (salt) => { const r = stream(salt); return { sp: 0.1 + r() * 0.25, dy: r() * 0.4 - 0.2, dz: r() * 2 - 1, x0: r() * 2 }; };
// holder script: player walks +x from the cow; knot lane: the cow is dragged away from a fixed knot
const cowAt = (lane, p, t) => (lane === 'knot' ? [0.5 + p.sp * t, 0, 0.5] : [0.5, 0, 0.5]);
const holderAt = (lane, p, t) => (lane === 'knot' ? [0.5 + p.dz * 0.01, 0.375, 0.5] : [0.5 + p.x0 + p.sp * t, p.dy, 0.5 + p.dz]);
function reference(lane, p, ticks) {
  let held = true, drops = 0, v = [0, 0, 0]; const rows = [];
  for (let t = 1; t <= ticks; t++) {
    v = [0, 0, 0];
    if (held) {
      const c = cowAt(lane, p, t), h = holderAt(lane, p, t);
      const dx = h[0] - c[0], dy = h[1] - c[1], dz = h[2] - c[2], d = dist3(dx, dy, dz);
      if (d > 10) { held = false; drops++; }
      else if (d > 6) { const a = dx / d, b = dy / d, g = dz / d; v = [sgn(a) * (a * a * 0.4), sgn(b) * (b * b * 0.4), sgn(g) * (g * g * 0.4)]; }
    }
    rows.push({ tick: t, vel: v, leash: held, drops });
  }
  return rows;
}
function engine(salt, lane, p, ticks) {
  cells.clear(); EL.list.length = 0; M.Tame.knots.length = 0;
  const r = stream(salt + 100); EL.random = r; Math.random = r;
  const e = EL.spawn('cow', 0.5, 0, 0.5); e.persistent = true;
  const knot = M.Tame.getOrCreateKnot(0, 0, 0); knot.x = holderAt('knot', p, 0)[0]; knot.y = 0.375; knot.z = 0.5;
  if (lane === 'knot') { knot.x = holderAt(lane, p, 1)[0]; M.Tame.leashToHolder(e, { kind: 'knot', knot }); } else M.Tame.leashToPlayer(e);
  const rows = [];
  for (let t = 1; t <= ticks; t++) {
    const c = cowAt(lane, p, t), h = holderAt(lane, p, t);
    e.x = c[0]; e.y = c[1]; e.z = c[2]; e.vx = e.vy = e.vz = 0;
    if (lane === 'player') { M.Player.x = h[0]; M.Player.y = h[1]; M.Player.z = h[2]; }
    M.Tame.tickLeash();
    // dist <= 6: vanilla walks the pathfinder (startMovingTo); the engine nudges velocity instead (Tame.updateLeash header, Ai.OWED) - not compared
    const near = dist3(h[0] - c[0], h[1] - c[1], h[2] - c[2]) <= 6;
    rows.push({ tick: t, vel: near ? [0, 0, 0] : [e.vx, e.vy, e.vz], leash: !!e.leashHolder, drops: EL.list.filter((q) => q.type === 'item').length });
  }
  return rows;
}
const FL = { fields: ['vel'] };
const norm = (rows) => rows.map((r) => ({ tick: r.tick, vel: r.vel, goals: [[0, r.leash ? 'leashed' : 'free'], [1, 'drops' + r.drops]] }));
function lane(salt, name, ticks = TICKS) {
  const p = params(salt), R = reference(name, p, ticks), E = engine(salt, name, p, ticks);
  let d = compareTraces(norm(R), norm(E), { fields: ['vel', 'goals'] });
  return { d, R, E };
}
const report = (res) => res.map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3);
const all = {};
for (const name of ['player', 'knot']) {
  all[name] = salts.map((salt) => ({ salt, ...lane(salt, name) }));
  ok(all[name].every((r) => !r.d), name + ' lane: ' + report(all[name].filter((r) => r.d)));
  const R = all[name].map((x) => x.R).find((q) => q.some((r) => !r.leash));
  ok(!!R, name + ' some salt snaps');
  if (!R) continue;
  ok(R.some((r) => r.vel[0] !== 0) && R.some((r) => !r.leash) && R[0].leash, name + ' reference pulls, then snaps: ' + JSON.stringify(R.filter((r) => r.vel[0] !== 0).length));
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const T = M.Tame;
T.LEASH_PULL_DIST = 7;
brk(salts.some((s) => lane(s, 'player').d), 'pull threshold 7 instead of 6 is reported'); T.LEASH_PULL_DIST = 6;
T.LEASH_BREAK_DIST = 11;
brk(salts.some((s) => lane(s, 'player').d), 'break distance 11 instead of 10 is reported'); T.LEASH_BREAK_DIST = 10;
T.LEASH_PULL_ACCEL = 0.5;
brk(!!lane(0, 'knot').d, 'pull acceleration 0.5 instead of 0.4 is reported'); T.LEASH_PULL_ACCEL = 0.4;
const ou = T.unleash; T.unleash = (e) => ou(e, false);
brk(salts.some((s) => lane(s, 'player').d), 'no lead dropped on snap is reported'); T.unleash = ou;
console.log(`leashlockstepcheck: ${40 + 2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
