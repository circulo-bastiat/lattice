#!/usr/bin/env node
// spawnoceancheck.mjs — #1495: land animals must never be placed over water / in the ocean, on the REAL generator.
//
//   node tools/spawnoceancheck.mjs [--verbose]
//
// #1161 closed on spawnfloorcheck (a toy 3x3 world); Dan still saw pigs in the sea. This audits every path that
// places a CREATURE-group animal, over REAL generated windows (open warm/lukewarm ocean, shorelines, beaches,
// islands, rivers, land), through the game's own hooks:
//   1. biome data: no ocean/river biome's `creature` spawn list carries a land animal (frozen oceans: polar bear
//      only; beach: turtle only -- vanilla's lists, read from the engine's biome table)
//   2. chunk generation: `World.installChunk` -> `Spawn.onChunkInstalled` -> `populateChunk` (SpawnHelper.populateEntities)
//   3. the natural tick's `Spawn.spawnForChunk` (creature group), with a player placed outside the 24-block ring
//   4. STRESS: every ocean/river biome is handed the PLAINS creature list, so the floor/location gates are what stand
//      between a pig and the sea (a data-only fix cannot pass this): both paths must still place zero over water
//   5. (structure-template entities are listed by the generator; the real windows are audited after installChunk spawns them)
//   Oracle (independent of the engine's gates): an animal's feet cell and the cell under it hold no fluid, and
//   the cell under it is a solid block (not air, not ice unless a polar bear).
//   6. anti-vacuity: neutralise the gates (locationOk/floorAllows/RULES) under the stress lists -> the oracle MUST
//      find animals over water; a cow in an ocean list MUST trip the data audit.
//   7. THE ACTUAL BUG: no spawn path does it -- the animals WALKED into the water and could not get out. Real windows,
//      populated in ring order at install, then 4000 EntityList ticks: no animal ends in/over water, none dies. Breaks:
//      the old plain stroll (no WanderAroundFarGoal), no 0.3 water wall hop, no onLanding-in-water (fall damage).

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

console.log('spawnoceancheck — #1495, no land animal over water: real generator, every placement path');

const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07c_blockentity.js', '09b_sky.js',
  '14j_combat.js', '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js', '07m_breed.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
const { Gen: G, World: W, Light: L, Biomes: B, EntityList: EL, Spawn, States: S, Reg: R } = M;

// ── 1. biome data ──────────────────────────────────────────────────────────────────────────────
const biomeNames = [];
for (let i = 0; ; i++) { let n; try { n = B.name(i); } catch { break; } if (!n) break; biomeNames.push(n.replace('minecraft:', '')); }
const WET = /ocean|river/;
const creatureTypes = (i) => ((B.spawners(i) || {}).creature || []).map((e) => e.type.replace('minecraft:', ''));
function listAudit() {
  const bad = [];
  biomeNames.forEach((n, i) => {
    const t = creatureTypes(i);
    if (WET.test(n) && t.some((x) => !(x === 'polar_bear' && /frozen_ocean/.test(n)))) bad.push(n + ': ' + t.join(','));
    if (n === 'beach' && t.some((x) => x !== 'turtle')) bad.push(n + ': ' + t.join(','));
  });
  return bad;
}
ok(biomeNames.length > 40, 'the engine biome table is loaded (' + biomeNames.length + ' biomes)');
ok(biomeNames.filter((n) => /ocean/.test(n)).length >= 7, 'the ocean biomes are in the table');
{ const bad = listAudit(); ok(bad.length === 0, 'an ocean/river biome spawns land animals: ' + bad.join(' | ')); }

// ── real windows: [seed, centre block x, centre block z, radius in chunks] ─────────────────────
const WINDOWS = [[4, 0, 0, 3], [7, 0, 0, 3], [1, -3744, -672, 6], [2, -288, -1568, 6], [5, -800, -288, 6], [11, 0, 0, 5]];
const eachChunk = (win, f) => { const [, bx, bz, r] = win, c0x = bx >> 4, c0z = bz >> 4; for (let cx = c0x - r; cx <= c0x + r; cx++) for (let cz = c0z - r; cz <= c0z + r; cz++) f(cx, cz); };

