#!/usr/bin/env node
// spawntravcheck.mjs — #166 (G18c-c): NaturalSpawner traversal parity.
//
//   node tools/spawntravcheck.mjs
//
// `Spawn.spawnForChunk` is SpawnHelper.spawnEntitiesInChunk. This proves it three ways:
//   1. every literal in Spawn.TRAVERSAL is re-read out of .decomp SpawnHelper.java (never typed twice);
//   2. an RNG-SEQUENCE ORACLE: a second, independent transcription of spawnEntitiesInChunk's control
//      flow (below, written from the decomp text, sharing only the placement RULE with the engine).
//      Both draw from identical seeded streams; the logged (kind, bound) draw sequence and the
//      placed positions must be equal, over thousands of seeds, with and without a world spawn;
//   3. SpawnHelper.Info's GravityField / spawn_costs against GravityField.java's own arithmetic.
// Each mechanic gets a deliberate break (anti-vacuity, D-30): a mutated constant/oracle must be caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; say('  ✓ caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);
say('spawntravcheck — #166 NaturalSpawner traversal: chunk pick, 3 tries, pack jitter, 576/24 rules, Info/spawn_costs');

const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
               '07l_spawn.js', '07c_blockentity.js', '09b_sky.js', '14j_combat.js',
               '07w_passive.js', '14c_raycast.js', '07zf_bat.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init();
const W = M.World, L = M.Light, CH = M.CH, CFG = M.CFG, B = M.Biomes, Sp = M.Spawn, EL = M.EntityList;
W.init(3); M.Gen.init(3, M.Gen.defaults()); L.init(); M.Behave.init(W); EL.init(); M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
if (M.Bat && M.Bat.init) M.Bat.init();
Sp.init();
Sp.ready = false;                                   // Spawn.tick is driven by hand only
let PLAINS = 0; for (let i = 0; i < B.count; i++) if (B.name(i).endsWith(':plains')) PLAINS = i;
const GRASS = M.States.stateOf('grass_block') | 0;

