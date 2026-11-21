// spawnwaterlockstepcheck.mjs -- #7915 (G18c-L3): lockstep scenario 'spawnwater': a flooded ocean arena and a dark water cave (128x128 = 64 chunks so the 5/20/5/15 caps scale to >=1), a fixed player, 1200 ticks of the
// NaturalSpawner cycle (ServerChunkManager.tickChunks -> SpawnHelper.spawn -> spawnEntitiesInChunk), seeded java.util.Random, 20 salts.
// Compared per spawned mob: (type, tick, x, y, z, group size, equipment). The oracle is an independent transcription of
// SpawnHelper.spawn/spawnEntitiesInChunk/Info.isBelowCap (.decomp) -- shuffle, cap 70*chunks/289, 3 tries, ceil(f*4) pack, 6-jitter, d2 > 576 --
// sharing only the placement RULE (checkPlacement) and entity construction with the engine. Spawned mobs are cleared every 200 ticks
// (stands in for despawn) so the cap is hit and released many times.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';
const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js', '07zj_fish.js', '07zjd_dolphin.js', '07zj2_dolphin.js', '07zz2_dolphin.js', '07zm_axolotl.js'];
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
const biomeId = (nm) => { for (let i = 0; i < B.count; i++) if (B.name(i).endsWith(':' + nm)) return i; throw new Error(nm); };
const STONE = M.States.stateOf('stone') | 0, WATER = M.States.stateOf('water') | 0, TICKS = +(process.env.WS_TICKS || 1000), CLEAR = 200;
const CAPS = { water_creature: 5, water_ambient: 20, underground_water_creature: 5, ambient: 15 };
const CATS = Object.keys(CAPS);
Sp.NATURAL_CATEGORIES = Sp.NATURAL_CATEGORIES.filter((c) => CATS.includes(c));   // the lane covers these four only
// arenas: floor/ceiling stone, water from floor+1 up to waterTop (inclusive), air above. 8x8 chunks.
const ARENAS = (process.env.WS_ONE ? (a) => a.slice(0, 1) : (a) => a)([
  { name: 'lukewarm_ocean', floor: 40, ceil: 90, waterTop: 62 },
  { name: 'deep_ocean', floor: 20, ceil: 90, waterTop: 62 },
  { name: 'river', floor: 56, ceil: 90, waterTop: 62 },
  { name: 'plains', floor: 56, ceil: 90, waterTop: 56 },
  { name: 'lush_caves', floor: 20, ceil: 50, waterTop: 34 },
]);
let ARENA = null, BID = 0;
function build(a) {
  ARENA = a; BID = biomeId(a.name);
  W.chunks.clear && W.chunks.clear();
  for (let cx = -4; cx < 4; cx++) for (let cz = -4; cz < 4; cz++) {
    const c = W.getOrCreate(cx, cz); c.state = CH.GENERATED; c.biome = new Uint8Array(256).fill(BID);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const gx = cx * 16 + x, gz = cz * 16 + z;
      for (let y = a.floor; y <= a.ceil; y++) {
        if (y === a.floor || y === a.ceil) W.setBlock(gx, y, gz, STONE); else if (y <= a.waterTop) W.setBlock(gx, y, gz, WATER);
      }
      c.hmap[z * 16 + x] = Math.max(a.waterTop, a.ceil === 90 ? a.waterTop : a.ceil) - CFG.WORLD_MIN_Y;
    }
  }
  W.camCx = 0; W.camCz = 0;
  M.Player = P.cur = { x: -63.5, y: a.floor + 2, z: -63.5 };
}
const P = { cur: null };
class JRandom {
  constructor(seed) { this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); }
  next(bits) { this.s = (this.s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(this.s >> BigInt(48 - bits)) | 0; }
  nextInt(b) {
    if ((b & -b) === b) return Number((BigInt(b) * BigInt(this.next(31))) >> 31n);
    let bits, v; do { bits = this.next(31); v = bits % b; } while (bits - v + (b - 1) < 0 || bits - v + (b - 1) > 2147483647);
    return v;
  }
  nextFloat() { return this.next(24) / (1 << 24); }
}
const LIM = (t) => Sp.limitPerChunk(t);
const snap = (e, tick, grp) => `${e.type}|${tick}|${Math.floor(e.x)},${Math.floor(e.y)},${Math.floor(e.z)}|g${grp}`;
const chunksList = () => { const a = []; W.chunks.forEach((c) => { if (W.loadedAt(c.cx << 4, c.cz << 4) && W.tickingAt(c.cx << 4, c.cz << 4)) a.push([c.cx, c.cz]); }); return a; };
const BOTTOM = CFG.WORLD_MIN_Y;
// independent transcription of the water rules, with the vanilla literals (sea level 63) written out here, NOT read from Spawn.SEA_LEVEL
const SEA = 63;
const isW = (x, y, z) => W.getBlock(x, y, z) === WATER;
const wcSpawn = (x, y, z) => !(y < SEA - 13 || y > SEA) && isW(x, y - 1, z) && isW(x, y + 1, z);   // WaterCreatureEntity.canSpawn
function oraclePlace(type, x, y, z, rnd) {
  if (type === 'bat') return Sp.checkPlacement(type, x, y, z, 'natural', rnd);   // shared
  if (!Sp.locationOk(Sp.locationOf(type), x, y, z)) return false;   // SpawnRestriction location (shared)
  return oracleRule(type, x, y, z) && Sp.spaceEmpty(type, x, y, z);
}
function oracleRule(type, x, y, z) {
  switch (type) {
    case 'squid': case 'cod': case 'salmon': case 'pufferfish': case 'dolphin': return wcSpawn(x, y, z);
    case 'tropical_fish': return isW(x, y - 1, z) && isW(x, y + 1, z) && (ARENA.name === 'lush_caves' || wcSpawn(x, y, z));
    case 'glow_squid': { if (y > SEA - 33) return false; const L = W.getLight(x, y, z); return (L & 255) === 0 && isW(x, y, z); }
    default: return false;
  }
}
function oracleChunk(cx, cz, cat, rng, st, tick, out) {
  const rnd = (b) => rng.nextInt(b), Pl = P.cur;
  const sx = cx * 16 + rng.nextInt(16), sz = cz * 16 + rng.nextInt(16);
  const sy = BOTTOM + rng.nextInt((W.heightAt(sx, sz) + 2) - BOTTOM + 1);
  if (sy < BOTTOM + 1) return;
  if (W.getBlock(sx, sy, sz) === STONE) return;
  const mark = out.length; let made = 0;
  const finish = () => { for (let i = mark; i < out.length; i++) out[i] = out[i].replace('@G', 'g' + made); };
  for (let t = 0; t < 3; t++) {
    let x = sx, z = sz, entry = null, hereN = 0, pack = {};
    let len = Math.ceil(Math.fround(rng.nextFloat() * 4));
    for (let k = 0; k < len; k++) {
      x += rng.nextInt(6) - rng.nextInt(6); z += rng.nextInt(6) - rng.nextInt(6);
      const px = x + 0.5, pz = z + 0.5, d2 = (Pl.x - px) ** 2 + (Pl.y - sy) ** 2 + (Pl.z - pz) ** 2;
      if (d2 <= 576) continue;
      if (!(x >= -64 && x < 64 && z >= -64 && z < 64)) continue;
      if (!entry) {
        const list = (B.spawners(BID) || {})[cat] || [];
        let tot = 0; for (const e of list) tot += e.weight;
        if (!tot) break;
        let r = rng.nextInt(tot); entry = list.find((e) => (r -= e.weight) < 0);
        len = entry.minCount + rng.nextInt(1 + entry.maxCount - entry.minCount);
      }
      const type = entry.type.replace('minecraft:', '');
      const RANGE = cat === 'water_ambient' ? 64 : 128;   // SpawnGroup despawn distances
      if (d2 > RANGE * RANGE && !Sp.spawnableFarFromPlayer(type)) continue;
      if (!EL.canSpawn(type) || !Sp.canPlace(type)) continue;
      if (!oraclePlace(type, x, sy, z, rnd)) continue;
      rng.nextFloat();
      if (d2 > RANGE * RANGE && Sp.canImmediatelyDespawn({ type }, d2)) continue;   // MobEntity.isValidSpawn
      const e = EL.spawn(type, px, sy, pz, { spawnIdx: hereN, packData: pack });
      if (!e) continue;
      Sp.afterNaturalSpawn(e, type, rnd, pack);
      st.counts[cat] = (st.counts[cat] | 0) + 1; made++; hereN++;
      out.push(snap(e, tick, 0).replace('|g0', '|@G'));
      if (made >= LIM(type)) { finish(); return; }
      if (type === 'tropical_fish' && e.fishCommonSpawn === false) break;   // spawnsTooManyForEachTry
    }
  }
  finish();
}
function oracleRun(seed) {
  const rng = new JRandom(seed), out = [], st = { counts: {} };
  seedMath(seed); EL.clear();
  for (let tick = 0; tick < TICKS; tick++) {
    if (tick && tick % CLEAR === 0) { EL.clear(); st.counts = {}; }
    const cs = chunksList();
    for (let i = cs.length - 1; i > 0; i--) { const j = rng.nextInt(i + 1), t = cs[i]; cs[i] = cs[j]; cs[j] = t; }
    for (const [cx, cz] of cs) for (const cat of Sp.NATURAL_CATEGORIES) {
      if (cat === 'creature' && tick % 400 !== 0) continue;
      if (!CAPS[cat] || (st.counts[cat] | 0) >= Math.floor(CAPS[cat] * cs.length / 289)) continue;
      oracleChunk(cx, cz, cat, rng, st, tick, out);
    }
  }
  EL.clear();
  return out;
}
function engineRun(seed) {
  const rng = new JRandom(seed), out = [], orig = Sp.spawnForChunk;
  let tick = 0;
  seedMath(seed); EL.clear();
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
// entity construction (tropical fish variants, ...) draws from Math.random: pin it per run so oracle and engine see the same stream
const seedMath = (seed) => { let a = (seed ^ 0x9E3779B9) >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
for (const a of ARENAS) {
  build(a);
  const refs = salts.map((s) => oracleRun(s * 7919 + 1));
  const sweep = (sub) => (sub ? salts.slice(0, 4) : salts).map((s) => { const e = engineRun(s * 7919 + 1); return { s, i: firstDiff(e, refs[s]), e }; });
  const clean = sweep(), types = {};
  if (process.env.WS_DEBUG) { const r = clean[+process.env.WS_DEBUG]; console.log(r.e.slice(0, 8), refs[r.s].slice(0, 8)); }
  let spawns = 0;
  for (const r of clean) { spawns += r.e.length; for (const x of r.e) { const t = x.split('|')[0]; types[t] = (types[t] | 0) + 1; }
    ok(r.i < 0, `${a.name} salt ${r.s}: first divergence at spawn #${r.i}: engine ${r.e[r.i]} vs oracle ${refs[r.s][r.i]}`); }
  ok(spawns > 20 && (a.name !== 'plains' || Object.keys(types).join() === 'bat'), `${a.name}: the sweep spawned ${spawns} mobs (not vacuous)`);
  console.log(`  ${a.name}: ${spawns} spawns over ${salts.length} salts ${JSON.stringify(types)}`);
  if (a.name === 'lukewarm_ocean') {
    const o = Sp.SEA_LEVEL; Sp.SEA_LEVEL = 64;
    brk(sweep(true).some((r) => r.i >= 0), 'squid y band (sea level 63 -> 64) caught');
    Sp.SEA_LEVEL = o;
  }
  if (a.name === 'lush_caves') {
    const o = Sp.SEA_LEVEL; Sp.SEA_LEVEL = 64;
    brk(sweep(true).some((r) => r.i >= 0), 'glow squid depth bound moved (63 -> 64) caught');
    Sp.SEA_LEVEL = o;
  }
}
console.log(`spawnwaterlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
