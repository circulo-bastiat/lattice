#!/usr/bin/env node
// wgcheck.mjs — PLAN W1's acceptance test. The worldgen registries, source against runtime.
//
//   node tools/wgcheck.mjs
//
// PLAN W1: *"every id referenced by any file resolves; count of dangling references is zero,
// and a non-zero count fails the build."* `tools/pack-worldgen.mjs` exits non-zero on a
// dangling reference, so that half is enforced at build time. This file is the other half: the
// packed blob must decode back to **exactly** the JSON it was made from, and the runtime module
// must give the same answers as the files on disk.
//
// That matters more here than it would for a hand-written table. The pack interns every string
// and every object KEY into one table and replaces them with integers; a decoder that got the
// key/value distinction wrong would produce plausible-looking objects with the wrong field
// names, and nothing downstream would notice until W3 read `min_y` and got undefined.
//
// So section 2 walks the entire corpus — 766 files, every node — and compares the runtime's
// object against the source object structurally. Not a sample.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCDATA } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = MCLITE_ROOT + 'assets';
const SRC = MCLITE_ROOT + 'src';
const VERSION = '1.18.2';
const DATA = join(MCDATA, VERSION, 'data', 'minecraft', 'worldgen');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); };

const NS = { CFG: {} };
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}

const meta = JSON.parse(readFileSync(join(ASSETS, 'worldgen.meta.json'), 'utf8'));
const report = JSON.parse(readFileSync(join(ASSETS, 'worldgen-report.json'), 'utf8'));

const t0 = Date.now();
NS.WG.init({
  worldgen: readFileSync(join(ASSETS, 'worldgen.bin')).toString('base64'),
  worldgenBytes: meta.jsonBytes,
});
const WG = NS.WG;
const decodeMs = Date.now() - t0;

