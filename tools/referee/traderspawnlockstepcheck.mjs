// traderspawnlockstepcheck.mjs -- #7909 (G18f-L8): lockstep scenario 'traderspawn': 20 salts x 8 in-game days (192000 ticks) of WT.tickManager vs an independent WanderingTraderManager.spawn/trySpawn/getNearbySpawnPos/spawnLlama reference (.decomp). Per tick: spawnTimer (1200 reset), spawnDelay (24000, -1200 per timer), spawnChance (25, +25 per roll, cap 75, reset 25 on a spawn), the nextInt(100) roll, the nextInt(10) gate, the 48-block search (10 tries, bell centre when one exists), the 2x3x2 suffocation rule, two leashed llamas within 4, despawnDelay 48000 and wanderTarget. Same rand stream feeds both sides, so any draw-order drift diverges.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07q_effects.js', '07k_goals.js', '07l_spawn.js', '07zt_wtrader.js'], dom: false, initReg: true });
const WT = M.WT || M.WanderingTrader;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const DAYS = 8, TICKS = DAYS * 24000;
// the world: terrain height and spawnability / collision are pure functions of the column
const hgt = (x, z) => 60 + ((x * 7 + z * 13) & 7);
const spawnable = (x, y, z) => ((x * 31 + z * 17) & 3) !== 0;
const solid = (x, y, z) => ((x * 5 + y * 3 + z * 11) % 23) === 0;
function reference(salt, step) {
  const rnd = stream(salt), st = { timer: 1200, delay: 24000, chance: 25 }, log = [], spawns = [];
  const nextInt = (n) => Math.floor(rnd() * n);
  const near = (ox, oz, r) => { for (let i = 0; i < 10; i++) { const x = ox + nextInt(r * 2) - r, z = oz + nextInt(r * 2) - r, y = hgt(x, z); if (spawnable(x, y, z)) return { x, y, z }; } return null; };
  for (let t = 0; t < TICKS; t++) {
    if (--st.timer > 0) continue;
    st.timer = 1200; st.delay -= 1200;
    if (st.delay > 0) { log.push([t, st.timer, st.delay, st.chance, 0]); continue; }
    st.delay = 24000;
    const prev = st.chance; st.chance = Math.min(Math.max(st.chance + step, 25), 75);
    let res = 0;
    if (!(nextInt(100) > prev)) {
      if (nextInt(10) === 0) {
        nextInt(1);   // getRandomAlivePlayer, one player
        const p = near(0, 0, 48);
        let clear = !!p;
        if (p) for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 2; dy++) for (let dz = 0; dz <= 1; dz++) if (solid(p.x + dx, p.y + dy, p.z + dz)) clear = false;
        if (clear) {
          const l = [];
          for (let k = 0; k < 2; k++) { const q = near(p.x, p.z, 4); if (q) l.push(q); }
          spawns.push({ t, p, l }); st.chance = 25; res = 1;
        }
      }
    }
    log.push([t, st.timer, st.delay, st.chance, res]);
  }
  return { log, spawns };
}
function engine(salt) {
  const rnd = stream(salt); WT.resetManager();
  const log = [], spawns = [];
  const ctx = {
    rand: rnd, players: () => [{ x: 0, y: 64, z: 0 }], heightAt: hgt, isSpawnable: (ty, x, y, z) => spawnable(x, y, z),
    collisionEmpty: (x, y, z) => !solid(x, y, z),
    spawnFn: (ty, x, y, z) => { const e = { type: ty, x, y, z }; spawns.push(e); return e; },
  };
  for (let t = 0; t < TICKS; t++) {
    const before = spawns.length, M0 = WT.Manager, tm = M0.spawnTimer;
    const r = WT.tickManager(ctx);
    if (tm === 1) log.push([t, M0.spawnTimer, M0.spawnDelay, M0.spawnChance, r]);
  }
  return { log, spawns };
}
function compare(salt, refStep) {
  const a = engine(salt), b = reference(salt, refStep);
  const la = JSON.stringify(a.log), lb = JSON.stringify(b.log);
  if (la !== lb) return 'log differs';
  const tr = a.spawns.filter((e) => e.type === 'wandering_trader'), ll = a.spawns.filter((e) => e.type === 'trader_llama');
  if (tr.length !== b.spawns.length) return 'trader count ' + tr.length + ' vs ' + b.spawns.length;
  if (ll.length !== b.spawns.reduce((n, s) => n + s.l.length, 0)) return 'llama count';
  for (let i = 0; i < tr.length; i++) {
    const s = b.spawns[i], e = tr[i];
    if (e.x !== s.p.x + 0.5 || e.y !== s.p.y || e.z !== s.p.z + 0.5) return 'trader pos';
    if (e.despawnDelay !== 48000) return 'despawnDelay ' + e.despawnDelay;
  }
  let li = 0;
  for (const s of b.spawns) for (const q of s.l) { const e = ll[li++]; if (e.x !== q.x + 0.5 || e.y !== q.y || e.z !== q.z + 0.5) return 'llama pos'; if (!e.leashHolder) return 'llama not leashed'; }
  return null;
}
let total = 0;
for (let salt = 0; salt < 20; salt++) { const d = compare(salt, 25); ok(!d, 'salt ' + salt + ': ' + d); if (engine(salt).spawns.length) total++; }
console.log('  20 salts x ' + DAYS + ' days; salts with a trader: ' + total);
ok(total > 3, 'scenario exercises spawns');
// despawn countdown
{ const e = { type: 'wandering_trader', despawnDelay: 48000 }; let n = 0; while (!e.removed && n < 50000) { WT.tickEntity(e); n++; } ok(n === 48000, 'despawn after 48000 ticks, got ' + n); }
// anti-vacuity: the reference with a different chance step must diverge
for (const step of [24, 26]) { let caught = 0; for (let s = 0; s < 20; s++) if (compare(s, step)) caught++; brk(caught > 0, 'chance step ' + step + ' diverges on ' + caught + '/20 salts'); }
{ const old = WT.SPAWN_CHANCE_STEP; WT.SPAWN_CHANCE_STEP = 20; let c = 0; for (let s = 0; s < 20; s++) if (compare(s, 25)) c++; WT.SPAWN_CHANCE_STEP = old; brk(c > 0, 'engine step 20 diverges'); }
console.log(`traderspawnlockstepcheck: ${23 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
