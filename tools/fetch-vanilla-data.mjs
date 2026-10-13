#!/usr/bin/env node
// fetch-vanilla-data.mjs — get the vanilla worldgen registries that are NOT in the client jar.
//
//   node tools/fetch-vanilla-data.mjs [--version 1.18.2] [--out <project>/.mcdata]
//
// ⚠ MEASURED FINDING, 6 Sept 2026 — this tool exists because of it:
//   `data/minecraft/worldgen/` is EMPTY in the 1.18.2 CLIENT jar. Measured: the only data
//   directories present are advancements(1141), loot_tables(986), recipes(1058),
//   structures(866 .nbt) and tags(270). Every biome, noise, density_function, noise_settings,
//   configured_feature, placed_feature, configured_carver, structure_set,
//   configured_structure_feature, template_pool and processor_list is a BUILT-IN REGISTRY,
//   defined in Java and only materialised as JSON by the server's data generator
//   (`java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports`).
//   In 1.16.2-1.17.1 these files WERE in the jar; 1.18 moved them into code. Any plan that
//   says "port the worldgen JSON out of the jar" is wrong for this version.
//
//   The data generator route needs the SERVER jar (piston-data.mojang.com) and Java 17.
//   Measured the same day: piston-data.mojang.com is refused by the egress proxy from both
//   the cloud container and Dan's device VM, and the device VM has Java 11. So that route is
//   closed here and this one is used instead.
//
// SOURCE: misode/mcmeta, branch `<version>-data`. It is the community's canonical
// auto-generated mirror: for every version it runs Mojang's own `--reports` generator and
// commits the output verbatim. raw.githubusercontent.com is reachable; the GitHub API and
// codeload are not, so there is no way to list the tree — instead the file list comes from
// the `<version>-summary/registries/data.json` index on the same mirror, which enumerates
// every id in every registry. That makes the fetch EXHAUSTIVE BY CONSTRUCTION rather than by
// crawling, which matters: a crawl that misses a reference fails silently much later.
//
// Everything fetched is Mojang's data under their EULA, treated exactly like the jar:
// it lives in the local cache, never in a shareable repo (D-6).
//
// ── SECOND SOURCE, added session 2 ────────────────────────────────────────────────
// This tool used to fetch ONLY the worldgen registries above, and `docs/archive/NEXT.md` claimed
// that running it restored the whole data pipeline. It did not. Seven tools
// (`merge-constants`, `extract-blocks`, `extract-items`) read a SECOND dataset out of
// `<out>/pc/` — PrismarineJS `minecraft-data` — and nothing fetched it. It had been
// downloaded by hand in session 1, so session 2 opened on ten red stages for a reason that
// was nowhere in the docs. That is exactly the failure D-6 is supposed to prevent: a
// generated input that has to be KEPT is an input that can go missing or drift.
//
// So the pc dataset is fetched here too. Its per-file version resolution is not obvious —
// minecraft-data does not have a `1.18.2` directory for most datasets; it has `pc/1.18`,
// and some datasets have not changed since `pc/1.17` or `pc/1.16.1`. The mapping lives in
// the repo's own `data/dataPaths.json`, so that index is fetched and read rather than
// guessed. Guessing gives 404s on exactly the datasets that matter (blockCollisionShapes
// and tints are both still at pc/1.17).