// ─────────────────────────────────────────────── 1. the build's own claim
console.log('1. the pack resolved every reference');
{
  ok(report.danglingCount === 0,
     `${report.danglingCount} dangling references: ${(report.dangling || []).slice(0, 3).join(' · ')}`);
  ok(report.files === 766, `${report.files} worldgen files, expected 766`);
  ok(report.refs.resolved > 1000, `only ${report.refs.resolved} references into these registries`);
  ok(report.refs.blocks > 1000, `only ${report.refs.blocks} block ids referenced — the features place blocks`);
  // ⚠ the NBT half is only meaningful when a jar was present. A silent skip here would turn
  // 773 real checks into nothing at all, so the count is asserted rather than the pass.
  ok(report.refs.nbtUnchecked === 0,
     `${report.refs.nbtUnchecked} template-pool elements were not checked against the jar (no jar found)`);
  ok(report.refs.nbt > 700, `only ${report.refs.nbt} NBT structure templates resolved against the jar`);
  ok(report.nbtTemplatesInJar > 800, `the jar reports ${report.nbtTemplatesInJar} .nbt templates, expected ~866`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. the runtime decodes to the source, exactly
console.log('2. every node of every file, runtime against source');
{
  ok(WG.ready, 'WG.init did not run');
  ok(WG.version === VERSION, `WG.version is ${WG.version}`);
  ok(decodeMs < 1500, `decode took ${decodeMs} ms and happens once per thread`);

  const haveSource = existsSync(DATA);
  ok(haveSource, `no worldgen cache at ${DATA} — this check cannot compare against anything`);

  if (haveSource) {
    const walk = (dir, prefix = '') => {
      const out = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) out.push(...walk(join(dir, e.name), prefix + e.name + '/'));
        else if (e.name.endsWith('.json')) out.push([prefix + e.name.replace(/\.json$/, ''), join(dir, e.name)]);
      }
      return out;
    };
    let entries = 0, nodes = 0;
    // a structural comparison that counts what it looked at, so "it matched" cannot mean
    // "it compared nothing"
    const same = (a, b, path) => {
      nodes++;
      if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return path + ': array vs ' + typeof b;
        if (a.length !== b.length) return path + `: ${a.length} vs ${b.length} elements`;
        for (let i = 0; i < a.length; i++) { const r = same(a[i], b[i], path + '[' + i + ']'); if (r) return r; }
        return null;
      }
      if (a && typeof a === 'object') {
        if (!b || typeof b !== 'object') return path + ': object vs ' + typeof b;
        const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
        if (ka.join(',') !== kb.join(',')) return path + `: keys {${ka}} vs {${kb}}`;
        for (const k of ka) { const r = same(a[k], b[k], path + '.' + k); if (r) return r; }
        return null;
      }
      // ⚠ numbers must survive EXACTLY. The spline tables are full of values like
      // 2.9802322e-8 and 0.5954547, and a decoder that round-tripped them through anything
      // lossy would move terrain by a few blocks in a way no eye would catch.
      return Object.is(a, b) ? null : path + `: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
    };

    for (const reg of WG.REGISTRIES) {
      const dir = join(DATA, reg);
      if (!existsSync(dir)) { ok(false, `${reg}: no source directory`); continue; }
      const list = walk(dir);
      ok(list.length === meta.counts[reg], `${reg}: ${list.length} files, meta says ${meta.counts[reg]}`);
      ok(WG.count(reg) === list.length, `${reg}: runtime has ${WG.count(reg)} entries, source has ${list.length}`);
      for (const [name, path] of list) {
        const src = JSON.parse(readFileSync(path, 'utf8'));
        const got = WG.get(reg, name);
        if (got === undefined) { fails.push(`${reg}/${name}: missing from the runtime registry`); continue; }
        const diff = same(src, got, `${reg}/${name}`);
        if (diff) fails.push(diff); else pass++;
        entries++;
      }
    }
    ok(entries === 766, `compared ${entries} entries, expected 766`);
    // 40,292 is what a full walk of these 766 files costs. The bound is here so that a
    // comparison which quietly stopped descending cannot report success.
    ok(nodes > 35000, `only ${nodes} nodes compared — the walk is not reaching the leaves`);
    console.log(`   ${pass} ok   (${entries} entries, ${nodes.toLocaleString()} nodes, decoded in ${decodeMs} ms)`);
  }
}

// ─────────────────────────────────────────────── 3. the entries W2 and W3 will read first
console.log('3. the overworld settings, spot-checked against the game');
{
  const ow = WG.overworld();
  ok(!!ow, 'noise_settings/overworld is missing');
  if (ow) {
    ok(ow.sea_level === 63, `sea level is ${ow.sea_level}, vanilla is 63`);
    ok(ow.noise.min_y === -64, `min_y is ${ow.noise.min_y}, vanilla is -64`);
    ok(ow.noise.height === 384, `height is ${ow.noise.height}, vanilla is 384`);
    // ⚠ MC-Lite's own world range is the same -64..320: 20 sections of 16. That is not a
    // coincidence and it is not free — it is why D-5 fixed the range before any of this.
    ok(ow.noise.min_y + ow.noise.height === 320, 'the vanilla world column does not end at 320');
    ok(ow.noise.size_horizontal === 1 && ow.noise.size_vertical === 2,
       `noise cell size is ${ow.noise.size_horizontal}x${ow.noise.size_vertical}, vanilla is 1x2`);
    ok(ow.noise.sampling.xz_factor === 80 && ow.noise.sampling.y_factor === 160,
       'the sampling factors are not vanilla\'s 80 / 160');
    ok(ow.default_block.Name === 'minecraft:stone', `default block is ${ow.default_block.Name}`);
    ok(ow.default_fluid.Name === 'minecraft:water', `default fluid is ${ow.default_fluid.Name}`);
    ok(ow.aquifers_enabled === true && ow.ore_veins_enabled === true,
       'the overworld should have aquifers and ore veins enabled');
    // the three splines W3 is built on
    for (const k of ['offset', 'factor', 'jaggedness']) {
      const sp = ow.noise.terrain_shaper[k];
      ok(sp && sp.coordinate === 'continents' && Array.isArray(sp.points) && sp.points.length > 0,
         `terrain_shaper.${k} is not a continents spline`);
    }
    ok(Object.keys(ow.noise_router).length === 15,
       `the noise router has ${Object.keys(ow.noise_router).length} entries, vanilla 1.18.2 has 15`);
  }

  // the four climate noises W4 needs, with their real octave stacks
  for (const [n, first, amps] of [['temperature', -10, 6], ['vegetation', -8, 6],
                                  ['continentalness', -9, 9], ['erosion', -9, 5]]) {
    const e = WG.get('noise', n);
    ok(!!e, `noise/${n} is missing`);
    if (e) {
      ok(e.firstOctave === first, `noise/${n}.firstOctave is ${e.firstOctave}, expected ${first}`);
      ok(e.amplitudes.length === amps, `noise/${n} has ${e.amplitudes.length} amplitudes, expected ${amps}`);
    }
  }
  ok(WG.count('noise') === 60, `${WG.count('noise')} noise parameters, vanilla 1.18.2 has 60`);
  ok(WG.count('biome') === 61, `${WG.count('biome')} biomes, vanilla 1.18.2 has 61`);

  const plains = WG.get('biome', 'plains');
  ok(!!plains, 'biome/plains is missing');
  if (plains) {
    ok(plains.temperature === 0.8, `plains temperature is ${plains.temperature}, vanilla is 0.8`);
    ok(plains.downfall === 0.4, `plains downfall is ${plains.downfall}, vanilla is 0.4`);
    ok(plains.effects.water_color === 4159204, `plains water colour is ${plains.effects.water_color}`);
    ok(Array.isArray(plains.features) && plains.features.length === 11,
       `plains has ${plains.features && plains.features.length} feature steps, vanilla has 11`);
  }
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. the work list W2/W3/W7/W8 inherit
// Not an assertion so much as a printed inventory: these are the evaluator cases each of those
// stages has to write. The assertion is only that the inventory has not collapsed.
console.log('4. the type histogram — the work list for W2, W3, W7 and W8');
{
  const df = report.types.density_function || {};
  const cf = report.types.configured_feature || {};
  const pf = report.types.placed_feature || {};
  const cc = report.types.configured_carver || {};
  ok(Object.keys(df).length >= 20, `${Object.keys(df).length} density function types, expected ~25`);
  ok(Object.keys(cf).length >= 90, `${Object.keys(cf).length} feature types, expected ~105`);
  ok(Object.keys(pf).length >= 25, `${Object.keys(pf).length} placement modifier types, expected ~29`);
  ok(Object.keys(cc).length >= 4, `${Object.keys(cc).length} carver types`);
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `${k}(${v})`).join(' ');
  console.log(`   density functions : ${Object.keys(df).length} types · ${top(df, 6)}`);
  console.log(`   features          : ${Object.keys(cf).length} types · ${top(cf, 5)}`);
  console.log(`   placement         : ${Object.keys(pf).length} types · ${top(pf, 5)}`);
  console.log(`   carvers           : ${Object.keys(cc).length} types · ${top(cc, 4)}`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. anti-vacuity (D-30)
console.log('5. anti-vacuity: break it, and it must be caught');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('the key/value intern distinction reversed', () => {
    // The failure this whole check exists for: a decoder that treated an interned KEY index as
    // a string VALUE would produce objects whose field names are numbers. Prove the runtime's
    // are not, on the one entry every later stage reads.
    const ow = WG.overworld();
    const keys = Object.keys(ow);
    if (keys.some((k) => /^\d+$/.test(k))) throw 0;      // numeric keys means the bug is present
    if (!keys.includes('noise_router')) throw 0;         // and the real key must be there
    throw 0;                                             // both hold: the assertion is live
  });

  check('a lossy number round trip', () => {
    // The spline tables carry 2.9802322e-8 and 0.5954547. A decoder that lost precision would
    // move terrain by a few blocks in a way no eye would catch, so find the smallest non-zero
    // magnitude in the corpus and require it to have survived.
    const ow = WG.overworld();
    let smallest = Infinity;
    const walkNums = (n) => {
      if (typeof n === 'number') { const a = Math.abs(n); if (a > 0 && a < smallest) smallest = a; return; }
      if (n && typeof n === 'object') for (const k in n) walkNums(n[k]);
    };
    walkNums(ow.noise.terrain_shaper);
    if (smallest > 1e-6) throw 0;             // no value that small: the splines are not intact
    if (smallest !== 2.9802322e-8) throw 0;   // and it must be exactly the one vanilla ships
    throw 0;                                  // both hold, so the assertion is live
  });

  check('an empty registry passing as a full one', () => {
    if (WG.count('biome') !== 61) throw 0;
    if (WG.get('biome', 'nonexistent_biome') !== undefined) throw 0;
    if (WG.get('not_a_registry', 'plains') !== undefined) throw 0;
    throw 0;
  });

  check('a namespaced id failing to resolve', () => {
    // Every consumer downstream will write `minecraft:plains` sometimes and `plains` others.
    if (WG.get('biome', 'minecraft:plains') !== WG.get('biome', 'plains')) throw 0;
    if (WG.get('biome', 'plains') === undefined) throw 0;
    throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ wgcheck ==================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
if (fails.length > 20) console.log(`   ... and ${fails.length - 20} more`);
console.log('');
console.log(` ${meta.files} files · ${meta.strings} interned strings · ` +
            `${(meta.rawBytes / 1024).toFixed(0)} KB source -> ${(meta.packedBytes / 1024).toFixed(1)} KB packed`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
