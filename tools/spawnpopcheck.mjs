#!/usr/bin/env node
// spawnpopcheck.mjs — G18c-a (#164): chunk-generation initial animal spawn,
// `SpawnHelper.populateEntities` as `NoiseChunkGenerator.populateEntities` calls it.
//
//   node tools/spawnpopcheck.mjs [--verbose]
//
//   1. the jar's own text still has the shape Spawn.populateChunk transcribes (anchors read out
//      of .decomp: populateEntities, setPopulationSeed, NoiseChunkGenerator.populateEntities)
//   2. java.util.Random known answers for the engine's LegacyRandom (incl. the new nextLong)
//   3. an ORACLE — a second, standalone transcription (own Random, own seeding, own loop) — gives
//      the same pack types, counts, positions and yaws as `World.installChunk`'s hook on real
//      generated terrain, over a grid of chunks; the grid must actually contain packs
//   4. the hook fires once per chunk, never on a resumed save
//   5. anti-vacuity — break the engine, the seeding, the probability, the jar text: each caught

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { getCachedColumn } from './chunkcache.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('spawnpopcheck — G18c-a, SpawnHelper.populateEntities at chunk generation (#164)');

const MC = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft');
const rd = (f) => { try { return readFileSync(join(MC, f), 'utf8'); } catch { return null; } };

// ── 1. the jar's text ──────────────────────────────────────────────────────────────────────────
function anchors(helper, cr, ncg) {
  const bad = [];
  const need = (t, re, what) => { if (!t || !re.test(t)) bad.push(what); };
  const body = helper && /public static void populateEntities[\s\S]*?\n    private static BlockPos getEntitySpawnPos/.exec(helper);
  const b = body ? body[0] : '';
  need(b, /while \(\$\$3\.nextFloat\(\) < \$\$4\.getCreatureSpawnProbability\(\)\)/, 'probability loop');
  need(b, /\$\$3\.nextInt\(1 \+ \$\$9\.maxGroupSize - \$\$9\.minGroupSize\)/, 'group size draw');
  need(b, /\$\$6 \+ \$\$3\.nextInt\(16\)/, 'x draw'); need(b, /\$\$7 \+ \$\$3\.nextInt\(16\)/, 'z draw');
  need(b, /\$\$18 < 4/, 'four attempts');
  need(b, /\$\$3\.nextFloat\(\) \* 360\.0F/, 'yaw draw');
  need(b, /\$\$12 \+= \$\$3\.nextInt\(5\) - \$\$3\.nextInt\(5\)/, 'x jitter');
  need(b, /\$\$13 \+= \$\$3\.nextInt\(5\) - \$\$3\.nextInt\(5\)/, 'z jitter');
  need(b, /\$\$12 = \$\$14 \+ \$\$3\.nextInt\(5\) - \$\$3\.nextInt\(5\)/, 'x re-jitter from origin');
  need(b, /\$\$13 = \$\$15 \+ \$\$3\.nextInt\(5\) - \$\$3\.nextInt\(5\)/, 'z re-jitter from origin');
  need(cr, /this\.nextLong\(\) \| 1L;[\s\S]*this\.nextLong\(\) \| 1L;[\s\S]*\(long\)\$\$1 \* \$\$3 \+ \(long\)\$\$2 \* \$\$4 \^ \$\$0/, 'setPopulationSeed');
  need(ncg, /setPopulationSeed\(\$\$0\.getSeed\(\), \$\$1\.getStartX\(\), \$\$1\.getStartZ\(\)\)/, 'population seed call');
  return bad;
}
const helperTxt = rd('world/SpawnHelper.java'), crTxt = rd('world/gen/random/ChunkRandom.java'),
  ncgTxt = rd('world/gen/chunk/NoiseChunkGenerator.java');
if (ok(helperTxt && crTxt && ncgTxt, '.decomp is missing — `node tools/cloud/bootstrap.mjs`')) {
  const bad = anchors(helperTxt, crTxt, ncgTxt);
  ok(bad.length === 0, 'the jar text no longer matches what Spawn.populateChunk transcribes: ' + bad.join(', '));
}

// ── engine ─────────────────────────────────────────────────────────────────────────────────────
const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07c_blockentity.js', '09b_sky.js',
  '14j_combat.js', '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
const { Gen: G, World: W, Light: L, CFG, Biomes: B, EntityList: EL, Spawn, States: S, Reg: R } = M;

// ── 2. java.util.Random known answers ──────────────────────────────────────────────────────────
{
  const LR = M.Noise.LegacyRandom;
  ok(new LR(0).nextInt() === -1155484576, 'new Random(0).nextInt() == -1155484576 (JDK)');
  ok(new LR(0).nextInt(100) === 60, 'new Random(0).nextInt(100) == 60 (JDK)');
  ok(new LR(0).nextLong() === -4962768465676381896n, 'new Random(0).nextLong() == -4962768465676381896 (JDK)');
}

// ── standalone oracle: its own Random, own seeding, own transcription of the loop ─────────────
class JRand {
  constructor(seed) { this.s = (BigInt.asUintN(64, BigInt(seed)) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); }
  next(bits) { this.s = (this.s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, this.s >> BigInt(48 - bits))); }
  nextInt(b) {
    if ((b & -b) === b) return Number((BigInt(b) * BigInt(this.next(31))) >> 31n);
    for (;;) { const bits = this.next(31), v = bits % b; if (((bits - v + (b - 1)) | 0) >= 0) return v; }
  }
  nextLong() { return BigInt.asIntN(64, (BigInt(this.next(32)) << 32n) + BigInt(this.next(32))); }
  nextFloat() { return this.next(24) / 16777216; }
}
const F32 = Math.fround;
function oracleChunk(seed, cx, cz, world) {
  const out = [], sx = cx * 16, sz = cz * 16;
  const seeder = new JRand(seed);
  const l3 = seeder.nextLong() | 1n, l4 = seeder.nextLong() | 1n;
  const r = new JRand(BigInt.asIntN(64, BigInt(sx) * l3 + BigInt(sz) * l4) ^ BigInt(seed));
  const bi = world.biomeAt(sx, sz), spawners = B.spawners(bi).creature || [];
  if (!spawners.length) return out;
  const p = F32(B.at ? B.at(bi).creatureSpawnProbability : B.creatureSpawnProbability(bi));
  const tot = spawners.reduce((a, e) => a + e.weight, 0);
  while (r.nextFloat() < p) {
    let i = r.nextInt(tot), en = null;
    for (const e of spawners) { i -= e.weight; if (i < 0) { en = e; break; } }
    const n = en.minCount + r.nextInt(1 + en.maxCount - en.minCount);
    let x = sx + r.nextInt(16), z = sz + r.nextInt(16); const ox = x, oz = z;
    const id = en.type.replace('minecraft:', '');
    for (let k = 0; k < n; k++) {
      let done = false;
      for (let a = 0; !done && a < 4; a++) {
        const c = world.probe(id, x, z);
        if (c) {
          const w = c.width, px = Math.min(Math.max(x, sx + w), sx + 16 - w), pz = Math.min(Math.max(z, sz + w), sz + 16 - w);
          if (world.roomFor(id, px, c.y, pz)) { out.push({ id, x: px, y: c.y, z: pz, yaw: r.nextFloat() * 360 }); done = true; }
        }
        x += r.nextInt(5) - r.nextInt(5);
        z += r.nextInt(5) - r.nextInt(5);
        while (x < sx || x >= sx + 16 || z < sz || z >= sz + 16) { x = ox + r.nextInt(5) - r.nextInt(5); z = oz + r.nextInt(5) - r.nextInt(5); }
      }
    }
  }
  return out;
}