// ── THIRD SOURCE, added session 3 — W4's open item, closed (D-112) ───────────────────
// PLAN W4 carried an open item and the risk register carried it as risk #2: the compiled
// overworld multi-noise climate parameter table (`MultiNoiseBiomeSource.Preset.OVERWORLD`)
// is built in Java, is in no jar, and is in none of the eleven `worldgen/*` registries the
// block above fetches — so `WANT` cannot reach it and `_registries.json` does not list it.
//
// It IS on the same mirror, in a twelfth place nobody thought to look: the **dimension**
// registry. `data/minecraft/dimension/overworld.json` is what the data generator writes for
// the overworld dimension, and its `generator.biome_source` is the preset already compiled
// to JSON — **7,578 parameter entries over 50 biomes**, each one six axis ranges plus an
// offset and a biome id. That is the table, verbatim from Mojang's own generator, and it
// removes the need for all three of the routes W4 listed (the blocked generator run, the
// misode.github.io scrape, the derive-it-from-the-61-`climate`-blocks guess — which would
// have been wrong anyway: the 61 biome files' `climate` blocks are the 1.17 fields, not
// these six axes).
//
// It is fetched as a whole file rather than through the registry index because the
// dimension registry has exactly one entry this project needs and enumerating it buys
// nothing. `tools/pack-biomeparams.mjs` reads it; `tools/climcheck.mjs` proves the read.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MCDATA } from './paths.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const VERSION = opt('version', '1.18.2');
const OUT = join(opt('out', MCDATA), VERSION);
const CONC = +opt('conc', '16');
const RAW = 'https://raw.githubusercontent.com/misode/mcmeta';
const PCRAW = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data';
const PCOUT = join(opt('out', MCDATA), 'pc');

// The pc datasets MC-Lite's build stages read, and who reads each one. Explicit for the same
// reason WANT is explicit: a dataset nobody listed is a dataset nobody planned for.
const PC_WANT = [
  ['blocks',               'extract-blocks, extract-items, merge-constants'],
  ['items',                'extract-items'],
  ['foods',                'extract-items'],
  ['blockCollisionShapes', 'merge-constants — the 4,105 collision shapes'],
  ['blockLoot',            'merge-constants — loot tables'],
  ['materials',            'merge-constants — tool/material classes'],
  ['tints',                'merge-constants, itemcheck — grass/foliage/redstone tints'],
  ['biomes',               'W5 biomes'],
  ['enchantments',         'G3 mining speed'],
  ['effects',              'G5 survival loop'],
  ['attributes',           'G5 survival loop'],
  ['entities',             'G17 entity substrate'],
  ['entityLoot',           'G18 mobs'],
  ['recipes',              'G9 crafting'],
  ['particles',            'G2 block behaviour'],
  ['sounds',               'G13 sound'],
  ['windows',              'G8 inventory'],
  ['instruments',          'G2 note block'],
  ['mapIcons',             'G20'],
];

// One dataset is fetched from a LATER version on purpose, and it is not a shortcut.
//
// minecraft-data's `pc/1.18/blocks.json` reports **hardness 0 and resistance 0 for 122 blocks** (D-108)
// — every block added in 1.17 (the whole deepslate family, every copper block, the amethyst
// buds, smooth basalt, tinted glass, the infested variants). That is a hole in the dataset,
// not a fact about the game: real deepslate is 3.0/6.0 and real copper ore is 3.0/3.0.
// Left alone it makes 79 full blocks instant to break, which is exactly the kind of thing
// that looks like a physics bug six weeks later.
//
// `pc/1.19/blocks.json` has them. It is a valid patch source for 1.18.2 because the two
// datasets AGREE on every block where 1.18 has a value at all: 658 of 658, with the only
// differences being unbreakable blocks moving from `null` to `-1`, an encoding change.
// `tools/constcheck.mjs` re-proves that agreement every run rather than trusting this note,
// and merge-constants only ever reads 1.19 for a block whose 1.18 hardness is 0 or null.
const PC_EXTRA = [
  ['blocks119', 'pc/1.19', 'blocks', 'merge-constants — hardness/resistance patch, see above'],
];

// Whole files fetched from `<version>-data` by PATH rather than through the registry index,
// because they are not registry entries. See the third-source note above.
const FILE_WANT = [
  ['data/minecraft/dimension/overworld.json', 'pack-biomeparams — W4 multi-noise climate table'],
];

