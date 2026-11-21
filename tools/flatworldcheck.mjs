// tools/flatworldcheck.mjs — #11324: the Superflat world type (FlatChunkGenerator, Classic Flat layers).
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
function run(mut) {
  const M = loadEngine({ extra: ['07_world.js', '08_lighting.js'] });
  if (mut) mut(M);
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla', worldType: 'flat' }));
  const bad = [];
  const want = ['bedrock', 'dirt', 'dirt', 'grass'];
  if (!M.Column.WORLD_TYPES.includes('flat')) bad.push('flat not in WORLD_TYPES');
  for (const [cx, cz] of [[0, 0], [5, -3], [-7, 9]]) {
    const col = M.Gen.genColumn(cx, cz);
    const B = (n) => M.States.stateOf(n === 'grass' ? 'grass_block' : n);
    for (const [x, z] of [[0, 0], [7, 11], [15, 15]]) {
      const get = (y) => M.Section.getXYZ(col.sec[(y + 64) >> 4], x, (y + 64) & 15, z);
      for (let y = -64; y < -64 + 8; y++) {
        const i = y + 64, e = i < 4 ? B(want[i]) : 0;
        const g = get(y);
        if (g !== e) bad.push(`(${cx},${cz}) y=${y}: ${g} want ${e}`);
      }
      // FlatChunkGenerator.getHeight: top solid layer is index 3 (y=-61), first free y=-60 = getSpawnHeight (bottomY + 4 layers)
      if (col.hmap[(z << 4) | x] !== 3) bad.push(`hmap ${col.hmap[(z << 4) | x]} want 3`);
      // no caves/ores/decoration: every block above the stack is air, whole column
      for (let y = -60; y < 256; y++) if (get(y) !== 0) bad.push(`(${cx},${cz}) y=${y} not air`);
      if (col.biome[(z << 4) | x] !== M.Biomes.indexOf['minecraft:plains']) bad.push('biome not plains');
    }
  }
  return bad;
}
// FlatChunkGeneratorConfig.getDefaultConfig: structure_overrides = [strongholds, villages] -> a village stands on the flat ground.
function village(mut) {
  const M = loadEngine({ extra: ['07_world.js', '08_lighting.js'] });
  if (mut) mut(M);
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla', worldType: 'flat', structures: true }));
  const bad = [];
  let best = null;
  for (let cx = -45; cx < -35; cx++) for (let cz = 30; cz < 42; cz++) for (const s of M.Structures.startsNear(cx, cz)) if (/village/.test(s.def.name)) {
    const n = s.pieces.filter((p) => p.x1 >= cx * 16 && p.x0 <= cx * 16 + 15 && p.z1 >= cz * 16 && p.z0 <= cz * 16 + 15).length;
    if (!best || n > best[0]) best = [n, cx, cz];
  }
  if (!best) return ['no village start in the search window'];
  const found = [best[1], best[2]];
  let solid = 0, bad2 = 0;
  for (let cx = -60; cx < 60; cx += 1) for (let cz = -60; cz < 60; cz++)
    for (const st of M.Structures.startsNear(cx, cz)) if (!/village|stronghold/.test(st.def.name)) { bad.push('non-flat structure ' + st.def.name); cx = 99; cz = 99; break; }
  const col = M.Gen.genColumn(found[0], found[1]);
  for (let y = -60; y < 40; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++)
    if (M.Section.getXYZ(col.sec[(y + 64) >> 4], x, (y + 64) & 15, z) !== 0) solid++;
  if (solid < 50) bad.push('village chunk has only ' + solid + ' blocks above the flat stack');
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (M.Section.getXYZ(col.sec[0], x, 0, z) !== M.States.stateOf('bedrock')) bad2++;
  if (bad2) bad.push('bedrock floor damaged');
  if (col.biome[0] !== M.Biomes.indexOf['minecraft:plains']) bad.push('village chunk biome not plains');
  return bad;
}
// DECOMP REFEREE ROW: the vanilla facts read from .decomp (no server jar on the runner), compared with the engine.
function decompFacts() {
  const D = MCLITE_ROOT + '/.decomp/';
  const decl = (file, f) => { const t = readFileSync(D + file, 'utf8'); const i = t.indexOf(f + ' = '); const m = /(?:register|of)\(\s*"([a-z_]+)"/.exec(t.slice(i, i + 200)); return m[1]; };
  const names = { get: (f) => f.startsWith('field_37') ? decl('net/minecraft/structure/StructureSetKeys.java', f) : f === 'field_9451' ? decl('net/minecraft/world/biome/BiomeKeys.java', f) : decl('net/minecraft/block/Blocks.java', f) };
  const cfg = readFileSync(D + 'net/minecraft/world/gen/chunk/FlatChunkGeneratorConfig.java', 'utf8');
  const gen = readFileSync(D + 'net/minecraft/world/gen/chunk/FlatChunkGenerator.java', 'utf8');
  const body = cfg.slice(cfg.indexOf('getDefaultConfig'));
  const lc = (n) => String(n).toLowerCase();
  const layers = [...body.matchAll(/new FlatChunkGeneratorLayer\((\d+), Blocks\.(field_\d+)\)/g)].map((m) => [lc(names.get(m[2])), +m[1]]);
  const biome = lc(names.get(/BiomeKeys\.(field_\d+)/.exec(body)[1]));
  const sets = [...body.matchAll(/StructureSetKeys\.(field_\d+)/g)].map((m) => lc(names.get(m[1]))).sort();
  return { layers, biome, sets, sea: +/getSeaLevel\(\)\s*\{\s*return (-?\d+)/.exec(gen)[1] };
}
function decompRow(mut) {
  const M = loadEngine({ extra: ['07_world.js', '08_lighting.js'] });
  if (mut) mut(M);
  const f = decompFacts(), bad = [];
  const eng = M.Gen.FLAT_LAYERS.map(([n, k]) => [n === 'grass' ? 'grass_block' : n, k]);
  if (JSON.stringify(eng) !== JSON.stringify(f.layers)) bad.push('layers ' + JSON.stringify(eng) + ' vs vanilla ' + JSON.stringify(f.layers));
  if ('minecraft:' + f.biome !== M.Gen.FLAT_BIOME) bad.push('biome ' + M.Gen.FLAT_BIOME + ' vs vanilla ' + f.biome);
  if (JSON.stringify(f.sets) !== '["strongholds","villages"]') bad.push('vanilla structure sets ' + f.sets);
  if (f.sea !== -63) bad.push('vanilla sea ' + f.sea);
  return bad;
}
const dr = decompRow();
console.log(dr.length ? 'FAIL decomp row: ' + dr.join('; ') : 'flat decomp referee row ok (layers, biome, structure sets, sea)');
const vb = village();
console.log(vb.length ? 'FAIL village baseline: ' + vb.join('; ') : 'flat village ok');
const base = run();
console.log(base.length ? 'FAIL baseline: ' + base.slice(0, 5).join('; ') : 'flat layers ok');
let caught = 0, n = 0;
const breaks = [
  (M) => { M.Gen.FLAT_LAYERS.reverse(); },
  (M) => { M.Gen.FLAT_BIOME = 'minecraft:desert'; },
  (M) => { M.Gen.FLAT_LAYERS = [['bedrock', 1], ['grass', 1], ['dirt', 2]]; },
  (M) => { M.Column.WORLD_TYPES.pop(); },
  (M) => { const g = M.Gen.genColumn; M.Gen.genColumn = (cx, cz) => { const c = g(cx, cz); c.hmap[0] = 62; return c; }; },
  (M) => { const g = M.Gen.genColumn; M.Gen.genColumn = (cx, cz) => { const c = g(cx, cz); M.Section.setXYZ && M.Section.setXYZ(c.sec[10], 0, 0, 0, M.States.stateOf('stone')); return c; }; },
];
for (const b of breaks) { n++; if (run(b).length) caught++; }
// dispatch removed: worldType no longer routes to flat
n++; { const bad = (() => { const M = loadEngine({ extra: ['07_world.js', '08_lighting.js'] });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' })); const col = M.Gen.genColumn(0, 0);
  const s = col.sec[(100 + 64) >> 4]; return M.Section.getXYZ(s, 0, 4, 0) !== 0 || col.hmap[0] > 8; })(); if (bad) caught++; }
n++; if (village((M) => { M.Gen.FLAT_BIOME = 'minecraft:ocean'; }).length) caught++;
n++; if (village((M) => { M.Column.height = () => 62; M.Column.FLAT_TOP = 62; }).length) caught++;
n++; if (village((M) => { M.Gen.init = ((i) => function (a, p) { return i.call(this, a, Object.assign(p, { structures: false })); })(M.Gen.init); }).length) caught++;
n++; if (decompRow((M) => { M.Gen.FLAT_LAYERS = [['bedrock', 1], ['dirt', 3], ['grass', 1]]; }).length) caught++;
n++; if (decompRow((M) => { M.Gen.FLAT_BIOME = 'minecraft:forest'; }).length) caught++;
console.log(`${caught} breaks caught (of ${n})`);
process.exit(dr.length || vb.length || base.length || caught < n ? 1 : 0);