// ── 3. real generated terrain, installed through World.installChunk ──────────────────────────
const SEED = 3, RAD = 5;
function build(seed, populate) {
  W.init(seed); G.init(seed, G.defaults()); L.init(); M.Behave.init(W); EL.init(); Spawn.init();
  if (M.Save) M.Save.loaded = false;
  Spawn.POPULATE = false;             // generate the whole grid first, populate after, so every
  const cols = [];                    // chunk sees its neighbours exactly as the oracle does
  for (let cx = -RAD; cx <= RAD; cx++) for (let cz = -RAD; cz <= RAD; cz++) {
    const col = getCachedColumn(M, cx, cz);
    W.installChunk(cx, cz, { sec: col.sec, hmap: col.hmap, biome: col.biome });
    cols.push([cx, cz]);
  }
  Spawn.POPULATE = populate;
  return cols;
}
const sw = () => W.seed;
// the oracle's own terrain probe: top of the highest solid/fluid non-leaf block, grass floor, bright, two clear cells
const nameAt = (x, y, z) => R.names[S.block[W.getBlock(x, y, z)]];
const worldView = {
  biomeAt: (x, z) => W.biomeAt(x, z),
  probe(id, x, z) {
    let y = W.heightAt(x, z) + 1;
    for (; y >= CFG.WORLD_MIN_Y; y--) {
      const st = W.getBlock(x, y, z);
      if (st && (S.solid[st] === 1 || S.waterIn[st] || nameAt(x, y, z) === 'lava') && !/_leaves$/.test(nameAt(x, y, z))) break;
    }
    y += 1;
    const dim = M.Entities.dimensions(id);
    if (!dim) return null;
    if (!(EL.canSpawn(id) && Spawn.canPlace(id))) return null;
    if (Spawn.locationOf(id) !== 'on_ground') return null;
    if (nameAt(x, y - 1, z) !== 'grass_block') return null;
    if (W.rawBrightness(x, y, z) <= 8) return null;
    // isClearForSpawn: no full-cube collision, no fluid (grass and flowers do not block a spawn)
    for (const yy of [y, y + 1]) { const st = W.getBlock(x, yy, z); if (st && (S.solid[st] === 1 || S.waterIn[st])) return null; }
    return { y, width: dim.width };
  },
  roomFor: (id, px, y, pz) => Spawn.spaceEmptyAt(id, px, y, pz, true),
};

