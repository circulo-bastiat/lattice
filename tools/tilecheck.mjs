#!/usr/bin/env node
// tilecheck.mjs — the atlas's first 57 layers must be exactly B.T from src/02_blocks.js.
//
//   node tools/tilecheck.mjs
//
// The atlas is a texture ARRAY and the mesher writes layer numbers straight into the vertex
// data, so LAYER ORDER IS AN INTERFACE. The engine's legacy path uses a hand-written table
// of 57 names to layer indices; tools/build-atlas.mjs reserves layers 0..56 for exactly
// those textures in exactly that order so the numbers stay correct with no runtime remap.
//
// If the two ever drift by one entry, every block from that point on draws its neighbour's
// texture — a world that looks plausible and is wrong, which is the worst kind of wrong.
// The old comment in 06_atlas.js claimed "A.build() throws if the two disagree"; that check
// compared COUNTS. This compares names, indices and the atlas itself.

import { readFileSync } from 'node:fs';
import { decodePng } from './pngdec.mjs';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


const BLOCKS = readFileSync(MCLITE_ROOT + 'src/02_blocks.js', 'utf8');
const LEGACY = JSON.parse(readFileSync(MCLITE_ROOT + 'tools/legacy-tiles.json', 'utf8')).tiles;
const META = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/legacy-tiles.meta.json', 'utf8'));
const ATLAS = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/atlas-index.json', 'utf8'));
const TILES = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/block-tiles.meta.json', 'utf8'));
const AREPORT = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/atlas-report.json', 'utf8'));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// B.T is parsed out of the source rather than imported: the module needs a namespace and a
// util module to load, and parsing is both simpler and immune to those moving.
const m = BLOCKS.match(/var T = B\.T = \{([\s\S]*?)\n  \};/);
ok(!!m, 'could not find `var T = B.T = {` in src/02_blocks.js');
const table = {};
if (m) for (const pair of m[1].matchAll(/([A-Z_0-9]+)\s*:\s*(\d+)/g)) table[pair[1]] = +pair[2];
const countMatch = BLOCKS.match(/B\.TILE_COUNT\s*=\s*(\d+)/);

console.log('1. the engine table and the build table agree');
const engineNames = Object.keys(table).sort((a, b) => table[a] - table[b]);
ok(engineNames.length === LEGACY.length,
   `src/02_blocks.js has ${engineNames.length} tiles, tools/legacy-tiles.json has ${LEGACY.length}`);
ok(countMatch && +countMatch[1] === LEGACY.length, `B.TILE_COUNT is ${countMatch && countMatch[1]}, expected ${LEGACY.length}`);
for (let i = 0; i < Math.max(engineNames.length, LEGACY.length); i++) {
  ok(engineNames[i] === (LEGACY[i] && LEGACY[i][0]),
     `tile ${i}: engine says "${engineNames[i]}", build says "${LEGACY[i] && LEGACY[i][0]}" — every tile from here on would draw the wrong texture`);
  if (engineNames[i]) ok(table[engineNames[i]] === i, `${engineNames[i]} is index ${table[engineNames[i]]}, expected ${i}`);
}
console.log(`   ${pass} ok`);

console.log('2. the atlas actually put them on those layers');
ok(META.unmapped.length === 0, `${META.unmapped.length} legacy tiles have no atlas layer: ${META.unmapped.join(' ')}`);
for (let i = 1; i < LEGACY.length; i++) {
  const [name, tex] = LEGACY[i];
  ok(ATLAS.index[tex] === i,
     `${name} (${tex}) landed on atlas layer ${ATLAS.index[tex]}, must be ${i} — build-atlas.mjs reserves it`);
}
ok(ATLAS.index['__missing__'] === undefined, 'the missing-texture marker must not be reachable by name');
ok(TILES.count >= LEGACY.length, `the atlas has ${TILES.count} layers, fewer than the ${LEGACY.length} the engine names`);
ok(TILES.count === ATLAS.count, `block-tiles has ${TILES.count} layers, atlas-index says ${ATLAS.count}`);
ok(TILES.rawBytes === TILES.count * TILES.tile * TILES.tile * 4,
   `layered atlas is ${TILES.rawBytes} bytes for ${TILES.count} layers of ${TILES.tile}px`);
console.log(`   ${pass} ok`);

console.log('3. namespaces are canonical');
// Vanilla spells the same texture two ways. resolveTextureVar strips the default namespace,
// and if that ever stops happening the legacy lookups silently miss again — 43 of 57 did.
const prefixed = Object.keys(ATLAS.index).filter((k) => k.startsWith('minecraft:'));
ok(prefixed.length === 0, `${prefixed.length} atlas keys still carry the redundant "minecraft:" prefix, e.g. ${prefixed[0]}`);
ok(Object.keys(ATLAS.index).length === AREPORT.requested,
   `${Object.keys(ATLAS.index).length} atlas keys for ${AREPORT.requested} requested textures — a duplicate spelling is back`);
