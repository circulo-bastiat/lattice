// splashlockstepcheck.mjs -- #6313 (G17-L62): lockstep scenario 'splash': thrown splash potions (healing, poison, slowness) at a cow and a zombie at 1, 3 and 4 blocks, 20 salts.
// Reference = .decomp ThrownPotion/PotionEntity: gravity 0.05 + drag 0.99 arc (velocity += -0.05 after the 0.99 drag, pos += v), applySplashPotion (:124-156: box inflate 4,2,4; squaredDistance < 16;
// scale 1 - sqrt(d2)/4; instant (int)(scale*{4|6}<<amp + 0.5), undead inverted; others (int)(scale*duration + 0.5) kept only if > 20) written out independently.
// Per tick (lockstep/trace.mjs compareTraces): health, effects [[id,amp,duration]]. The bottle shatters on the tick the reference arc reaches the target's x.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07y_equip.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07q_effects.js', '14j_combat.js', '07z_potion.js'], dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.World = Object.assign(M.World || {}, { get: () => 0, getBlock: () => 0, getLight: () => 0, tickingAt: () => true, setBlock: () => {} });
M.Physics.shapeAt = () => null; M.Physics.solidAt = () => false;
M.EntityList.init();
M.Diff = { get: () => 'normal' }; M.Player = null;
const { Effects: ES, Potion: Po } = M;
const ids = ES.IDS;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const TICKS = 70, salts = Array.from({ length: 20 }, (_, i) => i);
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const MAX = { zombie: 20, cow: 10 }, UNDEAD = { zombie: true, cow: false };
const POT = { healing: ['instant_health', 0, 0], poison: ['poison', 900, 0], slowness: ['slowness', 1800, 0] };
const DIST = [1, 3, 4];
const params = (salt, di) => { const r = stream(salt * 7 + di); return { d: DIST[di] - (di === 2 ? r() * 0.3 : r() * 0.2), hp0: 2 + Math.floor(r() * 7), h: 1 + Math.floor(r() * 2) }; };
const G = Math.fround(0.05);
const FLY = 40;
// reference arc: ThrownEntity.tick = pos += v, then v *= 0.99, then vy -= (double)0.05F
function arc(p) {
  let x = 0, y = p.h, vx = p.v, vy = 0, t = 0; const path = [[x, y]];
  while (y > 0 && t < FLY) { x += vx; y += vy; vx *= 0.99; vy = vy * 0.99 - G; t++; path.push([x, y]); }
  return { t, path };
}
function reference(mob, pot, p, A) {
  const [eff, dur, amp] = POT[pot], rows = [], d2 = p.d * p.d;
  let hp = p.hp0, inst = null;
  for (let t = 0; t <= TICKS; t++) {
    if (t === A.t) {
      if (d2 < 16) {
        const sc = 1 - Math.sqrt(d2) / 4;
        if (eff === 'instant_health') { const heal = (eff === 'instant_health') !== UNDEAD[mob]; const a = Math.floor(sc * (heal ? 4 << amp : 6 << amp) + 0.5); hp = heal ? Math.min(MAX[mob], hp + a) : hp - a; }
        else { const dd = Math.floor(sc * dur + 0.5); const refused = UNDEAD[mob] && eff === 'poison'; if (dd > 20 && !refused) inst = { id: ids[eff], amp, left: dd }; }
      }
    }
    if (inst) {   // LivingEntity.tickStatusEffects after the apply: poison every 25 ticks (keyed to the remaining duration) while hp > 1, then the duration counts down
      if (eff === 'poison' && inst.left % 25 === 0 && hp > 1) hp -= 1;
      inst.left--;
      if (inst.left <= 0) inst = null;
    }
    rows.push({ hp: Math.max(hp, 0), fx: inst ? [[inst.id, inst.amp, inst.left]] : [] });
  }
  return rows;
}
let TRUNC = false;   // fault: the engine side only rounds by truncation
function engine(mob, pot, p, A, fly) {
  const fl = Math.floor; if (TRUNC) Math.floor = (v) => fl(v - 0.5);
  try { return engine0(mob, pot, p, A, fly); } finally { Math.floor = fl; }
}
function engine0(mob, pot, p, A, fly) {
  const e = { type: mob, x: 0, y: 0, z: 0, height: 1.5, width: 0.6, health: p.hp0, maxHealth: MAX[mob], dead: false, equip: {}, effects: {}, noAi: true };
  const rows = [];
  for (let t = 0; t <= TICKS; t++) {
    if (t === A.t) {
      // the bottle breaks where the engine's own flight put it; the mob stands p.d away, level with it
      e.x = fly.x + p.d; e.y = fly.y; e.z = fly.z;
      Po.applySplashPotion(pot, fly.x, fly.y, fly.z, [e], null, null);
    }
    if (e.invulnerableTime > 0) e.invulnerableTime--;
    ES.tick(e);
    rows.push({ hp: Math.max(e.health, 0), fx: JSON.parse(JSON.stringify(e.effects)) });
  }
  return rows;
}
// the engine's real `potion` entity flown through EntityList.tickOne with nothing to hit (empty world)
function fly(p, ticks) {
  M.EntityList.list.length = 0;
  const b = M.EntityList.spawn('potion', 0, p.h, 0); b.potionId = 'healing'; b.vx = p.v; b.vy = 0; b.vz = 0;
  const path = [[b.x, b.y]];
  for (let t = 0; t < ticks; t++) { M.EntityList.tickOne(b); path.push([b.x, b.y]); }
  return path;
}
const F = { fields: ['health', 'effects'] };
const run = (mob, pot, di, salt) => {
  const r = stream(salt * 7 + di);
  const p = { d: DIST[di] - (di === 2 ? r() * 0.3 : r() * 0.2), hp0: 2 + Math.floor(r() * 7), h: 1 + Math.floor(r() * 2), v: 0.5 + r() * 0.2 };
  const A = arc(p), path = fly(p, A.t), last = path[A.t];
  const R = reference(mob, pot, p, A), E = engine(mob, pot, p, A, { x: last[0], y: last[1], z: 0 });
  const S = R.map((q, t) => serverRow(t, { Health: q.hp, ActiveEffects: q.fx.map((x) => ({ Id: x[0], Amplifier: x[1], Duration: x[2] })) }));
  const G = E.map((q, t) => engineRow(t, { health: q.hp, effects: q.fx }, { effectIds: ids }));
  let d = compareTraces(S, G, F);
  const arcBad = path.findIndex((q, t) => Math.abs(q[0] - A.path[t][0]) > 1e-9 || Math.abs(q[1] - A.path[t][1]) > 1e-9);
  if (!d && arcBad >= 0) d = { tick: arcBad, field: 'arc' };
  return { d, R, E, A };
};
const dirty = (mob, pot, di) => salts.some((s) => run(mob, pot, di, s).d);
let landed = 0, scaled = 0;
for (const mob of ['cow', 'zombie']) for (const pot of Object.keys(POT)) for (let di = 0; di < 3; di++) {
  const res = salts.map((s) => ({ s, r: run(mob, pot, di, s) }));
  const bad = res.filter((x) => x.r.d);
  ok(!bad.length, `${mob} ${pot} @${DIST[di]}: ${bad.slice(0, 2).map((x) => `salt ${x.s} tick ${x.r.d.tick} ${x.r.d.field}`)}`);
  if (res.some((x) => x.r.R.some((q) => q.fx.length || q.hp !== x.r.R[0].hp))) landed++;
  if (pot !== 'healing' && res.some((x) => x.r.R.some((q) => q.fx.length && q.fx[0][2] > 20 && q.fx[0][2] < (POT[pot][1] - 1) * 0.9))) scaled++;
}
ok(landed >= 12, 'splashes take effect in many lanes (not vacuous): ' + landed);
ok(scaled >= 3, 'distance-scaled durations seen: ' + scaled);
{ const e = { type: 'cow', x: 4, y: 0, z: 0, height: 1.4, width: 0.9, health: 5, maxHealth: 10, effects: {} }; Po.applySplashPotion('healing', 0, 0, 0, [e], null, null); ok(e.health === 5, 'exactly 4 blocks: untouched (distSq < 16 is strict)'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
TRUNC = true; brk(dirty('cow', 'slowness', 0), 'rounding 0.5 -> truncation reported'); TRUNC = false;
{ const o = ES.addStatusEffect; ES.addStatusEffect = (e, id, dur, ...r) => o(e, id, dur + 1, ...r); brk(dirty('cow', 'slowness', 1), 'duration off by one reported'); ES.addStatusEffect = o; }
{ const o = ES.isUndead; ES.isUndead = () => false; brk(dirty('zombie', 'healing', 0), 'undead healing not inverted reported'); ES.isUndead = o; }
console.log(`splashlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
