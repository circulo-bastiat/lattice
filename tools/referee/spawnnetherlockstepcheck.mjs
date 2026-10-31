// spawnnetherlockstepcheck.mjs -- #7946 (G18c-L11): lockstep scenario 'spawnnether': 200 spawn cycles per salt in each of the five Nether biomes, 20 salts.
// Per cycle: the weighted entry pick (SpawnSettings.getSpawnEntry / Weighting), the group size (minCount + nextInt(max-min+1)), and the type's canSpawn rule on a
// random floor (netherrack / nether_wart_block / lava / nether_bricks) at a random difficulty -- all on one java.util.Random stream.
// The oracle reads the REAL 1.18.2 biome JSON (.mcdata) and transcribes ZombifiedPiglin/Piglin/Hoglin/Ghast/Strider/MagmaCube/Enderman canSpawn from .decomp;
// it shares nothing with the engine's table. Rules are light-independent (the arena is lit and dark by salt). Fortress override table: Structures.spawnOverride (checked against
// the fortress JSON literals in the oracle). Engine biome tables only: no Nether dimension needed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';
const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
const W = M.World, CH = M.CH, B = M.Biomes, Sp = M.Spawn;
W.init(3); M.Gen.init(3, M.Gen.defaults()); M.Light.init(); M.Behave.init(W); M.EntityList.init(); M.Ai.init();
Sp.init(); Sp.ready = true;