const cols = build(SEED, true);
// build() populated as chunks installed, but with Spawn.POPULATE false at install time: run the hook now
Spawn.POPULATE = true;
const engine = new Map();
EL.clear(); Spawn.populated = new Set();
for (const [cx, cz] of cols) {
  const before = EL.count();
  Spawn.onChunkInstalled(cx, cz);
  const made = EL.all().slice(before).map((e) => ({ id: e.type, x: e.x, y: e.y, z: e.z, yaw: e.yaw }));
  engine.set(cx + ',' + cz, made);
}
const oracleAll = (seedOverride) => {
  const m = new Map();
  for (const [cx, cz] of cols) m.set(cx + ',' + cz, oracleChunk(seedOverride ?? sw(), cx, cz, worldView));
  return m;
};
const same = (a, b) => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (!w || w.length !== v.length) return false;
    for (let i = 0; i < v.length; i++) {
      const p = v[i], q = w[i];
      if (p.id !== q.id || p.x !== q.x || p.y !== q.y || p.z !== q.z || Math.abs(p.yaw - q.yaw) > 1e-9) return false;
    }
  }
  return true;
};
const total = (m) => [...m.values()].reduce((a, v) => a + v.length, 0);
const oracle = oracleAll();
say(`engine spawned ${total(engine)} mobs over ${cols.length} chunks; oracle ${total(oracle)}`);
ok(total(oracle) >= 20, `the grid holds real packs (oracle placed ${total(oracle)}, need >= 20) — the comparison is not vacuous`);
ok(new Set([...oracle.values()].flat().map((e) => e.id)).size >= 2, 'at least two species appear');
ok([...oracle.values()].some((v) => v.length >= 3), 'at least one chunk holds a pack of 3+');
ok(same(engine, oracle), 'engine packs == oracle packs (type, count, x, y, z, yaw) for every chunk in the grid');
for (const [k, v] of engine) for (const e of v) {
  const cx = Math.floor(e.x / 16), cz = Math.floor(e.z / 16);
  if (k !== cx + ',' + cz) { ok(false, `${e.id} at ${e.x},${e.z} left chunk ${k}`); break; }
}
ok(!!EL.all().length, 'entities are live in the EntityList');

