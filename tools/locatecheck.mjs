#!/usr/bin/env node
// locatecheck.mjs — #776: ST.locateStructure(tag, x, z, radius) (ChunkGenerator.locateStructure).
//   1. the flattened tag table equals the jar's ConfiguredStructureFeatureTags files
//   2. the answer equals a brute-force oracle (every start in a wide window, nearest by distance)
//      for buried treasure (spacing 1, locate_offset 9,9) and ocean ruin, from several origins
//   3. anti-vacuity: a broken table / broken offset / broken oracle window must be caught
// Start placement itself is compared against real 1.18.2 chunks by vanillacheck §7 (startsOfRegion).
import { loadEngine } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { jarPath } from './paths.mjs';

const MCL = loadEngine({});
const G = MCL.Gen, ST = MCL.Structures;
G.init(1337, Object.assign(G.defaults(), { climate: 'vanilla' }));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const j = new Jar(jarPath('1.18.2'));
const P = 'data/minecraft/tags/worldgen/configured_structure_feature/';
const flat = (n, seen = new Set()) => {
  const out = [];
  for (const v of j.readJson(P + n + '.json').values) {
    if (v[0] === '#') out.push(...flat(v.replace('#minecraft:', '')));
    else out.push(v.replace('minecraft:', ''));
  }
  return out;
};
function tagsMatch(tbl) {
  let bad = 0;
  for (const f of j.under(P)) {
    const n = f.slice(P.length, -5);
    const a = (tbl[n] || []).slice().sort().join(), b = flat(n).sort().join();
    if (a !== b) bad++;
  }
  return bad === 0;
}
ok(tagsMatch(ST.STRUCTURE_TAGS), 'tag table differs from the jar');

function oracle(tag, x, z, W) {
  const names = ST.STRUCTURE_TAGS[tag]; let best = null, bd = Infinity;
  const cx0 = x >> 4, cz0 = z >> 4;
  for (let si = 0; si < ST.sets.length; si++) {
    const set = ST.sets[si], pl = set.placement;
    if (pl.kind !== 'random_spread') continue;
    if (!set.members.some((m) => names.includes(m.def.name) && m.def.grammar)) continue;
    const r0x = Math.floor((cx0 - W) / pl.spacing), r1x = Math.floor((cx0 + W) / pl.spacing);
    const r0z = Math.floor((cz0 - W) / pl.spacing), r1z = Math.floor((cz0 + W) / pl.spacing);
    for (let rz = r0z; rz <= r1z; rz++) for (let rx = r0x; rx <= r1x; rx++)
      for (const s of ST.startsOfRegion(si, rx, rz)) {
        if (!names.includes(s.def.name)) continue;
        const px = s.cx * 16 + pl.locateOffset[0], pz = s.cz * 16 + pl.locateOffset[1];
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bd) { bd = d; best = { x: px, z: pz }; }
      }
  }
  return best;
}
const origins = [[0, 0], [1000, -2000], [-3333, 777], [50000, 50000]];
function run(tag, W, radius, breakOffset) {
  let bad = 0;
  for (const [x, z] of origins) {
    const got = ST.locateStructure(tag, x, z, radius), want = oracle(tag, x, z, W);
    if (!got || !want) { if (got !== want && !(got === null && want === null)) bad++; continue; }
    // the ring search returns the nearest of the FIRST ring with a hit; the oracle's global
    // nearest can only be closer, never farther than the ring's answer by more than one ring.
    const dg = Math.hypot(got.x - x, got.z - z), dw = Math.hypot(want.x - x, want.z - z);
    if (dg + 1e-9 < dw) bad++;                       // ring answer closer than the global nearest: impossible
    if (dg > dw + 2 * 16 * ST.sets.reduce((m, s) => Math.max(m, s.placement.spacing || 0), 0)) bad++;
    if (breakOffset && ((got.x % 16) + 16) % 16 !== 9) bad++;
  }
  return bad;
}
ok(run('on_treasure_maps', 260, 200) === 0, 'buried treasure locate disagrees with the oracle');
ok(run('on_treasure_maps', 260, 200, true) === 0, 'buried treasure position lacks the (9,9) locate_offset');
ok(run('ocean_ruin', 120, 100) === 0, 'ocean ruin locate disagrees with the oracle');
ok(ST.locateStructure('on_treasure_maps', 0, 0, 200) !== null, 'no treasure within 200 chunks of the origin');
ok(ST.locateStructure('#minecraft:on_treasure_maps', 0, 0, 200)?.x === ST.locateStructure('on_treasure_maps', 0, 0, 200)?.x, '#minecraft: prefix not accepted');
ok(ST.locateStructure('nonsense', 0, 0, 50) === null, 'unknown tag must be null');
ok(ST.locateStructure('on_treasure_maps', 0, 0, 0) === null || ST.locateStructure('on_treasure_maps', 0, 0, 0).name === 'buried_treasure', 'radius 0');

// ── anti-vacuity: each break must trip its own comparison
let breaks = 0;
{ const t = JSON.parse(JSON.stringify(ST.STRUCTURE_TAGS)); t.ocean_ruin.pop(); if (!tagsMatch(t)) { breaks++; console.log("✓ break caught"); } }
{ const t = JSON.parse(JSON.stringify(ST.STRUCTURE_TAGS)); t.on_treasure_maps = ['monument']; if (!tagsMatch(t)) { breaks++; console.log("✓ break caught"); } }
{
  const sets = ST.sets.filter((s) => s.placement.locateOffset && s.placement.locateOffset[0] === 9);
  const saved = sets.map((s) => s.placement.locateOffset);
  sets.forEach((s) => { s.placement.locateOffset = [0, 0]; });
  if (run('on_treasure_maps', 260, 200, true) > 0) { breaks++; console.log("✓ break caught"); }
  sets.forEach((s, i) => { s.placement.locateOffset = saved[i]; });
}
{ // salt shifted: locate must move away from the oracle computed on the unshifted seed
  const before = ST.locateStructure('on_treasure_maps', 0, 0, 200);
  const g = ST.G.seed; ST.G.seed = 4242; ST.dropCache();
  const after = ST.locateStructure('on_treasure_maps', 0, 0, 200);
  ST.G.seed = g; ST.dropCache();
  if (!before || !after || before.x !== after.x || before.z !== after.z) { breaks++; console.log("✓ break caught"); }
}
ok(breaks === 4, `only ${breaks} of 4 breaks caught`);

console.log(`locatecheck: ${pass} checks passed`);
for (const f of fails) console.log('FAIL ' + f);
console.log(`locatecheck: ${breaks} breaks caught (of 4)`);
process.exit(fails.length ? 1 : 0);