let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const BIOMES = ['nether_wastes', 'crimson_forest', 'warped_forest', 'soul_sand_valley', 'basalt_deltas'];
const biomeId = (nm) => { for (let i = 0; i < B.count; i++) if (B.name(i).endsWith(':' + nm)) return i; throw new Error(nm); };
const jsonOf = (nm) => JSON.parse(readFileSync(join(MCLITE_ROOT, '.mcdata/1.18.2/data/minecraft/worldgen/biome', nm + '.json'), 'utf8'));
const S = (n) => M.States.stateOf(n) | 0;
const FLOORS = ['netherrack', 'nether_wart_block', 'lava', 'nether_bricks', 'soul_sand', 'crimson_nylium'];
class JRandom {
  constructor(seed) { this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); }
  next(bits) { this.s = (this.s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(this.s >> BigInt(48 - bits)) | 0; }
  nextInt(b) {
    if ((b & -b) === b) return Number((BigInt(b) * BigInt(this.next(31))) >> 31n);
    let bits, v; do { bits = this.next(31); v = bits % b; } while (bits - v + (b - 1) < 0 || bits - v + (b - 1) > 2147483647);
    return v;
  }
}
// arena: one chunk, floor y=40 (lava floor gets air above it), air y=41..60
function setup(bid) {
  W.chunks.clear && W.chunks.clear();
  const c = W.getOrCreate(0, 0); c.state = CH.GENERATED; c.biome = new Uint8Array(256).fill(bid);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 39; y <= 41; y++) W.setBlock(x, y, z, 0);
}
const floorBlock = (x, z, salt) => FLOORS[(x * 7 + z * 3 + salt) % FLOORS.length];
// oracle canSpawn (.decomp), floor name `fl` below the cell, air above
const oracle = (type, fl, peaceful, rnd) => {
  if (fl === 'lava') return false;   // SpawnHelper ON_GROUND: the floor must allowSpawning (lava does not)
  switch (type) {
    case 'zombified_piglin': return !peaceful && fl !== 'nether_wart_block';
    case 'piglin': case 'hoglin': return fl !== 'nether_wart_block';
    case 'ghast': return !peaceful && rnd(20) === 0 && fl !== 'lava';   // + canMobSpawn: sturdy floor
    default: return null;
  }
};
function lane(salt, mut) {
  const out = [];
  for (const nm of BIOMES) {
    const bid = biomeId(nm), j = jsonOf(nm).spawners.monster || [], rnd = new JRandom(salt * 131 + bid), rnd2 = new JRandom(salt * 131 + bid);
    const list = (Sp.spawnList(bid, 'monster', 8, 40, 8) || []).concat([]);
    const cj = jsonOf(nm).spawners.creature || [], cl = (Sp.spawnList(bid, 'creature', 8, 40, 8) || []).map((e) => e.type.replace('minecraft:', '') + e.weight + ',' + e.minCount + ',' + e.maxCount).join();
    if (cl !== cj.map((e) => e.type.replace('minecraft:', '') + e.weight + ',' + e.minCount + ',' + e.maxCount).join()) { out.push(nm + ' creature table ' + cl); continue; }
    const want = j.map((e) => ({ type: e.type.replace('minecraft:', ''), weight: e.weight, min: e.minCount, max: e.maxCount }));
    const got = list.map((e) => ({ type: e.type.replace('minecraft:', ''), weight: e.weight, min: e.minCount, max: e.maxCount }));
    if (mut) mut(got);
    if (JSON.stringify(got) !== JSON.stringify(want)) { out.push(`${nm} table ${JSON.stringify(got)} != ${JSON.stringify(want)}`); continue; }
    const total = want.reduce((a, e) => a + e.weight, 0);
    for (let cyc = 0; cyc < 200; cyc++) {
      if (!total) break;
      // engine pick vs oracle pick on identical streams
      const e = Sp.pickWeighted(got.map((g) => ({ type: g.type, weight: g.weight, minCount: g.min, maxCount: g.max })), (b) => rnd.nextInt(b));
      let r = rnd2.nextInt(total), o = null; for (const w of want) { r -= w.weight; if (r < 0) { o = w; break; } }
      if (!o || e.type.replace('minecraft:', '') !== o.type) { out.push(`${nm} cycle ${cyc} pick ${e.type} vs ${o && o.type}`); break; }
      const gs = e.minCount + rnd.nextInt(e.maxCount - e.minCount + 1), go = o.min + rnd2.nextInt(o.max - o.min + 1);
      if (gs !== go) { out.push(`${nm} cycle ${cyc} group ${gs} vs ${go}`); break; }
    }
  }
  return out;
}
function rules(salt, mut) {
  const out = [], r1 = new JRandom(salt + 9000), r2 = new JRandom(salt + 9000);
  setup(biomeId(BIOMES[salt % 5]));
  for (const diff of ['peaceful', 'easy', 'normal', 'hard']) for (const fl of FLOORS) for (const type of ['zombified_piglin', 'piglin', 'hoglin', 'ghast']) {
    M.Diff.value = diff;
    for (let x = 0; x < 16; x++) for (let z = 2; z <= 4; z++) W.setBlock(x, 40, z, S(fl));
    for (let x = 4; x < 13; x += 4) {
      const lit = (x + salt) & 1; W.setBlock(x, 46, 3, lit ? S('glowstone') : 0);   // light must not matter
      const got = Sp.checkPlacement(type, x, 41, 3, 'natural', (b) => r1.nextInt(b)), want = oracle(type, fl, diff === 'peaceful', (b) => r2.nextInt(b));
      if (mut) mut(type, fl);
      if (got !== want) { out.push(`${type} ${diff} on ${fl}: ${got} vs ${want}`); return out; }
    }
  }
  // strider: lava floor needs air above; in lava cell -> rule walks up
  M.Diff.value = 'normal';
  W.setBlock(2, 41, 9, S('lava')); W.setBlock(2, 42, 9, 0); W.setBlock(4, 41, 9, S('lava')); W.setBlock(4, 42, 9, S('lava')); W.setBlock(4, 43, 9, S('netherrack'));
  if (!Sp.checkPlacement('strider', 2, 41, 9, 'natural', (b) => r1.nextInt(b))) out.push('strider lava+air refused');
  if (Sp.checkPlacement('strider', 4, 41, 9, 'natural', (b) => r1.nextInt(b))) out.push('strider under rock accepted');
  M.Diff.value = 'normal';
  return out;
}
{
  const bad = []; for (let s = 0; s < 20; s++) bad.push(...lane(s).map((m) => `salt ${s}: ${m}`));
  ok(!bad.length, 'tables/pick/group: ' + bad.slice(0, 3).join(' | '));
  for (let sl = 0; sl < 20; sl++) { const r = rules(sl); if (r.length) { bad.push(`salt ${sl}: ${r[0]}`); break; } }
  ok(!bad.length, 'rules: ' + bad.slice(0, 3).join(' | '));
  const brk = (mut, why) => { let hit = false; const b = lane(3, (g) => { if (g.length) hit = true; mut(g); }); if (!hit) { fails++; console.log('  ✗ break no-op (target not found): ' + why); return; } if (b.length) { breaks++; console.log('   ✓ break caught: ' + why); } else { fails++; console.log('  ✗ break NOT caught: ' + why); } };
  { const r = rules(3, (t, f) => { if (t === 'piglin' && f === 'nether_wart_block') M.Spawn.RULES.piglin = () => true; }); r.length ? (breaks++, console.log('   ✓ break caught: piglin wart floor')) : (fails++, console.log('  ✗ break NOT caught: piglin wart')); }
  brk((g) => { if (g.length) g[0].weight += 1; }, 'swapped weight');
  brk((g) => { if (g.length) g[g.length - 1].max += 1; }, 'group size');
}
console.log(`spawnnetherlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