const plainsIdx = biomeNames.indexOf('plains');
const plainsList = (B.spawners(plainsIdx) || {}).creature || [];
ok(plainsList.length >= 3, 'plains carries a creature list to stress the ocean with');
const origLists = new Map();
function stress(on) {
  biomeNames.forEach((n, i) => {
    if (!WET.test(n)) return;
    const sp = B.spawners(i);
    if (on) { if (!origLists.has(i)) origLists.set(i, sp.creature); sp.creature = plainsList; }
    else if (origLists.has(i)) sp.creature = origLists.get(i);
  });
}

// The oracle: feet over water / over nothing / over non-solid / on ice (not a polar bear).
function violation(e) {
  const x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z);
  const here = W.getBlock(x, y, z), below = W.getBlock(x, y - 1, z);
  if (here && S.waterIn[here]) return 'feet in water';
  if (!below) return 'over air';
  if (S.waterIn[below]) return 'over water';
  const nm = R.names[S.block[below]];
  if ((nm === 'ice' || nm === 'frosted_ice') && e.type !== 'polar_bear') return 'on ice';
  if (S.solid[below] !== 1 && !/_leaves$/.test(nm)) return 'over a non-solid (' + nm + ')';
  return null;
}
const isLandAnimal = (e) => Spawn.categoryOf(e.type) === 'creature';

function build(win) {
  const [seed] = win;
  W.init(seed); G.init(seed, G.defaults()); L.init(); M.Behave.init(W); EL.init(); Spawn.init();
  if (M.Save) M.Save.loaded = false;
  Spawn.POPULATE = false;                       // generate the window first so every chunk sees its neighbours
  let structEnts = 0;
  eachChunk(win, (cx, cz) => {
    const col = getCachedColumn(M, cx, cz);
    W.installChunk(cx, cz, { sec: col.sec, hmap: col.hmap, biome: col.biome });
    if (col.entities) structEnts += col.entities.length;
  });
  return structEnts;
}

const tally = { placed: 0, byPath: { populate: 0, natural: 0 }, wetChunks: 0, viol: {} };
function audit(path, ents, stressed) {
  for (const e of ents) {
    if (!isLandAnimal(e)) continue;
    tally.placed++; tally.byPath[path]++;
    const v = violation(e);
    if (v) { const k = path + (stressed ? '[stress]' : '') + ' ' + e.type + ' ' + v; tally.viol[k] = (tally.viol[k] || 0) + 1; }
  }
}

// ── 2+3. the unmodified biome lists ────────────────────────────────────────────────────────────
// Violations are measured while the window's world is still resident, so audit inside the loop.
// Every run draws from the same seeded stream (Spawn.randInt/defaultRng and the AI read Math.random), so the
// base-vs-stress comparison and the tick section are reproducible rather than a coin toss.
const realRandom = Math.random;
function seedRandom(s) { Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }
function runAudited(stressed) {
  seedRandom(1495);
  tally.viol = {}; tally.placed = 0; tally.byPath = { populate: 0, natural: 0 }; tally.wetChunks = 0;
  let wetCols = 0, structEnts = 0;
  for (const win of WINDOWS) {
    structEnts += build(win);
    EL.clear(); Spawn.populated = new Set(); Spawn.POPULATE = true;
    eachChunk(win, (cx, cz) => {
      if (WET.test(biomeNames[W.biomeAt(cx << 4, cz << 4)] || '')) tally.wetChunks++;
      Spawn.onChunkInstalled(cx, cz);
    });
    audit('populate', EL.all(), stressed);
    EL.clear();
    M.Player = M.Player || {};
    eachChunk(win, (cx, cz) => {
      M.Player.x = cx * 16 + 8 + 40; M.Player.y = 64; M.Player.z = cz * 16 + 8;
      for (let rep = 0; rep < 10; rep++) Spawn.spawnForChunk(cx, cz, 'creature', { info: Spawn.setupInfo() });
    });
    audit('natural', EL.all(), stressed);
    EL.clear();
  }
  return { viol: Object.values(tally.viol).reduce((a, v) => a + v, 0), detail: { ...tally.viol }, placed: tally.placed, byPath: { ...tally.byPath }, wetChunks: tally.wetChunks, structEnts };
}

const base = runAudited(false);
say(`unstressed: ${JSON.stringify(base)}`);
ok(base.wetChunks >= 150, `the windows hold real ocean/river chunks (${base.wetChunks}, need >= 150)`);
ok(base.placed >= 20, `land animals really were placed on the real terrain (${base.placed}, need >= 20) -- not a vacuous pass`);
ok(base.byPath.populate >= 10 && base.byPath.natural >= 5, `both paths placed animals (populate ${base.byPath.populate}, natural ${base.byPath.natural})`);
ok(base.viol === 0, 'unmodified lists: land animals over water/air/ice: ' + JSON.stringify(base.detail));

