// throwlockstepcheck.mjs -- #6314 (G17-L63): lockstep scenario 'throw': 10 snowballs then 10 eggs (one per 25 ticks) at a cow, a blaze and a wall, 20 salts.
// Reference = .decomp ThrownEntity flight (pos += v; v *= 0.99; vy -= (double)0.03F), Snowball.onHitEntity (3.0 damage only for a Blaze, else 0.0: knockback + hurtTime, no health),
// ThrownEgg.onHit (nextInt(8) == 0 hatches one chick, then nextInt(32) == 0 makes it four; every hit discards the projectile), the impact tick found by an independent
// box test on the reference flight. Per tick: projectile alive, hurtTime, health, chick count (lockstep/trace.mjs compareTraces).
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
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const GAP = 25, SHOTS = 20, TARGET_X = 8;
const G = Math.fround(0.03);
const DIM = { cow: [0.9, 1.4], blaze: [0.6, 1.8] };
// independent flight of one throw: the tick (1-based flight count) whose end position first lies in the target box or inside the wall cell
// ProjectileUtil.getEntityHitResult: the move segment against the target box grown by 0.3 (slab test, z = 0 both)
function segHitsBox(x0, y0, x1, y1, bx0, bx1, by0, by1) {
  let lo = 0, hi = 1;
  for (const [a, b, m0, m1] of [[x0, x1, bx0, bx1], [y0, y1, by0, by1]]) {
    const d = b - a;
    if (Math.abs(d) < 1e-12) { if (a < m0 || a > m1) return false; continue; }
    let t0 = (m0 - a) / d, t1 = (m1 - a) / d; if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0); hi = Math.min(hi, t1); if (lo > hi) return false;
  }
  return true;
}
function refFlight(kind, v0, vy0, M = 0.3) {
  let x = 0, y = 1, vx = v0, vy = vy0;
  for (let t = 1; t <= 60; t++) {
    const x0 = x, y0 = y;
    x += vx; y += vy; vx *= 0.99; vy = vy * 0.99 - G;
    if (kind === 'wall') { if (x >= TARGET_X) return { t, ent: false }; }
    else { const [w, h] = DIM[kind]; if (segHitsBox(x0, y0, x, y, TARGET_X - w / 2 - M, TARGET_X + w / 2 + M, -M, h + M)) return { t, ent: true }; }
    if (y < 0) return { t, ent: false };   // the floor block: any projectile that gets there lands (eggs still roll the hatch)
  }
  return { t: -1, ent: false };
}
let EGG = null;   // the egg-roll queue the engine's stream serves only while Throw.tickEgg runs
function lane(salt, kind, cfg = {}) {
  cells.clear(); EL.list.length = 0;
  for (let x = -6; x <= 40; x++) for (let z = -6; z <= 6; z++) w.set(x, -1, z, S.stateOf('stone'));
  if (kind === 'wall') for (let y = 0; y < 4; y++) for (let z = -2; z <= 2; z++) w.set(TARGET_X, y, z, S.stateOf('stone'));
  const junk = stream(salt + 1000), rolls0 = stream(salt), rolls = rolls0;
  const rollsRef = stream(salt);
  EGG = null;
  // the engine serves the egg's own two rolls (hatch, then the 1-in-32 count); a spawned chick's own initial draws (its egg-lay timer) are its own Random in vanilla, so they get the junk stream
  let served = 0, hatched = false;
  EL.random = () => {
    if (!EGG) return junk();
    served++;
    if (served === 1) { const v = rolls(); hatched = Math.floor(v * 8) === 0; return v; }
    if (served === 2 && hatched) return rolls();
    return junk();
  }; Math.random = junk;   // the particle bursts draw their own (client) stream: never the server rolls
  const origEgg = M.Throw.tickEgg;
  M.Throw.tickEgg = function (e) { EGG = true; served = 0; try { origEgg.call(this, e); } finally { EGG = null; } };
  M.Player = { x: -3, y: 0, z: 0, type: 'player' };
  let tgt = null, hp = 0;
  if (kind !== 'wall') { tgt = EL.spawn(kind, TARGET_X + 0.5 - 0.5, 0, 0); tgt.noAi = true; tgt.persistent = true; tgt.health = tgt.maxHealth = 100; hp = 100;   // ten snowballs are 30 damage: death is the hurt lane's business
 }
  const r = stream(salt + 77), plan = [];
  for (let i = 0; i < SHOTS; i++) {
    // a throw whose hit/miss flips when the 0.3 margin moves by 0.01 is a rounding coin-toss, not a vanilla fact: redraw it
    let v, vy;
    do { v = 1.2 + r() * 0.2; vy = 0.02 + r() * 0.05; } while (['cow', 'blaze'].some((k) => [0.29, 0.31].some((m) => refFlight(k, v, vy, m).t !== refFlight(k, v, vy).t)));
    plan.push({ type: i < 10 ? 'snowball' : 'egg', v, vy });
  }
  const R = [], E = [];
  let st = { hurt: 0, regen: 0, hp, chicks: 0 }, proj = null, cur = -1, hitAt = 0, hitEnt = false, ft = 0;
  // hatched chicks are tallied and cleared each tick so later eggs fly through the same empty lane
  let seen = 0;
  const countChicks = () => { for (const q of EL.list) if (q.type === 'chicken' && !q.removed) { seen++; q.removed = true; } return seen; };
  const total = SHOTS * GAP;
  for (let t = 0; t < total; t++) {
    if (t % GAP === 0) {
      cur = t / GAP; const p = plan[cur];
      proj = EL.spawn(p.type, 0, 1, 0, { vx: p.v, vy: p.vy, vz: 0, shooter: M.Player });
      ft = 0; const f = refFlight(kind, p.v, p.vy); hitAt = f.t; hitEnt = f.ent;
      if (cfg.mutate) cfg.mutate(proj);
    }
    // reference: the hit applies on the flight tick whose swept path enters the target (ThrownEntity raycasts pos -> pos+v, box grown 0.3, before moving)
    ft++;
    const hitNow = hitAt > 0 && ft === hitAt;
    if (hitNow) {
      const p = plan[cur];
      if (p.type === 'snowball' && kind === 'blaze' && hitEnt) { if (st.regen <= 10) { st.hp -= 3; st.hurt = 10; st.regen = 20; } }
      else if (p.type === 'snowball' && hitEnt && st.regen <= 10) { st.hurt = 10; st.regen = 20; }
      if (p.type === 'egg') {
        if (hitEnt && st.regen <= 10) { st.hurt = 10; st.regen = 20; }
        if (Math.floor(rollsRef() * 8) === 0) st.chicks += Math.floor(rollsRef() * 32) === 0 ? 4 : 1;
      }
    }
    if (tgt) { tgt.x = TARGET_X; tgt.y = 0; tgt.z = 0; tgt.vx = tgt.vy = tgt.vz = 0; }   // knockback motion is not under test: the target is pinned where the reference puts it
    EL.tick();
    const pe = proj && !proj.removed && EL.list.includes(proj);
    const aliveRef = hitAt > 0 ? (ft < hitAt ? 1 : 0) : (ft <= 60 ? 1 : 0);
    R.push(Object.assign(serverRow(t, { Health: Math.max(0, st.hp), HurtTime: st.hurt }), { alive: aliveRef, chicks: st.chicks }));
    E.push(Object.assign(engineRow(t, { health: tgt ? Math.max(0, tgt.health) : 0, hurtTime: tgt ? (tgt.hurtTime | 0) : 0 }), { alive: pe ? 1 : 0, chicks: countChicks() }));
    if (st.hurt > 0) st.hurt--; if (st.regen > 0) st.regen--;
  }
  M.Throw.tickEgg = origEgg;
  return { d: compareTraces(R, E, { fields: ['health', 'hurtTime', 'alive', 'chicks'] }), R, E };
}
const res = salts.flatMap((salt) => ['cow', 'blaze', 'wall'].map((kind) => ({ salt, kind, ...lane(salt, kind) })));
for (const kind of ['cow', 'blaze', 'wall']) {
  const bad = res.filter((r) => r.kind === kind && r.d);
  ok(!bad.length, `${kind}: ${bad.slice(0, 2).map((r) => `salt ${r.salt} ${JSON.stringify(r.d)}`)}`);
}
ok(res.some((r) => r.R.some((q) => q.chicks > 0)), 'some egg hatches (not vacuous)');
ok(res.some((r) => r.kind === 'blaze' && r.R.some((q) => q.health < r.R[0].health)), 'blaze takes snowball damage');
ok(res.every((r) => r.kind !== 'cow' || r.R.every((q) => q.health === r.R[0].health)), 'cow health never changes (0 damage)');
ok(res.some((r) => r.kind === 'cow' && r.R.some((q) => q.hurtTime > 0)), 'cow gets hurtTime from 0-damage hits');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const dirty = (kind) => salts.some((s) => lane(s, kind).d);
{ const o = M.Combat.hurtZero; M.Combat.hurtZero = () => false; brk(dirty('cow'), 'no knockback/hurtTime on 0-damage hit reported'); M.Combat.hurtZero = o; }
{ const o = M.Combat.hurt; M.Combat.hurt = (e, a, ...r) => o(e, a === 3 ? 4 : a, ...r); brk(dirty('blaze'), 'blaze damage 4 instead of 3 reported'); M.Combat.hurt = o; }
{ const o = M.Throw.tickEgg; M.Throw.tickEgg = function (e) { const r = M.EntityList.random; M.EntityList.random = () => { const v = r(); return v * 8 / 9; }; try { o.call(this, e); } finally { M.EntityList.random = r; } }; brk(dirty('wall'), 'chick roll 8 -> 9 reported at an egg impact'); M.Throw.tickEgg = o; }
{ const o = M.Combat.thrownSweepHits; M.Combat.thrownSweepHits = (e, t, tw, th) => Math.abs(e.x - t.x) <= tw / 2 + 0.25 && Math.abs(e.z - t.z) <= tw / 2 + 0.25 && e.y >= t.y - 0.25 && e.y <= t.y + th + 0.25; brk(dirty('cow'), 'end-point hit test (tunnelling through the swept box) reported'); M.Combat.thrownSweepHits = o; }
console.log(`throwlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
