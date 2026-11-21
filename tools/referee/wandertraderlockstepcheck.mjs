// wandertraderlockstepcheck.mjs -- #6854 (G17-L153): lockstep scenario 'wandertrader', 20 salts, 3 days (216000 ticks), an empty overworld with one player.
// Reference = WanderingTraderManager.spawn/trySpawn/getNearbySpawnPos/spawnLlama + WanderingTraderEntity.tickDespawnDelay (.decomp), re-written below on a java-style salted stream.
// Per tick: spawnTimer/spawnDelay/spawnChance, trader+llama spawn tick and position, llama leash link, trader despawnDelay countdown -- through trace.mjs compareTraces.
import { loadEngine } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['07zt_wtrader.js'], dom: false, initReg: true });
const WT = M.WT;
M.Ai = M.Ai || {}; M.Ai.setPositionTarget = M.Ai.setPositionTarget || (() => {});
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TICKS = 216000, P = { x: 100.5, y: 64, z: -30.5 };
const ht = (x, z) => 64 + ((x * 7 + z * 13) & 1);
const FL = { fields: ['goals', 'entities', 'drops'] };
// reference lane: vanilla constants only, no WT.* values
function ref(rand) {
  let timer = 1200, delay = 24000, chance = 25, trader = null; const rows = [];
  const near = (ox, oz, r) => { for (let i = 0; i < 10; i++) { const x = ox + Math.floor(rand() * r * 2) - r, z = oz + Math.floor(rand() * r * 2) - r; return { x, y: ht(x, z), z }; } };
  for (let t = 1; t <= TICKS; t++) {
    const ev = [];
    if (--timer <= 0) {
      timer = 1200; delay -= 1200;
      if (delay <= 0) {
        delay = 24000; const prev = chance; chance = Math.min(Math.max(chance + 25, 25), 75);
        if (!(Math.floor(rand() * 100) > prev) && Math.floor(rand() * 10) === 0) {
          rand(); const pos = near(Math.floor(P.x), Math.floor(P.z), 48);
          ev.push(['trader', pos.x + 0.5, pos.y, pos.z + 0.5]); trader = { delay: 48000, pos };
          for (let i = 0; i < 2; i++) { const lp = near(pos.x, pos.z, 4); ev.push(['llama_leashed', lp.x + 0.5, lp.y, lp.z + 0.5]); }
          chance = 25;
        }
      }
    }
    if (trader && trader.delay > 0 && --trader.delay === 0) trader = null;
    rows.push({ tick: t, goals: [[0, timer + ':' + delay + ':' + chance + ':' + (trader ? trader.delay : -1)]], entities: ev });
  }
  return rows;
}
function eng(rand) {
  WT.resetManager(); const rows = []; let trader = null;
  const ctx = { rand, players: () => [P], heightAt: ht, isSpawnable: () => true, collisionEmpty: () => true,
    spawnFn: (type, x, y, z) => { const e = { type, x, y, z }; ctx.ev.push([type === 'trader_llama' ? 'llama_leashed' : 'trader', x, y, z]); if (type === 'wandering_trader') trader = e; return e; } };
  for (let t = 1; t <= TICKS; t++) {
    ctx.ev = []; WT.tickManager(ctx);
    if (trader) { WT.tickEntity(trader); if (trader.removed) trader = null; }
    const M2 = WT.Manager;
    rows.push({ tick: t, goals: [[0, M2.spawnTimer + ':' + M2.spawnDelay + ':' + M2.spawnChance + ':' + (trader ? trader.despawnDelay : -1)]], entities: ctx.ev });
  }
  return rows;
}
const run = (n = 20) => Array.from({ length: n }, (_, salt) => ({ salt, d: compareTraces(ref(stream(salt)), eng(stream(salt)), FL), n: ref(stream(salt)).filter((r) => r.entities.length).length }));
const report = (res) => res.filter((r) => r.d).map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field}`).slice(0, 3);
const res = run();
ok(res.every((r) => !r.d), 'wandertrader lane: ' + report(res));
ok(res.some((r) => r.n > 0), 'some salt spawns a trader');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const os = WT.SPAWN_CHANCE_STEP; WT.SPAWN_CHANCE_STEP = 20;
brk(run().some((r) => r.d), 'chance step 25 -> 20 is reported'); WT.SPAWN_CHANCE_STEP = os;
const od = WT.DESPAWN_DELAY; WT.DESPAWN_DELAY = 47000;
brk(run().some((r) => r.d), 'despawn delay 48000 -> 47000 is reported'); WT.DESPAWN_DELAY = od;
console.log(`wandertraderlockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
