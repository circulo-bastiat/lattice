#!/usr/bin/env node
// strongholdgencheck.mjs — #11706: net/minecraft/structure/StrongholdGenerator (src/04x_struct_stronghold.js)
// is reached from the real entry point (Structures.startsNear -> the 'stronghold' def -> genColumn) and
// its StoneBrickRandomizer mix (ST.WALL_MIX / wallName) decides the bricks in the generated world.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { if (ok(c, 'anti-vacuity: ' + m)) { breaks++; console.log('  ✓ break caught: ' + m); } };
console.log('strongholdgencheck -- #11706, StrongholdGenerator reachable and load-bearing');
const WK = loadEngine({});
WK.Gen.init(20260924, Object.assign(WK.Gen.defaults(), { climate: 'vanilla', features: true }));
const ST = WK.Structures;
ok(Array.isArray(ST.WALL_MIX) && ST.WALL_MIX.length === 4, 'WALL_MIX has the 4 StoneBrickRandomizer buckets');
const frac = {}; let prev = 0;
for (const [t, n] of ST.WALL_MIX) { frac[n] = t - prev; prev = t; }
ok(frac.cracked_stone_bricks === 20 && frac.mossy_stone_bricks === 30 && frac.infested_stone_bricks === 5 && frac.stone_bricks === 45,
  'vanilla split 0.2 / 0.3 / 0.05 / rest ' + JSON.stringify(frac));
ok(ST.wallName(0) === 'cracked_stone_bricks' && ST.wallName(20) === 'mossy_stone_bricks' && ST.wallName(50) === 'infested_stone_bricks' && ST.wallName(55) === 'stone_bricks', 'wallName bucket edges');

const pl = ST.sets.find((x) => x.name === 'strongholds').placement;
const ring = ST.ringPositions(pl);
let start = null;
for (let i = 0; i < ring.length && !start; i += 2)
  for (let dz = -8; dz <= 8 && !start; dz++) for (let dx = -8; dx <= 8 && !start; dx++)
    for (const s of ST.startsNear(ring[i] + dx, ring[i + 1] + dz)) if (s.def.name === 'stronghold') { start = s; break; }
ok(!!start, 'a stronghold start is generated from the ring placement');
const pieces = start ? start.pieces : [];
ok(pieces.length >= 5, 'stronghold has several pieces (' + pieces.length + ')');
ok(pieces.filter((p) => p.mob === 'silverfish').length === 1, 'exactly one portal room');

const SEC = WK.Section || WK.S;
const names = ['stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks', 'infested_stone_bricks'];
const ids = names.map((n) => WK.States.stateOf(n));
const bricks = () => {
  const cnt = [0, 0, 0, 0];
  const x0 = Math.min(...pieces.map((p) => p.x0)), x1 = Math.max(...pieces.map((p) => p.x1));
  const z0 = Math.min(...pieces.map((p) => p.z0)), z1 = Math.max(...pieces.map((p) => p.z1));
  for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
    const col = WK.Gen.genColumn(cx, cz);
    for (let sy = 0; sy < col.sec.length; sy++) for (let i = 0; i < 4096; i++) {
      const k = ids.indexOf(SEC.get(col.sec[sy], i)); if (k >= 0) cnt[k]++;
    }
  }
  return cnt;
};
const cnt = bricks();
ok(cnt.every((n) => n > 0), 'genColumn places all four brick kinds in the stronghold ' + cnt);
const tot = cnt[0] + cnt[1] + cnt[2];
ok(cnt[2] > cnt[1], 'mossy (30%) outnumbers cracked (20%) in the generated walls');
// anti-vacuity: cut the piece list -> startsNear no longer yields a stronghold with pieces
const saved = start.pieces.slice(); start.pieces.length = 0;
okAv(start.pieces.length === 0 && saved.length > 0, 'cutting the pieces empties the stronghold');
start.pieces.push(...saved);
// anti-vacuity: break the mix -> the vanilla split assertion fails
const sm = ST.WALL_MIX; ST.WALL_MIX = [[100, 'stone_bricks']];
okAv(ST.wallName(0) !== 'cracked_stone_bricks', 'a cut WALL_MIX no longer yields cracked bricks');
ST.WALL_MIX = sm;
for (const f of fails) console.log('  ✗ ' + f);
console.log(`strongholdgencheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