// ── 4. stress: the plains list on every ocean/river biome ──────────────────────────────────────
stress(true);
const stressed = runAudited(true);
say(`stressed: ${JSON.stringify(stressed)}`);
// not >= base: the stress lists change the RNG stream and the placement gates reject water cells, so the count drifts with spawn changes
ok(stressed.placed >= Math.floor(base.placed * 0.5), `the stress lists really offer animals to the ocean chunks (${stressed.placed} placed vs ${base.placed})`);
ok(stressed.viol === 0, 'plains list on every ocean/river biome, gates intact: land animals over water/air/ice: ' + JSON.stringify(stressed.detail));

// ── 6. anti-vacuity ────────────────────────────────────────────────────────────────────────────
{
  const rLoc = Spawn.locationOk, rFloor = Spawn.floorAllows, rRules = {};
  Spawn.locationOk = () => true;
  Spawn.floorAllows = () => true;
  for (const t of ['cow', 'pig', 'sheep', 'chicken', 'horse', 'rabbit', 'fox', 'wolf']) { rRules[t] = Spawn.RULES[t]; Spawn.RULES[t] = () => true; }
  const brokenAll = runAudited(true);
  okAv(brokenAll.viol > 0, `gates removed (the old behaviour): ${brokenAll.viol} land animals over water/air are found`);
  Spawn.locationOk = rLoc; Spawn.floorAllows = rFloor;
  for (const t in rRules) Spawn.RULES[t] = rRules[t];
  const again = runAudited(true);
  ok(again.viol === 0, 'restored: the stressed run is clean again');
}
stress(false);
{
  const fx = biomeNames.indexOf('warm_ocean');
  const sp = B.spawners(fx), real = sp.creature;
  sp.creature = [{ type: 'minecraft:cow', weight: 8, minCount: 4, maxCount: 4 }];
  okAv(listAudit().length > 0, 'a cow in the warm_ocean creature list trips the biome-data audit');
  sp.creature = real;
  ok(listAudit().length === 0, 'restored: biome lists clean again');
}
{
  // the oracle itself: a pig floating over a water cell is a violation, a pig on stone is not
  build(WINDOWS[0]);
  let wx = null, wz = null;
  for (let x = -40; x < 40 && wx === null; x++) for (let z = -40; z < 40; z++) { const h = W.heightAt(x, z); if (S.waterIn[W.getBlock(x, h, z)]) { wx = x; wz = z; break; } }
  ok(wx !== null, 'found a water column to test the oracle on');
  if (wx !== null) {
    const h = W.heightAt(wx, wz);
    okAv(violation({ type: 'pig', x: wx + 0.5, y: h + 1, z: wz + 0.5 }) === 'over water', 'oracle: a pig on the water surface is a violation');
    okAv(violation({ type: 'pig', x: wx + 0.5, y: h, z: wz + 0.5 }) === 'feet in water', 'oracle: a pig with its feet in the water is a violation');
  }
}