// The registries MC-Lite needs. Each is <registry> -> the directory under data/minecraft/.
// Deliberately explicit: a registry nobody listed is a registry nobody planned for.
const WANT = [
  'worldgen/biome',
  'worldgen/noise',
  'worldgen/density_function',
  'worldgen/noise_settings',
  'worldgen/configured_carver',
  'worldgen/configured_feature',
  'worldgen/placed_feature',
  'worldgen/structure_set',
  'worldgen/configured_structure_feature',
  'worldgen/template_pool',
  'worldgen/processor_list',
];

const t0 = Date.now();
mkdirSync(OUT, { recursive: true });

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 200) return await r.text();
      if (r.status === 404) return null;
      // 403/429 from the proxy or from GitHub rate limiting: back off and retry
    } catch { /* network hiccup: retry */ }
    await new Promise((r) => setTimeout(r, 400 * (i + 1) * (i + 1)));
  }
  throw new Error('failed after ' + tries + ': ' + url);
}

// ---------------------------------------------------------------- index
const idxPath = join(OUT, '_registries.json');
let summary;
if (existsSync(idxPath)) {
  summary = JSON.parse(readFileSync(idxPath, 'utf8'));
  console.log('registry index: cached');
} else {
  const txt = await get(`${RAW}/${VERSION}-summary/registries/data.json`);
  if (!txt) throw new Error(`no registry summary for ${VERSION} — is the branch name right?`);
  summary = JSON.parse(txt);
  writeFileSync(idxPath, JSON.stringify(summary));
  console.log('registry index: fetched');
}

const jobs = [];
for (const reg of WANT) {
  const ids = summary[reg];
  if (!Array.isArray(ids)) { console.log(`  ⚠ registry absent from index: ${reg}`); continue; }
  for (const id of ids) jobs.push({ reg, id, path: `data/minecraft/${reg}/${id}.json` });
  console.log(`  ${reg.padEnd(38)} ${String(ids.length).padStart(4)}`);
}
console.log(`total files: ${jobs.length}`);

// ---------------------------------------------------------------- fetch
let done = 0, cached = 0, failed = [];
const results = new Array(jobs.length);

async function worker(start) {
  for (let i = start; i < jobs.length; i += CONC) {
    const j = jobs[i];
    const dest = join(OUT, j.path);
    if (existsSync(dest)) { cached++; done++; results[i] = 'cache'; continue; }
    let txt;
    try { txt = await get(`${RAW}/${VERSION}-data/${j.path}`); }
    catch (e) { failed.push(j.path + ' :: ' + e.message); done++; continue; }
    if (txt === null) { failed.push(j.path + ' :: 404'); done++; continue; }
    // A JSON parse here is not decoration: it is the only thing that catches the proxy
    // handing back an HTML error page with a 200, which would otherwise be cached forever.
    try { JSON.parse(txt); }
    catch { failed.push(j.path + ' :: not JSON (' + txt.slice(0, 60).replace(/\s+/g, ' ') + ')'); done++; continue; }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, txt);
    results[i] = 'net';
    done++;
    if (done % 100 === 0) process.stdout.write(`  ${done}/${jobs.length}\r`);
  }
}
await Promise.all(Array.from({ length: CONC }, (_, k) => worker(k)));

