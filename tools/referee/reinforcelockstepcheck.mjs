// lockstep-reinforce -- #6781 (G17-L136): lockstep scenario 'reinforce', 20 salts: hurt zombie on Hard with a target rolls spawn_reinforcements, 50-try 7..40 position search, -0.05 on parent AND child, RNG draw order.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07zk_undead.js'], dom: false, initReg: true });
const U = M.Undead;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const ni = (r) => (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
// Vanilla ZombieEntity.damage reinforcement block, written out independently; world rule = ok(x,y,z) predicate.
function ref(r, par, hard, target, okAt) {
  if (!target || !hard) return null;
  if (!(r() < Math.min(1, Math.max(0, par.base + par.mods)))) return null;
  const n = ni(r);
  for (let t = 0; t < 50; t++) {
    const x = par.x + n(7, 40) * n(-1, 1), y = par.y + n(7, 40) * n(-1, 1), z = par.z + n(7, 40) * n(-1, 1);
    if (okAt(x, y, z)) { par.mods -= 0.05; return { x, y, z, mods: -0.05 }; }
  }
  return null;
}
function lane(salt) {
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  const a = stream(salt + 300), b = stream(salt + 300), wr = stream(salt + 9);
  const okMap = new Map(); const okAt = (x, y, z) => { const k = x + ',' + y + ',' + z; if (!okMap.has(k)) okMap.set(k, wr() < (salt % 3 === 0 ? 0.045 : 0.15 + (salt % 4) * 0.05)); return okMap.get(k); };
  const play = { x: 0, y: 64, z: 0 };
  for (let ev = 0; ev < 8; ev++) {
    const hard = ev % 4 !== 1, hasT = ev % 4 !== 2;
    const base = 0.4 + (salt % 6) * 0.1;
    const e = { type: 'zombie', x: 10 + ev * 3.5, y: 64, z: -5, reinforceBase: base, reinforceMods: 0, target: hasT ? { maxHealth: 20 } : null };
    const par = { base, mods: 0, x: Math.floor(e.x), y: 64, z: -5 };
    play.x = par.x + 2; play.z = par.z + 1; let spawned = null;
    const ctx = { rnd: a, nextInt: ni(a), isHard: () => hard, doMobSpawning: () => true, players: () => [play],
      canPlace: okAt, clearAt: () => true,
      spawn: (t, x, y, z) => (spawned = { type: t, x, y, z, reinforceBase: 0.05, reinforceMods: 0 }) };
    const got = U.onZombieDamaged(e, null, ctx);
    const want = ref(b, par, hard, hasT, (x, y, z) => okAt(x, y, z) && !((play.x - x) ** 2 + (play.y - y) ** 2 + (play.z - z) ** 2 < 49));
    if (!!got !== !!want) { note(`ev${ev} spawned ${!!got} vs ${!!want}`); continue; }
    if (got) {
      if (got.x !== want.x || got.y !== want.y || got.z !== want.z) note(`ev${ev} pos ${got.x},${got.y},${got.z} vs ${want.x},${want.y},${want.z}`);
      if (Math.abs(got.reinforceMods - (-0.05)) > 1e-9) note(`ev${ev} child modifier ${got.reinforceMods}`);
      if (Math.abs(e.reinforceMods - par.mods) > 1e-9) note(`ev${ev} parent modifier ${e.reinforceMods} vs ${par.mods}`);
      if (got.target !== e.target) note(`ev${ev} child target`);
    }
    if (a() !== b()) note(`ev${ev} RNG draw order diverged`);
  }
  return { bad };
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r.bad, 'reinforce salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const first = () => { let h = null; for (let s = 0; s < 20 && !h; s++) h = lane(s).bad; return h; };
{ const sv = U.REINFORCE_CHARGE; U.REINFORCE_CHARGE = -0.5; const h = first(); brk(!!h, `-0.05 -> -0.5: ${h}`); U.REINFORCE_CHARGE = sv; }
{ const sv = U.REINFORCE_MIN; U.REINFORCE_MIN = 6; const h = first(); brk(!!h, `min offset 7 -> 6: ${h}`); U.REINFORCE_MIN = sv; }
{ const sv = U.REINFORCE_TRIES; U.REINFORCE_TRIES = 49; const h = first(); brk(!!h, `50 tries -> 49: ${h}`); U.REINFORCE_TRIES = sv; }
{ const sv = U.REINFORCE_PLAYER_CLEAR; U.REINFORCE_PLAYER_CLEAR = 0; const h = first(); brk(!!h, `player ring dropped: ${h}`); U.REINFORCE_PLAYER_CLEAR = sv; }
{ const sv = U.spawnReinforcementsOf; U.spawnReinforcementsOf = (e) => sv(e) * 0.5; const h = first(); brk(!!h, `attribute roll halved: ${h}`); U.spawnReinforcementsOf = sv; }
console.log(`lockstep-reinforce: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
