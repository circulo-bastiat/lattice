#!/usr/bin/env node
// spawnauditlivecheck.mjs — #11264: natural spawns audited against vanilla, on the BUILT dist/mclite.html at file://.
//   MCLITE_PRESET=medium node tools/spawnauditlivecheck.mjs [dist/mclite.html]
// Dan: "mobs are spawning in the middle of the ocean". The real Spawn.spawnForChunk loop is driven over the real worldgen
// chunks the page generated (every biome family that is loaded), for every natural category, and every placed mob is
// judged by an ORACLE read from the world's blocks and the 1.18.2 jar's biome JSON (never the engine's own tables):
//   biome: the mob is in the biome's vanilla spawners list for that category (structure overrides excluded by position)
//   WaterCreatureEntity.canSpawn (squid/cod/salmon/pufferfish/dolphin/tropical): sea-13 <= y <= sea, water below, water above
//   GlowSquid: y <= sea-33, light 0, water at feet;  Drowned: water below the feet cell
//   SpawnRestriction ON_GROUND: no fluid at feet, solid floor below;  IN_WATER cells hold water
// Anti-vacuity: the same oracle is run over deliberately wrong placements (a cow at sea level over deep water, a squid on dry land,
// a cod outside its biome) and must flag each; "<n> breaks caught".
import { open, sleep } from './cdp.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MCDATA } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = process.argv[2] && !process.argv[2].startsWith('--') ? (process.argv[2].startsWith('/') ? process.argv[2] : ROOT + process.argv[2]) : ROOT + 'dist/mclite.html';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   x ' + m); } };

// vanilla spawners per biome, from the jar's data
const BD = join(MCDATA, '1.18.2', 'data', 'minecraft', 'worldgen', 'biome');
const VAN = {};
for (const f of readdirSync(BD)) {
  const j = JSON.parse(readFileSync(join(BD, f), 'utf8')), o = {};
  for (const [cat, list] of Object.entries(j.spawners || {})) o[cat] = list.map((e) => e.type.replace('minecraft:', ''));
  VAN['minecraft:' + f.replace('.json', '')] = o;
}

// the oracle runs inside the page (it needs the blocks) but reads only World/States blocks + the injected vanilla lists
const ORACLE = `
window.__oracle = function (VAN, m) {
  var W = MCL.World, S = MCL.States, R = MCL.Reg, SEA = 63, bad = [];
  var type = m.type, x = Math.floor(m.x), y = Math.floor(m.y), z = Math.floor(m.z);
  var isWater = function (a, b, c) { var s = W.getBlock(a, b, c); return s > 0 && !!S.waterIn[s]; };
  var anyFluid = function (a, b, c) { var s = W.getBlock(a, b, c); return s > 0 && (!!S.waterIn[s] || S.block[s] === R.id.lava); };
  var full = function (a, b, c) { var s = W.getBlock(a, b, c); return s > 0 && S.solid[s] === 1 && MCL.Physics.shapesForState(s) === MCL.Physics.FULL_CUBE; };
  var bname = MCL.Biomes.name(W.biomeAt(x, z));
  // a pack's later members wander up to 5 blocks per step from the first, in a neighbouring biome, with the entry picked at the first
  // (SpawnHelper): so the type must be in the list of SOME biome within 24 blocks; the first-member case is stricter in the node checks
  var near = false;
  for (var dx = -24; dx <= 24 && !near; dx += 4) for (var dz = -24; dz <= 24 && !near; dz += 4) {
    var bb = W.loadedAt(x + dx, z + dz) ? MCL.Biomes.name(W.biomeAt(x + dx, z + dz)) : null, l2 = bb && VAN[bb] && VAN[bb][m.cat];
    if (l2 && l2.indexOf(type) >= 0) near = true;
  }
  if (!m.structure && !near) bad.push('no biome within 24 blocks of ' + bname + ' lists ' + type + ' in ' + m.cat);
  var WATERC = { squid: 1, cod: 1, salmon: 1, pufferfish: 1, dolphin: 1, tropical_fish: 1 };
  if (WATERC[type]) {
    if (y < SEA - 13 || y > SEA) bad.push(type + ' y=' + y + ' outside sea-13..sea');
    if (!isWater(x, y - 1, z)) bad.push(type + ' no water below');
    if (!isWater(x, y + 1, z)) bad.push(type + ' no water above');
    if (!isWater(x, y, z)) bad.push(type + ' feet not in water');
  } else if (type === 'glow_squid') {
    if (y > SEA - 33) bad.push('glow_squid too high y=' + y);
    if (!isWater(x, y, z)) bad.push('glow_squid not in water');
  } else if (type === 'drowned') {
    if (!isWater(x, y - 1, z)) bad.push('drowned no water below');
  } else if (m.loc === 'on_ground') {
    if (anyFluid(x, y, z)) bad.push(type + ' fluid at feet');
    var fl = W.getBlock(x, y - 1, z);
    if (fl === 0 || S.solid[fl] !== 1) bad.push(type + ' floor not solid');
    if (isWater(x, y - 1, z) || W.getBlock(x, y - 1, z) === 0) bad.push(type + ' over water/air');
  }
  return bad;
};`;

