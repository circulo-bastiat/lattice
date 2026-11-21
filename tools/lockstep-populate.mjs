#!/usr/bin/env node
// lockstep-populate -- #7094 (G18c-L3): lockstep scenario 'populate', 20 salts (world seeds). Per salt a 3x3 block of chunks is generated and
// populated through World.installChunk's hook (Spawn.populateChunk); the multiset of (type, x, y, z, yaw) per chunk is compared with a standalone
// transcription of SpawnHelper.populateEntities (own Random, own setPopulationSeed, 0.1-style biome probability, weighted pick, group window,
// 4 attempts, MOTION_BLOCKING_NO_LEAVES top, nextFloat()*360 yaw). Mobs spawn adult (no baby flag in populate).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { getCachedColumn } from './chunkcache.mjs';

const SALTS = 20;

const MC = join(MCLITE_ROOT, ".decomp");
// ── engine ─────────────────────────────────────────────────────────────────────────────────────
const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07c_blockentity.js', '09b_sky.js',
  '14j_combat.js', '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js'];
function load(patch) {
const M = loadEngine({ patch, extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
return M;
}

// ── standalone oracle: its own Random, own seeding, own transcription of the loop ─────────────
function mkOracle(M) {
 const { World: W, Biomes: B, EntityList: EL, Spawn, States: S, Reg: R, CFG } = M;
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


 return { chunk: (seed, cx, cz) => oracleChunk(seed, cx, cz, worldView) };
}

const F = (x) => Math.round(x * 1e6) / 1e6;
const key = (e) => [e.id, F(e.x), F(e.y), F(e.z), F(e.yaw)].join(',');
function run(patch) {
  const M = load(patch), { Gen: G, World: W, Light: L, CFG, Biomes: B, EntityList: EL, Spawn, States: S, Reg: R } = M;
  const JR = mkOracle(M);
  let bad = 0, first = '', total = 0, biomes = new Set();
  for (let salt = 1; salt <= SALTS; salt++) {
    const seed = salt * 7 + 1, ox = ((salt * 5) % 9) - 4, oz = ((salt * 3) % 9) - 4;
    W.init(seed); G.init(seed, G.defaults()); L.init(); M.Behave.init(W); EL.init(); Spawn.init();
    if (M.Save) M.Save.loaded = false;
    Spawn.POPULATE = false;
    const cols = [];
    for (let cx = ox; cx < ox + 3; cx++) for (let cz = oz; cz < oz + 3; cz++) {
      const col = getCachedColumn(M, cx, cz);
      W.installChunk(cx, cz, { sec: col.sec, hmap: col.hmap, biome: col.biome });
      cols.push([cx, cz]);
    }
    Spawn.POPULATE = true; EL.clear(); Spawn.populated = new Set();
    for (const [cx, cz] of cols) {
      const before = EL.count();
      Spawn.onChunkInstalled(cx, cz);
      const eng = EL.all().slice(before).map((e) => key({ id: e.type, x: e.x, y: e.y, z: e.z, yaw: e.yaw })).sort();
      const ref = JR.chunk(W.seed, cx, cz, W).map(key).sort();
      biomes.add(W.biomeAt(cx * 16, cz * 16)); total += ref.length;
      if (eng.join('|') !== ref.join('|')) { bad++; if (!first) first = `salt ${salt} chunk ${cx},${cz}:\n engine ${eng.join(' ')}\n ref    ${ref.join(' ')}`; }
    }
  }
  return { bad, first, total, biomes: biomes.size };
}

const base = run();
let ok = base.bad === 0 && base.total >= 25 && base.biomes >= 4, caught = 0;
if (base.total < 25 || base.biomes < 4) console.log(`VACUOUS: ${base.total} mobs, ${base.biomes} biomes`);
const breaks = [
  ['creature probability halved', (f, x) => f === '04g_biomes.js' ? x.replace('B.creatureSpawnProbability = function (i) { return at(i).creatureSpawnProbability; };', 'B.creatureSpawnProbability = function (i) { return at(i).creatureSpawnProbability * 0.5; };') : x],
  ['group size window off by one', (f, x) => f === '07l_spawn.js' ? x.replace('r.nextInt(1 + en.maxCount - en.minCount)', 'r.nextInt(2 + en.maxCount - en.minCount)') : x],
  ['three attempts instead of four', (f, x) => f === '07l_spawn.js' ? x.replace('t < 4;', 't < 3;') : x],
  ['yaw drawn as *180', (f, x) => f === '07l_spawn.js' ? x.replace('r.nextFloat() * 360', 'r.nextFloat() * 180') : x],
];
for (const [name, p] of breaks) {
  let x; try { x = run(p); } catch (e) { x = { bad: 1 }; }
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`populate: ${caught} breaks caught, ${base.bad} divergences, ${base.total} mobs in ${base.biomes} biomes${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