// ── 7. AFTER the spawn: real ticks (the repro the spawn audit above could not make) ─────────────
// No spawn path puts a pig in the sea; the AI walked it there and it could not get out. Each window is installed
// in ring order with population ON at install (the game's own order), then EntityList.tick()s 4000 ticks with every
// animal's despawnCounter held at 0 (a player standing by: WanderAroundGoal refuses at >= 100, vanilla's rule).
// Three causes, each with its own break:
//   a. Ai.WanderAroundFarGoal: farm animals ran the plain 2..9-block stroll, with no in-water FuzzyTargeting(15,7),
//      no opaque-floor test and no AnimalEntity grass favor -> chickens/pigs drift out along rivers and shores.
//   b. Ph.travelMob's water branch had no `LivingEntity.travel` 0.3 wall hop -> an animal at a 1-block bank is stuck.
//   c. EL.tickMob had no `checkWaterState` onLanding -> a mob bobbing in shallow water dies of FALL damage.
const TICK_WINDOWS = [[1, -3744, -672, 5], [2, -288, -1568, 5], [5, -800, -288, 5]];
const TICKS = 4000;
const wetAt = (e) => {
  const x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z), h = W.getBlock(x, y, z), b = W.getBlock(x, y - 1, z);
  return !!((h && S.waterIn[h]) || (b && S.waterIn[b]));
};
function ticked() {
  const out = { animals: 0, wet: 0, died: 0, where: [] };
  seedRandom(1495);
  try {
    for (const [seed, bx, bz, r] of TICK_WINDOWS) {
      W.init(seed); G.init(seed, G.defaults()); L.init(); M.Behave.init(W); EL.init(); M.Ai.init(); Spawn.init(); Spawn.POPULATE = true;
      if (M.Save) M.Save.loaded = false;
      M.Player = { x: bx + 0.5, y: 80, z: bz + 0.5, yaw: 0, pitch: 0, vx: 0, vz: 0, onGround: true, inWater: false, gamemode: 'creative' };
      const c0x = bx >> 4, c0z = bz >> 4, ring = [];
      W.camCx = c0x; W.camCz = c0z;
      for (let cx = c0x - r; cx <= c0x + r; cx++) for (let cz = c0z - r; cz <= c0z + r; cz++) ring.push([cx, cz]);
      ring.sort((a, b) => Math.max(Math.abs(a[0] - c0x), Math.abs(a[1] - c0z)) - Math.max(Math.abs(b[0] - c0x), Math.abs(b[1] - c0z)));
      for (const [cx, cz] of ring) { const col = getCachedColumn(M, cx, cz); W.installChunk(cx, cz, { sec: col.sec, hmap: col.hmap, biome: col.biome }); }
      const herd = EL.all().filter(isLandAnimal);
      out.animals += herd.length;
      for (let t = 0; t < TICKS; t++) { for (const e of EL.list) e.despawnCounter = 0; EL.tick(); }
      for (const e of herd) {
        if (e.removed || e.dead) { out.died++; continue; }
        // the ring's outer chunk borders unloaded void: an animal swimming there is a harness edge, not a placement bug
        const ecx = Math.floor(e.x) >> 4, ecz = Math.floor(e.z) >> 4;
        if (Math.max(Math.abs(ecx - c0x), Math.abs(ecz - c0z)) >= r) continue;
        if (wetAt(e)) { out.wet++; out.where.push(`${e.type}@${e.x.toFixed(0)},${e.y.toFixed(0)},${e.z.toFixed(0)} ${B.name(W.biomeAt(Math.floor(e.x), Math.floor(e.z)))}`); }
      }
    }
  } finally { Math.random = realRandom; }
  return out;
}
{
  const fine = ticked();
  say(`ticked: ${JSON.stringify(fine)}`);
  ok(fine.animals >= 40, `the tick windows hold real herds (${fine.animals} land animals, need >= 40)`);
  ok(fine.wet === 0, `after ${TICKS} ticks no land animal is in/over water: ${fine.wet} ${fine.where.slice(0, 4).join(' | ')}`);
  ok(fine.died === 0, `after ${TICKS} ticks no land animal died (${fine.died})`);

  const realWander = M.Ai.WanderAroundFarGoal;
  M.Ai.WanderAroundFarGoal = function (e, speed, rand) { return new M.Ai.WaterAvoidingRandomStrollGoal(e, speed, rand); };
  const a = ticked();
  M.Ai.WanderAroundFarGoal = realWander;
  okAv(a.wet > 0, `the old plain stroll on the farm animals: ${a.wet} end up in the water (${a.where.slice(0, 2).join(' | ')})`);

  const hop = M.Physics.MOB_WATER_HOP;
  M.Physics.MOB_WATER_HOP = 0;
  const b = ticked();
  okAv(b.wet > 0, `no water wall hop: ${b.wet} animals stuck against a bank (${b.where.slice(0, 2).join(' | ')})`);
  ok(b.died === 0, 'no wall hop but onLanding in water: the stuck animals still live');
  EL.WATER_LANDS = false;
  const c = ticked();
  EL.WATER_LANDS = true;
  M.Physics.MOB_WATER_HOP = hop;
  okAv(c.died > 0, `no onLanding in water (and stuck): ${c.died} animals die of fall damage while swimming`);
}

console.log(`   checks: ${pass} assertions, 0 failed, ${breaks} breaks caught`);
if (fails.length) { console.log('FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log(`OK    ${pass} assertions · ${breaks} breaks caught`);
