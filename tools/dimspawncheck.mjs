#!/usr/bin/env node
// dimspawncheck.mjs — #264: the Nether/End biomes' natural spawn tables, as the engine serves them
// (Biomes.spawners, the table Spawn picks from), equal the vanilla 1.18.2 biome files row for row; and every
// spawned type has a Spawn rule or is a plain mob. Anti-vacuity: corrupting the engine's table is caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCDATA } from './paths.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIOMEDIR = join(MCDATA, '1.18.2', 'data', 'minecraft', 'worldgen', 'biome');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const NS = { CFG: {} }; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js', '04d_column.js',
                 '04e_climate.js', '04f_earth.js', '04g_biomes.js'])
  new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
const meta = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
NS.WG.init({ worldgen: readFileSync(join(ROOT, 'assets', 'worldgen.bin')).toString('base64'),
             worldgenBytes: meta('worldgen.meta.json').jsonBytes });
NS.Biomes.initColormaps({ colormaps: readFileSync(join(ROOT, 'assets', 'colormaps.bin')).toString('base64'),
                          colormapsBytes: meta('colormaps.meta.json').rawBytes });
NS.Biomes.init();
const B = NS.Biomes;

const BIOMES = ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas',
                'the_end', 'end_highlands', 'end_midlands', 'end_barrens', 'small_end_islands'];
// the expected rows the engine must hold, pinned from the vanilla files (spot facts, independent of the compare)
const PINNED = { nether_wastes: { monster: ['ghast', 'zombified_piglin', 'magma_cube', 'enderman', 'piglin'], creature: ['strider'] },
                 warped_forest: { monster: ['enderman'], creature: ['strider'] },
                 basalt_deltas: { monster: ['ghast', 'magma_cube'], creature: ['strider'] },
                 the_end: { monster: ['enderman'] } };

function compare(get) {
  let n = 0;
  for (const b of BIOMES) {
    const want = JSON.parse(readFileSync(join(BIOMEDIR, b + '.json'), 'utf8')).spawners || {};
    const got = get(B.index(b));
    const cats = new Set([...Object.keys(want), ...Object.keys(got)]);
    for (const c of cats) {
      const w = want[c] || [], g = got[c] || [];
      if (w.length !== g.length) { n++; continue; }
      w.forEach((r, i) => { const x = g[i]; if (!x || x.type !== r.type || x.weight !== r.weight || x.minCount !== r.minCount || x.maxCount !== r.maxCount) n++; });
    }
  }
  return n;
}
ok(compare((i) => B.spawners(i)) === 0, 'engine spawn tables differ from the vanilla biome files');
for (const b of BIOMES) { const s = B.spawners(B.index(b)); const tot = Object.values(s).reduce((a, r) => a + r.length, 0); ok(tot > 0 || b === 'x', b + ' has no spawn rows'); }
for (const b in PINNED) for (const c in PINNED[b]) {
  const types = (B.spawners(B.index(b))[c] || []).map((r) => r.type.replace('minecraft:', ''));
  ok(PINNED[b][c].join() === types.join(), `${b}.${c}: ${types} != ${PINNED[b][c]}`);
}
// every mob named has a spawn rule in 07l_spawn.js or is a plain mob (checked textually: Spawn.RULES.<n> or a table row)
const spawnSrc = readFileSync(join(ROOT, 'src', '07l_spawn.js'), 'utf8');
for (const b of BIOMES) for (const rows of Object.values(B.spawners(B.index(b)))) for (const r of rows) {
  const n = r.type.replace('minecraft:', '');
  ok(new RegExp('\\b' + n + '\\b').test(spawnSrc), n + ' is not known to 07l_spawn.js');
}

// anti-vacuity: break the engine's table and the compare must notice
let breaks = 0;
const real = B.spawners;
const mutate = (f) => compare((i) => { const s = JSON.parse(JSON.stringify(real(i))); f(s); return s; });
const tries = [
  (s) => { for (const c in s) if (s[c].length) { s[c][0].weight++; return; } },
  (s) => { for (const c in s) if (s[c].length) { s[c].pop(); return; } },
  (s) => { for (const c in s) if (s[c].length) { s[c][0].type = 'minecraft:cow'; return; } },
  (s) => { for (const c in s) if (s[c].length) { s[c][0].maxCount += 1; return; } },
  (s) => { s.monster = (s.monster || []).concat([{ type: 'minecraft:pig', weight: 1, minCount: 1, maxCount: 1 }]); },
];
for (const [k, t] of tries.entries()) if (mutate(t) > 0) { breaks++; console.log("   ✓ corruption " + k + " caught"); } else fails.push('a corruption went unnoticed');
console.log(`\n${pass} ok, ${fails.length} failed`);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