// ---------------------------------------------------------------- pc dataset
// Fetched second and reported separately so a failure here names itself instead of hiding
// inside the worldgen totals.
mkdirSync(PCOUT, { recursive: true });
let pcCached = 0, pcFetched = 0;
const pcFailed = [];
{
  const dpPath = join(PCOUT, '_dataPaths.json');
  let dp;
  if (existsSync(dpPath)) {
    dp = JSON.parse(readFileSync(dpPath, 'utf8'));
  } else {
    const txt = await get(`${PCRAW}/dataPaths.json`);
    if (!txt) throw new Error('minecraft-data dataPaths.json not reachable');
    dp = JSON.parse(txt);
    writeFileSync(dpPath, JSON.stringify(dp));
  }
  // Exact version first; then the major line (1.18.2 -> 1.18), which is what the index
  // itself falls back to for most datasets.
  const major = VERSION.split('.').slice(0, 2).join('.');
  const map = dp.pc?.[VERSION] || dp.pc?.[major];
  if (!map) throw new Error(`minecraft-data has no pc entry for ${VERSION} or ${major}`);

  for (const [name, why] of PC_WANT) {
    const dest = join(PCOUT, name + '.json');
    if (existsSync(dest)) { pcCached++; continue; }
    const dir = map[name];
    if (!dir) { pcFailed.push(`${name} :: not in dataPaths for ${VERSION} (${why})`); continue; }
    let txt;
    try { txt = await get(`${PCRAW}/${dir}/${name}.json`); }
    catch (e) { pcFailed.push(`${name} :: ${e.message}`); continue; }
    if (txt === null) { pcFailed.push(`${name} :: 404 at ${dir}`); continue; }
    try { JSON.parse(txt); }
    catch { pcFailed.push(`${name} :: not JSON (${txt.slice(0, 60).replace(/\s+/g, ' ')})`); continue; }
    writeFileSync(dest, txt);
    pcFetched++;
  }

  for (const [dest0, dir, file, why] of PC_EXTRA) {
    const dest = join(PCOUT, dest0 + '.json');
    if (existsSync(dest)) { pcCached++; continue; }
    let txt;
    try { txt = await get(`${PCRAW}/${dir}/${file}.json`); }
    catch (e) { pcFailed.push(`${dest0} :: ${e.message}`); continue; }
    if (txt === null) { pcFailed.push(`${dest0} :: 404 at ${dir}/${file}.json (${why})`); continue; }
    try { JSON.parse(txt); }
    catch { pcFailed.push(`${dest0} :: not JSON`); continue; }
    writeFileSync(dest, txt);
    pcFetched++;
  }
}

// ---------------------------------------------------------------- whole files
// Same JSON-parse-on-arrival rule as everything else: a 200 carrying an HTML error page is
// the failure mode that survives caching, so it is caught here and not written.
let fwCached = 0, fwFetched = 0;
const fwFailed = [];
for (const [path, why] of FILE_WANT) {
  const dest = join(OUT, path);
  if (existsSync(dest)) { fwCached++; continue; }
  let txt;
  try { txt = await get(`${RAW}/${VERSION}-data/${path}`); }
  catch (e) { fwFailed.push(`${path} :: ${e.message} (${why})`); continue; }
  if (txt === null) { fwFailed.push(`${path} :: 404 (${why})`); continue; }
  try { JSON.parse(txt); }
  catch { fwFailed.push(`${path} :: not JSON (${txt.slice(0, 60).replace(/\s+/g, ' ')})`); continue; }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, txt);
  fwFetched++;
}

console.log('');
console.log('================ fetch-vanilla-data ================');
console.log(` version ........... ${VERSION}`);
console.log(` requested ......... ${jobs.length}`);
console.log(` from cache ........ ${cached}`);
console.log(` fetched ........... ${jobs.length - cached - failed.length}`);
console.log(` failed ............ ${failed.length}`);
for (const f of failed.slice(0, 20)) console.log('   ! ' + f);
console.log(` --- pc dataset (PrismarineJS/minecraft-data) ---`);
console.log(` requested ......... ${PC_WANT.length + PC_EXTRA.length}`);
console.log(` from cache ........ ${pcCached}`);
console.log(` fetched ........... ${pcFetched}`);
console.log(` failed ............ ${pcFailed.length}`);
for (const f of pcFailed) console.log('   ! ' + f);
console.log(` --- whole files (misode/mcmeta ${VERSION}-data) ---`);
console.log(` requested ......... ${FILE_WANT.length}`);
console.log(` from cache ........ ${fwCached}`);
console.log(` fetched ........... ${fwFetched}`);
console.log(` failed ............ ${fwFailed.length}`);
for (const f of fwFailed) console.log('   ! ' + f);
console.log(` ${Date.now() - t0} ms  ->  ${OUT}`);
console.log(`            ->  ${PCOUT}`);
console.log('====================================================');
process.exit(failed.length + pcFailed.length + fwFailed.length ? 1 : 0);