// ── 1. the literals, out of the decomp source ────────────────────────────────────────────────
say('\n1. Spawn.TRAVERSAL against SpawnHelper.java');
const SRC = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/world/SpawnHelper.java'), 'utf8');
const literalsOk = (T, src) => {
  const has = (re) => re.test(src);
  return [
    ['TRIES', has(new RegExp(`for \\(int \\$\\$12 = 0; \\$\\$12 < ${T.TRIES}; \\$\\$12\\+\\+\\)`))],
    ['PACK_RANDOM_MAX', has(new RegExp(`MathHelper\\.ceil\\(\\$\\$1\\.random\\.nextFloat\\(\\) \\* ${T.PACK_RANDOM_MAX}\\.0F\\)`))],
    ['JITTER', has(new RegExp(`\\$\\$13 \\+= \\$\\$1\\.random\\.nextInt\\(${T.JITTER}\\) - \\$\\$1\\.random\\.nextInt\\(${T.JITTER}\\);`)) &&
               has(new RegExp(`\\$\\$14 \\+= \\$\\$1\\.random\\.nextInt\\(${T.JITTER}\\) - \\$\\$1\\.random\\.nextInt\\(${T.JITTER}\\);`))],
    ['MIN_PLAYER_DIST2', has(new RegExp(`\\$\\$3 <= ${T.MIN_PLAYER_DIST2}\\.0`))],
    ['SPAWN_POINT_RADIUS', has(new RegExp(`isWithinDistance\\(new Vec3d\\([\\s\\S]*?\\), ${T.SPAWN_POINT_RADIUS}\\.0\\)`))],
    ['MUSHROOM_SKIP', has(new RegExp(`nextFloat\\(\\) < ${T.MUSHROOM_SKIP}F`))],
    ['RARE_PERIOD', /getTime\(\) % 400L == 0L/.test(readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/server/world/ServerChunkManager.java'), 'utf8')) && T.RARE_PERIOD === 400],
    ['DEFAULT_LIMIT', /public int getLimitPerChunk\(\) \{\s*return 4;/.test(readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/entity/mob/MobEntity.java'), 'utf8')) && T.DEFAULT_LIMIT_PER_CHUNK === 4],
  ].filter((r) => !r[1]).map((r) => r[0]);
};
{
  const bad = literalsOk(Sp.TRAVERSAL, SRC);
  ok(bad.length === 0, `TRAVERSAL literals not in the decomp: ${bad.join(',')}`);
  for (const k of ['TRIES', 'JITTER', 'MIN_PLAYER_DIST2', 'SPAWN_POINT_RADIUS', 'PACK_RANDOM_MAX']) {
    const T = Object.assign({}, Sp.TRAVERSAL, { [k]: Sp.TRAVERSAL[k] + 1 });
    okAv(literalsOk(T, SRC).includes(k), `a TRAVERSAL.${k} off by one is caught by the decomp re-read`);
  }
  // limit-per-chunk table: each override's literal, from its own class file
  const lim = (cls, re) => re.test(readFileSync(join(MCLITE_ROOT, `.decomp/net/minecraft/entity/${cls}.java`), 'utf8'));
  ok(lim('passive/WolfEntity', /getLimitPerChunk\(\) \{\s*return 8;/) && Sp.limitPerChunk('wolf') === 8, 'wolf limit 8');
  ok(lim('passive/HorseBaseEntity', /getLimitPerChunk\(\) \{\s*return 6;/) && Sp.limitPerChunk('horse') === 6, 'horse limit 6');
  ok(lim('mob/PillagerEntity', /getLimitPerChunk\(\) \{\s*return 1;/) && Sp.limitPerChunk('pillager') === 1, 'pillager limit 1');
  ok(lim('passive/SalmonEntity', /getMaxGroupSize\(\) \{\s*return 5;/) && Sp.limitPerChunk('salmon') === 5, 'salmon limit 5');
  ok(Sp.limitPerChunk('zombie') === 4 && Sp.limitPerChunk('cod') === 8, 'default 4, cod (FishEntity 8)');
  ok(Sp.spawnableFarFromPlayer('cow') && Sp.spawnableFarFromPlayer('pillager') && !Sp.spawnableFarFromPlayer('zombie'),
    'isSpawnableFarFromPlayer: creature + pillager yes, zombie no');
}
say(`   ${pass} ok`);

// ── 2. the RNG-sequence oracle ───────────────────────────────────────────────────────────────
say('\n2. spawnForChunk vs an independent transcription of spawnEntitiesInChunk, draw for draw');
// hand-built world: chunks -1..1, a lit grass floor at y=60 (everything else air), player far away
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.getOrCreate(cx, cz);
  c.state = CH.GENERATED;
  c.biome = new Uint8Array(256).fill(PLAINS);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    const gx = cx * 16 + x, gz = cz * 16 + z;
    W.setBlock(gx, 60, gz, GRASS);
    c.hmap[z * 16 + x] = 60 - CFG.WORLD_MIN_Y;
    W.setLight(gx, CFG.WORLD_MAX_Y - 1, gz, (15 << 4) | 0);
    L.seed(gx, CFG.WORLD_MAX_Y - 1, gz, 15, L.SKY);
  }
  L.queueBorder(cx, cz);
}
ok(L.settle(8000), 'the platform settled');
W.camCx = 0; W.camCz = 0;
const P = { x: -20.5, y: 61, z: -20.5 };
M.Player = P;
ok(Sp.checkPlacement('cow', 0, 61, 0), 'a cow may spawn on the lit platform');

const BOTTOM = CFG.WORLD_MIN_Y;
// seeded stream; the height draw lands on the y=61 layer half the time so packs actually happen
function stream(seed, log) {
  let s = seed >>> 0;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return {
    nextInt(b) { let v = Math.floor(next() * b); if (b === 127 && next() < 0.5) v = 125; log.push('i' + b); return v; },
    nextFloat() { log.push('f'); return next(); }
  };
}
function oracle(cx, cz, cat, rng, spawnPt, TR) {
  const out = [];
  const list = (B.spawners(W.biomeAt(cx * 16, cz * 16)) || {})[cat] || [];
  const sx = cx * 16 + rng.nextInt(16), sz = cz * 16 + rng.nextInt(16);
  const sy = BOTTOM + rng.nextInt((60 + 1 + 1) - BOTTOM + 1);           // heightmap first-free 61, +1
  if (sy < BOTTOM + 1) return out;
  if (sy === 60) return out;                                            // the grass floor is the only solid cell
  let made = 0;
  for (let t = 0; t < TR.TRIES; t++) {
    let x = sx, z = sz, entry = null, n = Math.ceil(Math.fround(rng.nextFloat() * TR.PACK_RANDOM_MAX));
    for (let k = 0; k < n; k++) {
      x += rng.nextInt(TR.JITTER) - rng.nextInt(TR.JITTER);
      z += rng.nextInt(TR.JITTER) - rng.nextInt(TR.JITTER);
      const px = x + 0.5, pz = z + 0.5;
      const d2 = (P.x - px) ** 2 + (P.y - sy) ** 2 + (P.z - pz) ** 2;
      if (d2 <= TR.MIN_PLAYER_DIST2) continue;
      if (spawnPt && (spawnPt.x - px) ** 2 + (spawnPt.y - sy) ** 2 + (spawnPt.z - pz) ** 2 < TR.SPAWN_POINT_RADIUS ** 2) continue;
      const loaded = x >= -16 && x < 32 && z >= -16 && z < 32;
      if (!loaded) continue;
      if (!(((x >> 4) === cx && (z >> 4) === cz) || W.tickingAt(x, z))) continue;
      if (!entry) {
        if (!list.length) break;
        let tot = 0; for (const e of list) tot += e.weight;
        let r = rng.nextInt(tot);
        entry = list.find((e) => (r -= e.weight) < 0);
        n = entry.minCount + rng.nextInt(1 + entry.maxCount - entry.minCount);
      }
      const type = entry.type.replace('minecraft:', '');
      if (!EL.canSpawn(type) || !Sp.canPlace(type)) continue;
      if (!Sp.checkPlacement(type, x, sy, z, 'natural', (b) => rng.nextInt(b))) continue;
      rng.nextFloat();
      out.push(type + '@' + x + ',' + sy + ',' + z);
      EL.list.push({ type, x: px, y: sy, z: pz });   // #6789: a placed pack member is an entity the next isSpaceEmpty sees
      made++;
      if (made >= ({ wolf: 8, horse: 6, donkey: 6 }[type] || 4)) return out;
    }
  }
  return out;
}
const run = (seed, cx, cz, cat, spawnPt, TR) => {
  const la = [], lb = [];
  const info = Sp.setupInfo(); info.chunkCount = 289;            // cap is not under test here
  EL.clear();
  Sp.spawnForChunk(cx, cz, cat, { rng: stream(seed, la), info });
  const eng = EL.list.filter((e) => !e.removed).map((e) => e.type.replace('minecraft:', '') + '@' + Math.floor(e.x) + ',' + Math.floor(e.y) + ',' + Math.floor(e.z));
  EL.clear();
  const orc = oracle(cx, cz, cat, stream(seed, lb), spawnPt, TR);
  return { same: la.join() === lb.join() && eng.join() === orc.join(), n: eng.length, draws: la.length };
};
const SEEDS = 4000;
const sweep = (spawnPt, TR) => {
  let mism = 0, placed = 0, total = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const cx = (s % 3) - 1, cz = (Math.floor(s / 3) % 3) - 1;
    const r = run(s * 7919, cx, cz, 'creature', spawnPt, TR);
    if (!r.same) mism++;
    placed += r.n; total += r.draws;
  }
  return { mism, placed, total };
};
{
  const a = sweep(null, Sp.TRAVERSAL);
  ok(a.mism === 0, `${a.mism}/${SEEDS} seeds diverged from the oracle (no world spawn)`);
  ok(a.placed > 200, `the sweep actually placed mobs (${a.placed}) — else equal logs prove little`);
  M.Commands = { worldSpawn: { x: 10, y: 61, z: 10 } };
  const b = sweep(M.Commands.worldSpawn, Sp.TRAVERSAL);
  ok(b.mism === 0, `${b.mism}/${SEEDS} seeds diverged with a world spawn at (10,61,10)`);
  ok(b.placed < a.placed, `the 24-block spawn-point ring removes placements (${a.placed} -> ${b.placed})`);
  // anti-vacuity: mutate ONE oracle-visible rule at a time on the ENGINE side; the oracle must disagree
  const T0 = Object.assign({}, Sp.TRAVERSAL);
  for (const [k, v] of [['JITTER', 5], ['TRIES', 2], ['MIN_PLAYER_DIST2', 900], ['SPAWN_POINT_RADIUS', 12], ['PACK_RANDOM_MAX', 3]]) {
    Sp.TRAVERSAL[k] = v;
    const m = sweep(M.Commands.worldSpawn, T0);
    Sp.TRAVERSAL[k] = T0[k];
    okAv(m.mism > 0, `engine ${k}=${v} vs the oracle's ${T0[k]}: ${m.mism} seeds diverge`);
  }
  M.Commands = null;
  // #6791: no /setworldspawn - the save's level spawn takes over, so the ring is still active
  M.Save = M.Save || {};
  M.Save.worldSpawn = { x: 10, y: 61, z: 10 };
  ok(Sp.worldSpawn() === M.Save.worldSpawn, 'Spawn.worldSpawn reads the save level spawn when /setworldspawn never ran');
  const c = sweep(M.Save.worldSpawn, Sp.TRAVERSAL);
  ok(c.mism === 0 && c.placed < a.placed, `level-spawn ring active on a fresh world (${a.placed} -> ${c.placed})`);
  M.Save.worldSpawn = null;
  okAv(Sp.worldSpawn() === null, 'worldSpawn null (the pre-fix state) is detected: the ring is gone');
}
say(`   ${pass} ok`);

// ── 3. draw order at the top of the traversal, pinned literally ──────────────────────────────
say('\n3. the first draws: x, z, then nextBetween(bottom, top) — and a solid start cell ends the call');
{
  const log = [];
  const rng = { nextInt(b) { log.push('i' + b); return b === 16 ? 5 : 1; }, nextFloat() { log.push('f'); return 0.5; } };
  EL.clear();
  const n = Sp.spawnForChunk(0, 0, 'creature', { rng, info: Sp.setupInfo() });
  // height 60 -> sampleHeightmap 61, +1 = 62; nextBetween(-64, 62) = nextInt(127) + -64 -> 1-64 = -63 (< bottom+1? -63 = bottom+1: proceeds)
  ok(log.slice(0, 3).join() === 'i16,i16,i127', `top draws were ${log.slice(0, 3).join()}`);
  ok(n === 0, 'nothing placed from an air cell in the void with no acceptable candidate');
  const log2 = [];
  const rng2 = { nextInt(b) { log2.push('i' + b); return b === 127 ? 0 : 3; }, nextFloat() { log2.push('f'); return 0; } };
  Sp.spawnForChunk(0, 0, 'creature', { rng: rng2, info: Sp.setupInfo() });
  ok(log2.join() === 'i16,i16,i127', `y == bottom exits after 3 draws (${log2.join()})`);
}
say(`   ${pass} ok`);

// ── 4. SpawnHelper.Info: GravityField + spawn_costs ──────────────────────────────────────────
say('\n4. Info.test / GravityField / biome spawn_costs');
{
  const GF = Sp.GravityField;
  const g = new GF();
  g.addPoint(3, 0, 4, 2);                                   // mass 2 at distance 5
  g.addPoint(0, 0, 0, 0);                                   // mass 0 is never stored
  ok(g.points.length === 1, 'addPoint(mass 0) stores nothing (GravityField.addPoint)');
  ok(Math.abs(g.calculate(0, 0, 0, 3) - 3 * (2 / 5)) < 1e-12, 'calculate = mass * sum(m/sqrt(d2)) = 1.2');
  ok(g.calculate(0, 0, 0, 0) === 0, 'candidate mass 0 -> 0');
  g.addPoint(0, 0, 0, 1);
  ok(g.calculate(0, 0, 0, 1) === Infinity, 'a point on the cell itself -> +Infinity');
  // spawn_costs carried per biome match the biome json, for all biomes
  let checked = 0, bad = 0;
  for (let i = 0; i < B.count; i++) {
    const costs = B.spawnCosts(i);
    for (const k of Object.keys(costs)) {
      checked++;
      const saved = W.biomeAt; W.biomeAt = () => i;
      const d = Sp.spawnDensity(k.replace('minecraft:', ''), 0, 0);
      W.biomeAt = saved;
      if (!d || d.limit !== costs[k].energy_budget || d.mass !== costs[k].charge) bad++;
    }
  }
  ok(checked > 0 && bad === 0, `${checked} biome spawn_costs entries resolve to (energy_budget, charge); ${bad} bad`);
  // Info.test: 0.7 budget, 0.15 charge -> k neighbours at distance 1: 0.0225 k <= 0.7 passes up to k = 31
  const realBiomeAt = W.biomeAt, realCosts = B.spawnCosts;
  W.biomeAt = () => 0; B.spawnCosts = () => ({ 'minecraft:skeleton': { energy_budget: 0.7, charge: 0.15 } });
  const passesWith = (k) => {
    const info = { chunkCount: 289, counts: {}, field: new GF() };
    for (let i = 0; i < k; i++) info.field.addPoint(1, 0, 0, 0.15);
    return Sp.infoTest(info, 'skeleton', 0, 0, 0);
  };
  ok(passesWith(31) && !passesWith(32), 'the energy budget cuts at 32 neighbours (0.0225 * 32 = 0.72 > 0.7)');
  ok(Sp.infoTest({ field: new GF() }, 'zombie', 0, 0, 0), 'a type with no spawn_costs entry always passes');
  B.spawnCosts = () => ({ 'minecraft:skeleton': { energy_budget: 0.8, charge: 0.15 } });
  okAv(passesWith(32), 'anti-vacuity: with the budget raised to 0.8 the same 32 neighbours pass');
  W.biomeAt = realBiomeAt; B.spawnCosts = realCosts;
}
say(`   ${pass} ok`);

say('');
say('================= spawntravcheck =================');
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` breaks caught ...... ${breaks}`);
say('==================================================');
for (const f of fails) say('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
