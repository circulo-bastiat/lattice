#!/usr/bin/env node
// fluidinsetcheck.mjs — #9523: fluid side faces are inset one 1/256 unit (vanilla 0.001, not representable).
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
  ['inset removed', '05_mesher.js', 'var FLUID_INSET = 1;', 'var FLUID_INSET = 0;'],
  ['inset doubled', '05_mesher.js', 'var FLUID_INSET = 1;', 'var FLUID_INSET = 2;'],
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
  const h = M.readHeader(buf), u32 = new Uint32Array(buf), got = {};
  for (let L = 0; L < 3; L++) for (let q = 0; q < h.modelQuads[L]; q++) {
    const o = (h.modelOff[L] >> 2) + q * 16;
    const v = M.unpackModelVertex(u32[o], u32[o + 1], u32[o + 2], u32[o + 3]);
    if (v.px < 6 * 256 && v.face !== 2 && v.face !== 3) (got[v.face] = got[v.face] || []).push(v.face >= 4 ? v.pz : v.px);
  }
  // face: [expected coordinate] — water at cell (2,*,2); 0=+X 1=-X 4=+Z 5=-Z
  const want = { 0: 3 * 256 - 1, 1: 2 * 256 + 1, 4: 3 * 256 - 1, 5: 2 * 256 + 1 };
  for (const f in want) ok(got[f] && got[f].length >= 1 && got[f].every(c => c === want[f]), `side face ${f}: coords ${got[f]}, want all ${want[f]} (1/256 inset)`);
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