// ── 4. the hook ─────────────────────────────────────────────────────────────────────────────────
{
  const n = EL.count();
  Spawn.onChunkInstalled(cols[0][0], cols[0][1]);
  ok(EL.count() === n, 'a chunk already populated this session is not populated again');
  Spawn.populated = new Set(); M.Save = M.Save || {}; const was = M.Save.loaded; M.Save.loaded = true;
  Spawn.onChunkInstalled(cols[0][0], cols[0][1]);
  ok(EL.count() === n, 'a resumed save (Save.loaded) is never populated');
  M.Save.loaded = was;
  Spawn.populated = new Set(); Spawn.POPULATE = false;
  Spawn.onChunkInstalled(cols[0][0], cols[0][1]);
  ok(EL.count() === n, 'Spawn.POPULATE=false disables it');
  Spawn.POPULATE = true;
}

// ── 5. anti-vacuity ───────────────────────────────────────────────────────────────────────────
function rerun() {
  EL.clear(); Spawn.populated = new Set();
  const m = new Map();
  for (const [cx, cz] of cols) {
    const before = EL.count();
    Spawn.onChunkInstalled(cx, cz);
    m.set(cx + ',' + cz, EL.all().slice(before).map((e) => ({ id: e.type, x: e.x, y: e.y, z: e.z, yaw: e.yaw })));
  }
  return m;
}
{
  const realPop = Spawn.populationRandom;
  Spawn.populationRandom = (s, x, z) => realPop(BigInt(s) + 1n, x, z);
  okAv(!same(rerun(), oracle), 'a wrong population seed changes the packs');
  Spawn.populationRandom = (s, x, z) => { const r = realPop(s, x, z); const ni = r.nextInt.bind(r); let n = 0; r.nextInt = (b) => (n++ === 2 ? (ni(b) + 1) % b : ni(b)); return r; };
  okAv(!same(rerun(), oracle), 'one perturbed draw changes the packs');
  Spawn.populationRandom = realPop;

  const realProb = B.creatureSpawnProbability;
  B.creatureSpawnProbability = (i) => realProb(i) * 0.5;
  okAv(!same(rerun(), oracle), 'a halved biome creature probability changes the packs');
  B.creatureSpawnProbability = realProb;

  const realTop = Spawn.motionBlockingTop;
  Spawn.motionBlockingTop = (x, z, nl) => realTop(x, z, nl) + 1;
  okAv(!same(rerun(), oracle), 'a heightmap off by one changes the packs');
  Spawn.motionBlockingTop = realTop;

  const realNext = M.Noise.LegacyRandom.prototype.nextLong;
  M.Noise.LegacyRandom.prototype.nextLong = function () { return realNext.call(this) ^ 2n; };
  okAv(!same(rerun(), oracle), 'a perturbed nextLong (the population-seed multipliers) changes the packs');
  M.Noise.LegacyRandom.prototype.nextLong = realNext;
  ok(same(rerun(), oracle), 'restored: the engine matches the oracle again');

  okAv(anchors(helperTxt.replace(/nextInt\(16\)/g, 'nextInt(15)'), crTxt, ncgTxt).length > 0, 'a changed jar draw bound trips the text anchors');
  okAv(anchors(helperTxt, crTxt.replace('| 1L', '| 3L'), ncgTxt).length > 0, 'a changed setPopulationSeed trips the text anchors');
  okAv(anchors(helperTxt.replace('< 4', '< 5'), crTxt, ncgTxt).length > 0, 'a changed retry count trips the text anchors');
}

console.log(`   checks: ${pass} assertions, 0 failed, ${breaks} breaks caught`);
if (fails.length) { console.log('FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log(`OK    ${pass} assertions · ${breaks} breaks caught`);
