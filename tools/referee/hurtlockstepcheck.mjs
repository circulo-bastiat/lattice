// hurtlockstepcheck.mjs -- #6265 (G17-L33): lockstep scenario 'hurt': melee hit, knockback, grace window and death on a cow, 20 salts.
// Reference = .decomp LivingEntity.damage (:1030-1175: timeUntilRegen > 10 docks to amount - lastDamageTaken and knocks back NOT AT ALL, else fresh: regen 20, hurtTime 10,
// takeKnockback(0.4, attacker - self) :1386-1394 = v/2 - n*0.4, vy = onGround ? min(0.4, vy/2 + 0.4) : vy), tickMovement decrements hurtTime/timeUntilRegen, and
// updatePostDeath (:568-574: deathTime++, == 20 -> remove). Hit 1.0 at tick 0, 4.0 at tick 6, kill at tick 12; the reference takes each hit's pre-velocity/position
// from the engine (physics is not under test), and everything else (health, hurtTime, regen, deathTime, removal tick) is stepped independently per tick via compareTraces.
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
const { EntityList: EL, States: S } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const HITS = { 0: 1.0, 6: 4.0, 12: 100 }, TICKS = 40;
function build(salt) {
  cells.clear(); EL.list.length = 0;
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) w.set(x, -1, z, S.stateOf('stone'));
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn('cow', 0.5, 0, 0.5); e.persistent = true;
  M.Player = { x: -1.5 - (salt % 3) * 0.5, y: 0, z: 0.5 + (salt % 4) * 0.25 };
  for (let i = 0; i < 3; i++) EL.tick();
  return e;
}
// vanilla state machine; `pre` = engine velocity/position/onGround just before the hit
function ref(st, hit, pre, P) {
  if (st.dead) return;
  if (st.regen > 10) {
    if (hit <= st.last) return;
    st.hp -= hit - st.last; st.last = hit;
  } else {
    st.last = hit; st.regen = 20; st.hp -= hit; st.hurt = 10;
    let dx = P.x - pre.x, dz = P.z - pre.z; const n = Math.sqrt(dx * dx + dz * dz);
    st.vx = pre.vx / 2 - (dx / n) * KB; st.vz = pre.vz / 2 - (dz / n) * KB;
    st.vy = pre.og ? Math.min(0.4, pre.vy / 2 + KB) : pre.vy; st.kb = true;
  }
  if (st.hp <= 0) st.dead = true;
}
let KB = 0.4;
function lane(salt) {
  const e = build(salt), st = { hp: e.health, regen: 0, last: 0, hurt: 0, death: 0, dead: false, removedAt: -1 };
  const R = [], E = [];
  for (let t = 0; t < TICKS; t++) {
    st.kb = false;
    if (HITS[t] !== undefined) {
      const pre = { x: e.x, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, og: !!e.onGround };
      ref(st, HITS[t], pre, M.Player);
      M.Combat.hurt(e, HITS[t], t, true);
      if (st.kb) { R.push(serverRow(t * 2, { Motion: [st.vx, st.vy, st.vz], Health: Math.max(0, st.hp) })); E.push(engineRow(t * 2, { vx: e.vx, vy: e.vy, vz: e.vz, health: Math.max(0, e.health) })); }
      else { R.push(serverRow(t * 2, { Motion: [pre.vx, pre.vy, pre.vz], Health: Math.max(0, st.hp) })); E.push(engineRow(t * 2, { vx: e.vx, vy: e.vy, vz: e.vz, health: Math.max(0, e.health) })); }
    }
    EL.tick();
    // reference tick: tickMovement counters, then updatePostDeath
    if (st.hurt > 0) st.hurt--; if (st.regen > 0) st.regen--;
    if (st.dead && st.removedAt < 0) { st.death++; if (st.death === 20) st.removedAt = t; }
    const gone = e.removed || !EL.list.includes(e);
    R.push(Object.assign(serverRow(t * 2 + 1, { Health: Math.max(0, st.hp), HurtTime: st.hurt }), { deathTime: st.death, removed: st.removedAt >= 0 ? 1 : 0 }));
    E.push(Object.assign(engineRow(t * 2 + 1, { health: Math.max(0, e.health), hurtTime: e.hurtTime | 0 }), { deathTime: e.deathTime | 0, removed: gone ? 1 : 0 }));
  }
  return { e, st, d: compareTraces(R, E, { fields: ['health', 'hurtTime', 'deathTime', 'removed', 'vel'] }), R, E };
}
const res = salts.map((salt) => ({ salt, ...lane(salt) }));
ok(res.every((r) => !r.d), 'hurt lane: ' + res.filter((r) => r.d).map((r) => `salt ${r.salt} ${JSON.stringify(r.d)}`).slice(0, 3));
ok(res.every((r) => r.st.removedAt === 31), 'reference removes the cow 20 ticks after the kill tick 12: ' + res[0].st.removedAt);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const ok0 = M.Combat.KNOCKBACK_BASE; M.Combat.KNOCKBACK_BASE = 0.5;
const b1 = lane(0); brk(b1.d && b1.d.tick === 0, 'knockback 0.5 instead of 0.4 reported at the hit tick (' + (b1.d && b1.d.tick) + ')'); M.Combat.KNOCKBACK_BASE = ok0;
const og = M.Combat.INVULNERABLE_TICKS; M.Combat.INVULNERABLE_TICKS = 10;
brk(!!lane(0).d, 'a shortened grace window is reported'); M.Combat.INVULNERABLE_TICKS = og;
const od = M.Combat.hurt; M.Combat.hurt = (e, a, ...r) => od(e, a === 4 ? 5 : a, ...r);
brk(!!lane(0).d, 'a wrong second-hit damage is reported'); M.Combat.hurt = od;
console.log(`hurtlockstepcheck: ${20 + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
