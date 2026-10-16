// spawnlockstepcheck.mjs -- #6298 (G17-L50): lockstep scenario 'spawn': a sealed dark 64x64 stone room, a fixed player, 2400 ticks of the
// NaturalSpawner cycle (ServerChunkManager.tickChunks -> SpawnHelper.spawn -> spawnEntitiesInChunk), seeded java.util.Random, 20 salts.
// Compared per spawned mob: (type, tick, x, y, z, group size, equipment). The oracle is an independent transcription of
// SpawnHelper.spawn/spawnEntitiesInChunk/Info.isBelowCap (.decomp) -- shuffle, cap 70*chunks/289, 3 tries, ceil(f*4) pack, 6-jitter, d2 > 576 --
// sharing only the placement RULE (checkPlacement) and entity construction with the engine. Spawned mobs are cleared every 200 ticks
// (stands in for despawn) so the cap is hit and released many times.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';
const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js', '07zf_bat.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
const W = M.World, CH = M.CH, CFG = M.CFG, B = M.Biomes, Sp = M.Spawn, EL = M.EntityList;
W.init(3); M.Gen.init(3, M.Gen.defaults()); M.Light.init(); M.Behave.init(W); EL.init(); M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
if (M.Bat && M.Bat.init) M.Bat.init();
Sp.init(); Sp.ready = true;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
let PLAINS = 0; for (let i = 0; i < B.count; i++) if (B.name(i).endsWith(':plains')) PLAINS = i;
const STONE = M.States.stateOf('stone') | 0, FLOOR = 60, CEIL = 64, TICKS = 2400, CLEAR = 200;
for (let cx = -2; cx <= 1; cx++) for (let cz = -2; cz <= 1; cz++) {
  const c = W.getOrCreate(cx, cz); c.state = CH.GENERATED; c.biome = new Uint8Array(256).fill(PLAINS);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    const gx = cx * 16 + x, gz = cz * 16 + z;
    W.setBlock(gx, FLOOR, gz, STONE); W.setBlock(gx, CEIL, gz, STONE);
    c.hmap[z * 16 + x] = CEIL - CFG.WORLD_MIN_Y;
  }
}
W.camCx = -1; W.camCz = -1;
const P = { x: 0.5, y: 61, z: 0.5 }; M.Player = P;
// java.util.Random (48-bit LCG), BigInt-free via two 24-bit halves is overkill: BigInt is fine at this volume
class JRandom {
  constructor(seed) { this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); }
  next(bits) { this.s = (this.s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); let r = Number(this.s >> BigInt(48 - bits)); return r | 0; }
  nextInt(b) {
    if ((b & -b) === b) return Number((BigInt(b) * BigInt(this.next(31))) >> 31n);
    let bits, v; do { bits = this.next(31); v = bits % b; } while (bits - v + (b - 1) < 0 || bits - v + (b - 1) > 2147483647);
    return v;
  }
  nextFloat() { return this.next(24) / (1 << 24); }
}
const CAPS = { monster: 70, creature: 10, ambient: 15, axolotls: 5, underground_water_creature: 5, water_creature: 5, water_ambient: 20 };
const LIM = (t) => Sp.limitPerChunk(t);
const equipOf = (e) => JSON.stringify(e.equip || {});
const snap = (e, tick, grp) => `${e.type}|${tick}|${Math.floor(e.x)},${Math.floor(e.y)},${Math.floor(e.z)}|g${grp}|${equipOf(e)}`;
// the ticking chunks in the world's own map order (the shuffle input), the 16 chunks of the room
const chunksList = () => { const a = []; W.chunks.forEach((c) => { if (W.loadedAt(c.cx << 4, c.cz << 4) && W.tickingAt(c.cx << 4, c.cz << 4)) a.push([c.cx, c.cz]); }); return a; };
const BOTTOM = CFG.WORLD_MIN_Y;
function oracleChunk(cx, cz, cat, rng, st, tick, out) {
  const rnd = (b) => rng.nextInt(b);
  const sx = cx * 16 + rng.nextInt(16), sz = cz * 16 + rng.nextInt(16);
  const sy = BOTTOM + rng.nextInt((CEIL + 2) - BOTTOM + 1);
  if (sy < BOTTOM + 1) return;
  if (sy === FLOOR || sy === CEIL) return;                     // the only solid cells in the column range
  const mark = out.length; let made = 0;
  const finish = () => { for (let i = mark; i < out.length; i++) out[i] = out[i].replace('@G', 'g' + made); };
  for (let t = 0; t < 3; t++) {
    let x = sx, z = sz, entry = null, hereN = 0, pack = {};
    let len = Math.ceil(Math.fround(rng.nextFloat() * 4));
    for (let k = 0; k < len; k++) {
      x += rng.nextInt(6) - rng.nextInt(6); z += rng.nextInt(6) - rng.nextInt(6);
      const px = x + 0.5, pz = z + 0.5, d2 = (P.x - px) ** 2 + (P.y - sy) ** 2 + (P.z - pz) ** 2;
      if (d2 <= 576) continue;
      if (!(x >= -32 && x < 32 && z >= -32 && z < 32)) continue;
      if (!entry) {
        const list = (B.spawners(PLAINS) || {})[cat] || [];
        let tot = 0; for (const e of list) tot += e.weight;
        if (!tot) break;                                  // pickRandomSpawnEntry == null ends this pack, the next try still runs
        let r = rng.nextInt(tot); entry = list.find((e) => (r -= e.weight) < 0);
        len = entry.minCount + rng.nextInt(1 + entry.maxCount - entry.minCount);
      }
      const type = entry.type.replace('minecraft:', '');
      const range = ({ monster: 128 }[cat] || 128);
      if (d2 > range * range && !Sp.spawnableFarFromPlayer(type)) continue;
      if (!EL.canSpawn(type) || !Sp.canPlace(type)) continue;
      if (!Sp.checkPlacement(type, x, sy, z, 'natural', rnd)) continue;
      rng.nextFloat();
      const e = EL.spawn(type, px, sy, pz, { spawnIdx: hereN, packData: pack });
      if (!e) continue;
      Sp.afterNaturalSpawn(e, type, rnd, pack);
      st.counts[cat] = (st.counts[cat] | 0) + 1; made++; hereN++;
      out.push(snap(e, tick, 0).replace('|g0|', '|@G|'));
      if (made >= LIM(type)) { finish(); return; }
    }
  }
  finish();
}
function oracleRun(seed, rngOv, ticks = TICKS) {
  const rng = rngOv || new JRandom(seed), out = [], st = { counts: {} };
  EL.clear();
  for (let tick = 0; tick < ticks; tick++) {
    if (tick && tick % CLEAR === 0) { EL.clear(); st.counts = {}; }
    const cs = chunksList();
    for (let i = cs.length - 1; i > 0; i--) { const j = rng.nextInt(i + 1), t = cs[i]; cs[i] = cs[j]; cs[j] = t; }
    for (const [cx, cz] of cs) for (const cat of Sp.NATURAL_CATEGORIES) {
      if (cat === 'creature' && tick % 400 !== 0) continue;
      if ((st.counts[cat] | 0) >= Math.floor(CAPS[cat] * cs.length / 289)) continue;
      oracleChunk(cx, cz, cat, rng, st, tick, out);
    }
  }
  EL.clear();
  return out;
}
function engineRun(seed) {
  const rng = new JRandom(seed), out = [], orig = Sp.spawnForChunk;
  let tick = 0;
  EL.clear();
  Sp.spawnForChunk = function (cx, cz, cat, ctx) {
    const before = EL.list.length, made = orig.call(Sp, cx, cz, cat, ctx);
    for (let i = before; i < EL.list.length; i++) out.push(snap(EL.list[i], tick, made));
    return made;
  };
  try {
    for (tick = 0; tick < TICKS; tick++) {
      if (tick && tick % CLEAR === 0) EL.clear();
      M.Behave.gameTime = tick;
      Sp.tick({ rng, rare: tick % 400 === 0 });
    }
  } finally { Sp.spawnForChunk = orig; }
  EL.clear();
  return out;
}
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const refs = salts.map((s) => oracleRun(s * 7919 + 1));
let spawns = 0, groups = 0;
const sweep = () => salts.map((s) => { const e = engineRun(s * 7919 + 1), i = firstDiff(e, refs[s]); return { s, i, e, tick: i < 0 ? -1 : +((e[i] || refs[s][i]).split('|')[1]) }; });
const clean = sweep();
for (const r of clean) { spawns += r.e.length; groups += r.e.filter((x) => !x.includes('|g1|')).length; ok(r.i < 0, `salt ${r.s}: first divergence at spawn #${r.i} (tick ${r.tick}): engine ${r.e[r.i]} vs oracle ${refs[r.s][r.i]}`); }
ok(spawns > 200, `the sweep spawned ${spawns} mobs (not vacuous)`);
ok(groups > 0, 'some spawn calls placed a group of more than one');
console.log(`  ${spawns} spawns over ${salts.length} salts, ${groups} in groups`);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Sp.TRAVERSAL.MIN_PLAYER_DIST2; Sp.TRAVERSAL.MIN_PLAYER_DIST2 = 625; const d = sweep().filter((r) => r.i >= 0); Sp.TRAVERSAL.MIN_PLAYER_DIST2 = o;
  brk(d.length > 0, `spawn distance 24 -> 25 caught at the first affected spawn (${d.slice(0, 3).map((r) => `salt ${r.s} spawn #${r.i} tick ${r.tick}`).join('; ')})`); }
{ const o = Sp.TRAVERSAL.TRIES; Sp.TRAVERSAL.TRIES = 2; brk(sweep().some((r) => r.i >= 0), 'tries 3 -> 2 caught'); Sp.TRAVERSAL.TRIES = o; }
{ const o = Sp.CATEGORY.monster.cap; Sp.CATEGORY.monster.cap = 100; brk(sweep().some((r) => r.i >= 0), 'monster cap 70 -> 100 caught (floor(70*16/289)=3 vs 5)'); Sp.CATEGORY.monster.cap = o; }
console.log(`spawnlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
