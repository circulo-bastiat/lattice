#!/usr/bin/env node
// fluidtilecheck.mjs — #2002 ANIM-2. FluidRenderer draws a fluid's four SIDES with the flowing sprite
// (water_flow / lava_flow, 32x32 frames; build-atlas packs the top-left 16x16 quadrant, which is all the side UVs
// sample) and its top/bottom with the still sprite. Meshes a lone water and a lone lava source and asserts the
// tile of every emitted quad, with layers 57/58/59 read from the shipped atlas index (src/02c_states.js pins them).
// ANTI-VACUITY: edits to the real sources, each of which must fail this check.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const index = JSON.parse(readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'assets', 'atlas-index.json'), 'utf8')).index;
const breakers = [
  ['water sides back on the still tile', '02c_states.js', '(ff === 2 || ff === 3) ? FLUIDS[fi].tile : FLUIDS[fi].flow', 'FLUIDS[fi].tile'],
  ['lava sides on the water flow tile', '02c_states.js', 'flow: 58', 'flow: 57'],
  ['mesher draws sides with the still tile', '05_mesher.js', 'fluidQuad(L, face, flow, tint, sky, blk);', 'fluidQuad(L, face, tile, tint, sky, blk);'],
  ['mesher draws the top with the flow tile', '05_mesher.js', 'tile = SR.partTiles[parts[pi] * 6 + 2]', 'tile = SR.partTiles[parts[pi] * 6]'],
];

function scene(patch) {
  const fails = []; let pass = 0;
  const ok = (c, m) => { if (c) pass++; else fails.push(m); };
  const MCL = loadEngine({ extra: ['07_world.js', '08_lighting.js'], dom: false, patch });
  const W = MCL.World, CH = MCL.CH, S = MCL.Section, M = MCL.Mesher, SR = MCL.States;
  M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true, smooth: true });
  W.init(1);
  MCL.Light.init(); MCL.Light.setAdapter(MCL.Light.worldAdapter());
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) W.getOrCreate(cx, cz).state = CH.GENERATED;
  const sec = W.getOrCreate(0, 0).sec[4];
  const put = (x, y, z, id) => S.set(sec, (y << 8) | (z << 4) | x, id);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) put(x, 0, z, SR.stateOf('stone'));
  put(2, 1, 2, SR.withLocal('water', 0));
  put(8, 1, 2, SR.withLocal('lava', 0));
  const buf = M.mesh(W.snapshotFor(0, 0, 4), null, 0, 0, 0);
  if (!buf) return { pass, fails: ['section did not mesh'] };
  const h = M.readHeader(buf), u32 = new Uint32Array(buf), seen = { water: {}, lava: {} };
  for (let L = 0; L < 3; L++) for (let q = 0; q < h.modelQuads[L]; q++) {
    const o = (h.modelOff[L] >> 2) + q * 16;
    const v = M.unpackModelVertex(u32[o], u32[o + 1], u32[o + 2], u32[o + 3]);
    (v.px < 6 * 256 ? seen.water : seen.lava)[v.face] = v.tile;
  }
  const want = { water: [57, 14], lava: [58, 48] };   // [flow, still]
  for (const k of ['water', 'lava']) {
    for (const f of [0, 1, 4, 5]) ok(seen[k][f] === want[k][0], `${k} side face ${f}: tile ${seen[k][f]}, want flow ${want[k][0]}`);
    ok(seen[k][2] === want[k][1], `${k} top: tile ${seen[k][2]}, want still ${want[k][1]}`);
  }
  ok(index['block/water_flow'] === 57 && index['block/lava_flow'] === 58 && index['block/water_overlay'] === 59,
     'atlas index: water_flow/lava_flow/water_overlay must be layers 57/58/59, got ' + [index['block/water_flow'], index['block/lava_flow'], index['block/water_overlay']]);
  ok(index['block/water_still'] === 14 && index['block/lava_still'] === 48, 'still tiles moved');
  return { pass, fails };
}

const base = scene(null);
const fail = base.fails.slice();
let breaks = 0;
for (const [name, file, from, to] of breakers) {
  const r = scene((f, src) => { if (f === file) { if (!src.includes(from)) throw new Error('break "' + name + '" no longer matches the source'); return src.replace(from, to); } return src; });
  if (r.fails.length) breaks++; else fail.push('anti-vacuity: break "' + name + '" was NOT caught');
}
for (const f of fail) console.log('  ✗ ' + f);
console.log(`OK  ${base.pass} assertions, ${fail.length} failures, ${breaks} breaks caught`);
process.exit(fail.length ? 1 : 0);