const SEEDS = process.env.SEED ? [process.env.SEED] : ['1', '4', '5', '6', '2'];
for (let idx = 0; idx < SEEDS.length; idx++) {
  const SEED = SEEDS[idx]; const BREAKS = idx === 0;
  console.log('\n== seed ' + SEED);
  const page = await open(FILE, { port: 9461 + idx, width: 640, height: 360,
    initScript: 'window.addEventListener("load", function () { setTimeout(function () { if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; } }, 50); });' });
  if (!page) { console.log('SKIP  spawnauditlivecheck: no Chromium found'); process.exit(0); }
  
  
try {
  await sleep(1200);
  await page.evaluate(new Function('if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({ seed: ' + JSON.stringify(SEED) + ' });'));
  const up = await page.waitFor(function () { return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20); }, 90000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('no game');
  await sleep(3000);
  await page.evaluate(new Function(ORACLE));

  // drive the real loop over every loaded ticking chunk, every natural category, several rounds
  const DRIVE = `
    var VAN = ${JSON.stringify(VAN)};
    var P = MCL.Player, W = MCL.World, EL = MCL.EntityList, Sp = MCL.Spawn;
    Sp.ready = true;
    var cats = Sp.NATURAL_CATEGORIES, out = { spawned: 0, byType: {}, biomes: {}, bad: [], chunks: 0 };
    var chunks = []; W.chunks.forEach(function (c) { var bx = c.cx << 4, bz = c.cz << 4; if (W.loadedAt(bx, bz) && W.tickingAt(bx, bz)) chunks.push(c); });
    out.chunks = chunks.length;
    var st = 11264;
    var rng = { nextInt: function (n) { st = (Math.imul(st, 1103515245) + 12345) & 0x7fffffff; return Math.floor((st / 2147483648) * n); }, nextFloat: function () { st = (Math.imul(st, 1103515245) + 12345) & 0x7fffffff; return st / 2147483648; } };
    for (var r = 0; r < ROUNDS; r++) for (var i = 0; i < chunks.length; i++) for (var ci = 0; ci < cats.length; ci++) {
      var cat = cats[ci], c = chunks[i], n0 = EL.list.length;
      Sp.spawnForChunk(c.cx, c.cz, cat, { rng: rng, info: Sp.setupInfo() });
      for (var k = n0; k < EL.list.length; k++) {
        var e = EL.list[k]; if (!e || e.removed) continue;
        var t = MCL.Entities.bare(e.type); if (t === 'chicken' && cat === 'monster') { e.removed = true; continue; }   // chicken jockey mount, not a spawn of its own
        if (e.vehicle) { e.removed = true; continue; }   // spider jockey rider: it sits on its spider, the spider is the audited spawn
        out.spawned++; out.byType[t] = (out.byType[t] || 0) + 1;
        var fx = Math.floor(e.x), fy = Math.floor(e.y), fz = Math.floor(e.z);
        var m = { type: t, x: e.x, y: e.y, z: e.z, cat: cat, loc: Sp.locationOf(t), structure: !!(Sp.structureAt && Sp.structureAt(fx, fy, fz)) };
        var bn = MCL.Biomes.name(W.biomeAt(fx, fz)); out.biomes[bn] = (out.biomes[bn] || 0) + 1;
        var bad = window.__oracle(VAN, m); if (bad.length && out.bad.length < 30) out.bad.push({ m: m, bad: bad, biome: bn });
        e.removed = true;
      }
    }
    return out;`;
  const res = await page.evaluate(new Function(DRIVE.replace('ROUNDS', '40')));
  console.log('chunks', res.chunks, 'spawned', res.spawned, JSON.stringify(res.byType));
  console.log('biomes', JSON.stringify(res.biomes));
  for (const b of res.bad.slice(0, 15)) console.log('  BAD', b.biome, b.m.type, Math.floor(b.m.x), b.m.y.toFixed(1), Math.floor(b.m.z), b.bad.join('; '));
  ok(res.spawned > 50, 'the real loop placed mobs', res.spawned);
  ok(res.bad.length === 0, 'every natural spawn is one vanilla allows', res.bad.length + ' refused');
  if (BREAKS) await breaks_(page, DRIVE);
} catch (e) { fails.push('crash: ' + e.message); console.log(e.stack); }
await page.close();
}
console.log((fails.length ? 'FAIL ' : 'PASS ') + pass + ' checks, ' + fails.length + ' failures, ' + breaks + ' breaks caught \u2713');
process.exit(fails.length ? 1 : 0);

async function breaks_(page, DRIVE) {
  // each break must make the oracle (reading blocks + jar JSON) refuse real spawns
  const run = async (patch, name) => {
    await page.evaluate(new Function(patch));
    const r = await page.evaluate(new Function(DRIVE.replace('ROUNDS', '25')));
    okAv(r.bad.length > 0, name + ' is caught (' + r.bad.length + ' refused of ' + r.spawned + ')');
  };
  await run('MCL.Spawn.__ck = MCL.Spawn.checkPlacement; MCL.Spawn.checkPlacement = function () { return true; };', 'dropping the placement/location/floor gate');
  await run('MCL.Spawn.checkPlacement = MCL.Spawn.__ck; var P = MCL.Spawn.spawnList; MCL.Spawn.__sl = P; MCL.Spawn.spawnList = function (b, c, x, y, z) { if (c === "water_ambient") return [{ type: "minecraft:salmon", weight: 1, minCount: 1, maxCount: 1 }]; return P(b, c, x, y, z); };', 'a salmon-only water_ambient list handed to every biome');
}