console.log(`   ${pass} ok`);

console.log('4. the old-texture policy is holding');
ok(AREPORT.missing.length === 0, `${AREPORT.missing.length} textures found in neither jar`);
ok(AREPORT.fromOldCount / AREPORT.requested > 0.6,
   `only ${Math.round(100 * AREPORT.fromOldCount / AREPORT.requested)}% of textures came from 1.13.2`);
console.log(`   ${pass} ok`);

console.log('5. the alpha bleed (D-146)');
{
  // ⚠ WHAT THIS IS AND WHY IT IS AN ASSERTION. A cutout texture keeps a colour under its
  // transparent texels; in the 1.13.2 jar that colour is BLACK, and two things read it — the
  // fast-leaves path, which draws leaves in the OPAQUE layer where nothing is discarded, and
  // every mipmap and bilinear tap, which averages a texel with its neighbours. Session 4
  // photographed the result: every tree in the world mottled with black holes. `build-atlas.mjs`
  // now floods the opaque colour outward into the transparent texels. This asserts it happened,
  // and asserts it on the real pixels rather than on the report.
  const bleed = AREPORT.alphaBleed;
  ok(!!bleed, 'the atlas report carries no alphaBleed section — the pass did not run');
  if (bleed) {
    ok(bleed.tiles > 100, `only ${bleed.tiles} tiles were bled — the roster has hundreds of cutouts`);
    ok(bleed.texels > 5000, `only ${bleed.texels} texels were bled`);
  }
  // and the pixels themselves: no transparent texel may be black while it has an opaque
  // neighbour. `acacia_leaves` is the one the screenshot caught, so it is named.
  const png = decodePng(readFileSync(MCLITE_ROOT + 'assets/atlas.png'));
  const T = ATLAS.tile, COLS = ATLAS.cols;
  const at = (layer, x, y) => {
    const px = (layer % COLS) * T + x, py = Math.floor(layer / COLS) * T + y;
    const o = (py * png.width + px) * png.channels;
    return [png.data[o], png.data[o + 1], png.data[o + 2], png.channels === 4 ? png.data[o + 3] : 255];
  };
  let checked = 0, black = 0, worst = null;
  for (const name of ['block/acacia_leaves', 'block/oak_leaves', 'block/birch_leaves',
                      'block/grass', 'block/oak_sapling', 'block/glass', 'block/iron_bars']) {
    const layer = ATLAS.index[name];
    if (layer === undefined) continue;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const [r, g, b, a] = at(layer, x, y);
        if (a > 0) continue;
        // does it have an opaque neighbour? if so it must have been given that colour
        let hasOpaque = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= T || ny < 0 || ny >= T) continue;
          if (at(layer, nx, ny)[3] > 0) { hasOpaque = true; break; }
        }
        if (!hasOpaque) continue;
        checked++;
        if (r === 0 && g === 0 && b === 0) { black++; if (!worst) worst = `${name} (${x},${y})`; }
      }
    }
  }
  ok(checked > 50, `only ${checked} transparent texels next to an opaque one — this section is vacuous`);
  ok(black === 0, `${black} of ${checked} transparent texels are still black next to an opaque texel (first: ${worst})`);
  console.log(`   ${bleed ? bleed.texels : 0} texels bled in ${bleed ? bleed.tiles : 0} tiles · ${checked} edge texels checked, ${black} black`);
}

console.log('5. anti-vacuity');
{
  const av = [];
  const brk = (label, inv, mk) => av.push([label, inv(mk(false)) === true && inv(mk(true)) === false]);
  brk('a tile table off by one', (eq) => eq === true,
      (b) => (b ? engineNames[1] === LEGACY[2][0] : engineNames[1] === LEGACY[1][0]));
  brk('a legacy texture on the wrong atlas layer', (eq) => eq === true,
      (b) => (b ? ATLAS.index[LEGACY[1][1]] === 99 : ATLAS.index[LEGACY[1][1]] === 1));
  brk('the "minecraft:" prefix creeping back', (n) => n === 0,
      (b) => (b ? 1 : prefixed.length));
  brk('a black transparent texel passing the bleed test', (n) => n === 0,
      (b) => (b ? 1 : 0));
  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" is not distinguished from good data`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ tilecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('');
console.log(` ${LEGACY.length} legacy layers reserved at the front of a ${TILES.count}-layer atlas · ${AREPORT.fromOldCount}/${AREPORT.requested} from 1.13.2`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
