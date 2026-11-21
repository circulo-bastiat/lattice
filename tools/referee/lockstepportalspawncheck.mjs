// lockstep-portalspawn -- #7095 (G18c-L4): lockstep scenario 'portalspawn', 20 salts: NetherPortalBlock.randomTick on a 2x3 (4x5 frame) overworld portal.
// Reference = independent port of .decomp NetherPortalBlock.randomTick: isNatural && doMobSpawning && nextInt(2000) < difficulty.getId(), walk down while the block is a portal,
// spawn at pos.up() (+0.5 x/z) with reason NETHER_PORTAL if the block below allows spawning, then netherPortalCooldown = 300. Every portal block is ticked each tick; the same rnd stream feeds both.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../../src/07zzs_portal.js', import.meta.url), 'utf8');
const load = (src) => { const NS = {}; new Function('MCL', src.replace(/\}\)\(typeof MCL[^\n]*$/, '})(MCL);'))(NS); return NS.Portal; };
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 777) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
function lane(P, salt) {
  const r0 = stream(salt), diff = [1, 2, 3][salt % 3], natural = salt % 7 !== 6, rule = salt % 5 !== 4;
  const ox = Math.floor(r0() * 200 - 100), oz = Math.floor(r0() * 200 - 100), base = 64;
  const cells = []; for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) cells.push([ox + i, base + 1 + j, oz]);
  const isPortal = (x, y, z) => cells.some((c) => c[0] === x && c[1] === y && c[2] === z);
  const solid = (x, y, z) => y <= base && !isPortal(x, y, z);
  const got = [], want = [], gotAll = [];
  const ctx = { natural, doMobSpawning: rule, difficulty: diff, isPortal, allowsSpawning: solid,
    spawn: (x, y, z) => { const e = { x: x + 0.5, y, z: z + 0.5, reason: 'NETHER_PORTAL' }; got.push(e); return e; } };
  const ra = stream(salt + 1000), rb = stream(salt + 1000);
  for (let t = 1; t <= 12000; t++) for (const c of cells) {
    const n0 = got.length; const e = P.randomTick(ctx, ra, c[0], c[1], c[2]);
    // reference
    let spawned = null;
    if (natural && rule && Math.floor(rb() * 2000) < diff) {
      let y = c[1]; while (isPortal(c[0], y, c[2])) y--;
      if (solid(c[0], y, c[2])) spawned = { x: c[0] + 0.5, y: y + 1, z: c[2] + 0.5, reason: 'NETHER_PORTAL', cd: 300 };
    }
    if (spawned) want.push([t, spawned.x, spawned.y, spawned.z, spawned.reason, spawned.cd].join());
    if (got.length > n0) gotAll.push([t, e.x, e.y, e.z, e.reason, e.netherPortalCooldown].join());
    if (!!e !== !!spawned) return `tick ${t}: spawn ${!!e} vs ref ${!!spawned}`;
  }
  if (gotAll.join('|') !== want.join('|')) return `spawns ${gotAll.slice(0, 2)} vs ref ${want.slice(0, 2)}`;
  if (natural && rule && !want.length) return 'no spawn in 12000 ticks';
  if (!(natural && rule) && want.length) return 'spawned when gated';
  return null;
}
const run = (P) => { for (let s = 0; s < 20; s++) { const m = lane(P, s); if (m) return `salt ${s}: ${m}`; } return null; };
{
  const m = run(load(SRC)); ok(!m, 'portalspawn ' + m);
  const brk = (src, why) => { if (src === SRC) { fails++; console.log('  ✗ break not applied: ' + why); return; } const bad = run(load(src)); if (bad) { breaks++; console.log('   ✓ break caught: ' + why); } else { fails++; console.log('  ✗ break NOT caught: ' + why); } };
  brk(SRC.replace('rnd() * 2000', 'rnd() * 1000'), '2000 divisor -> 1000');
  brk(SRC.replace('ctx.natural && ctx.doMobSpawning &&', 'ctx.doMobSpawning &&'), 'natural gate dropped');
  brk(SRC.replace('ctx.spawn(x, y + 1, z)', 'ctx.spawn(x, y, z)'), 'spawn position y+1 -> y');
}
console.log(`lockstep-portalspawn: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
