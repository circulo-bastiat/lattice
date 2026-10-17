#!/usr/bin/env node
// bamboocheck.mjs (#4693) -- the bamboo you SEE is the bamboo you AIM at: one model-offset function shared by
// the mesher, the raycast and the outline, vanilla's hash, and the leaves-dependent outline box.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shapeTable } from './shapetable.mjs';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


const ASSETS = MCLITE_ROOT + 'assets';
const SRC = MCLITE_ROOT + 'src';
// ⚠ `10_camera.js` is here for §3b only: the check compares `Player.retarget`'s inlined forward
// vector against `Cam.forward`, and without the camera module there is nothing to compare to.
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
               '02c_states.js', '03_section.js', '05_mesher.js', '14b_physics.js', '14c_raycast.js',
               '10_camera.js'];
const SOURCE = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));

const RUNTIME = readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64');
const GEOMETRY = readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64');
const RMETA = JSON.parse(readFileSync(join(ASSETS, 'block-runtime.meta.json'), 'utf8'));
const TILEALPHA = JSON.parse(readFileSync(join(ASSETS, 'block-tiles.meta.json'), 'utf8')).alpha;
const GMETA = JSON.parse(readFileSync(join(ASSETS, 'block-geometry.meta.json'), 'utf8'));

const SHAPES = shapeTable(ASSETS);   // #4944: the vanilla outline table the crosshair reads

/** A whole engine namespace, optionally with one source file textually mutated. */
function boot(mutate) {
  const NS = {};
  const prev = globalThis.MCL;
  globalThis.MCL = NS;
  for (const f of FILES) {
    let src = SOURCE[f];
    if (mutate && mutate.file === f) {
      if (!src.includes(mutate.from)) throw new Error(`mutation anchor not found in ${f}: ${mutate.from}`);
      src = src.replace(mutate.from, mutate.to);
    }
    new Function('MCL', src)(NS);
  }
  globalThis.MCL = prev;
  NS.Reg.init({ runtime: RUNTIME, runtimeBytes: RMETA.rawBytes, geometry: GEOMETRY,
                geometryBytes: GMETA.rawBytes, tileAlpha: TILEALPHA, shapes: SHAPES });
  NS.Blocks.init();
  // a sparse fake world; the engine's own World is a chunk store and irrelevant here
  const cells = new Map();
  NS.World = {
    cells,
    set(x, y, z, id) { cells.set(x + ',' + y + ',' + z, id); return this; },
    clear() { cells.clear(); return this; },
    getBlock(x, y, z) { return cells.get(x + ',' + y + ',' + z) || 0; }
  };
  return NS;
}

const NS0 = boot(null);

// BigInt transcription of MathHelper.hashCode(x, 0, z) + AbstractBlockState.getModelOffset, independent of the imul shortcut
function refOffset(x, z, max, kind, vmul) {
  const M64 = (1n << 64n) - 1n, sg = (v) => BigInt.asIntN(64, v);
  let h = sg(BigInt(Math.imul(x, 3129871)) ^ (BigInt(z) * 116129781n));
  h = sg(h * h * 42317861n + h * 11n) >> 16n;
  const f = (v) => Math.fround(Number(v) / 15), cl = (v) => Math.max(-max, Math.min(max, v));
  return [cl((f(h & 15n) - 0.5) * 0.5), kind === 2 ? (f((h >> 4n) & 15n) - 1) * vmul : 0, cl((f((h >> 8n) & 15n) - 0.5) * 0.5)];
}

let pass = 0;
function run(mutate) {
  const NS = mutate ? boot(mutate) : NS0, R = NS.Reg, SR = NS.States, Ray = NS.Ray, W = NS.World, M = NS.Mesher;
  const bad = [];
  const need = (c, m) => { pass++; if (!c && bad.length < 8) bad.push(m); };
  const bamboo = R.realFirst[R.id.bamboo];
  const withLeaves = (v) => SR.withProp(bamboo, R.PROP.leaves, R.PVAL[v]);
  const out = [0, 0, 0];
  try { M.mesh({}, null, 0, 0, 0); } catch (e) { /* only primes the mesher's neighbour-offset table */ }
  M.scratchBlocks = new Uint16Array(18 * 18 * 18); M.scratchLight = new Uint8Array(18 * 18 * 18);
  let n = 0;
  for (let x = -40; x < 40; x += 3) for (let z = -37; z < 43; z += 4) {
    n++;
    // 1. the shared offset is vanilla's
    for (const [nm, kind, max, vm] of [['bamboo', 1, 0.25, 0], ['pointed_dripstone', 1, 0.125, 0], ['grass', 2, 0.25, Math.fround(0.2)], ['small_dripleaf', 2, 0.25, Math.fround(0.1)]]) {
      const st = R.realFirst[R.id[nm]];
      need(SR.modelOffset(st, x, z, out), nm + ' has an offset');
      const r = refOffset(x, z, max, kind, vm);
      need(r.every((v, i) => Math.abs(v - out[i]) < 1e-12), `${nm} offset at ${x},${z}: got ${out} want ${r}`);
    }
    // 2. aim at the VISIBLE stalk centre (the mesher's geometry), from all four sides, expect the bamboo; repeated casts agree
    const st = withLeaves('none');
    M.scratchBlocks.fill(0); M.scratchBlocks[1 * 324 + 1 * 18 + 1] = st;
    const buf = new Uint32Array(64 * 16);
    const end = M.emitModelBlock(buf, 0, R.toVisual[st], 0, 0, 0, 0xFFFFFFFF, 0xFFFFFFFF, 3, 0, x, 64, z, 1 * 324 + 1 * 18 + 1);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let o = 0; o < end; o += 4) {
      const v = M.unpackModelVertex(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
      x0 = Math.min(x0, v.px); x1 = Math.max(x1, v.px); z0 = Math.min(z0, v.pz); z1 = Math.max(z1, v.pz);
    }
    const cx = x + (x0 + x1) / 512, cz = z + (z0 + z1) / 512;
    W.clear().set(x, 64, z, st);
    for (const [ox, oz, dx, dz] of [[x - 3, cz, 1, 0], [x + 4, cz, -1, 0], [cx, z - 3, 0, 1], [cx, z + 4, 0, -1]]) {
      let hit = null;
      for (let k = 0; k < 3; k++) {
        const h = Ray.cast(ox, 64.5, oz, dx, 0, dz, 8);
        const s = h && `${h.x},${h.y},${h.z}`;
        need(hit === null || hit === s, `flicker at ${x},${z}`);
        hit = s;
      }
      need(hit === `${x},64,${z}`, `aimed at the visible stalk centre (${cx.toFixed(3)},${cz.toFixed(3)}) at ${x},${z}: selected ${hit}`);
    }
    // 3. the outline is the same box: it contains the visible centre
    const bx = Ray.selectionBoxes(st, x, 64, z)[0];
    need(cx - x >= bx[0] - 1e-6 && cx - x <= bx[3] + 1e-6 && cz - z >= bx[2] - 1e-6 && cz - z <= bx[5] + 1e-6, `outline misses the stalk at ${x},${z}`);
  }
  // 4. the leaves variant picks the outline box (BambooBlock.getOutlineShape): small/none 6px, large 10px wide
  // (at a spot whose offset is small: the ray's per-cell clamp would otherwise trim the 10px box against the cell wall)
  let qx = 0; while (!(SR.modelOffset(bamboo, qx, 0, out) && Math.abs(out[0]) < 0.05)) qx++;
  for (const [v, w] of [['none', 6], ['small', 6], ['large', 10]]) {
    const b = Ray.selectionBoxes(withLeaves(v), qx, 64, 0)[0];
    need(Math.abs((b[3] - b[0]) * 16 - w) < 1e-6, `leaves=${v}: outline ${((b[3] - b[0]) * 16).toFixed(2)}px wide, want ${w}`);
  }
  return { bad, n };
}

const base = run(null);
const basePass = pass;
console.log(`bamboo targeting: ${base.n} positions x offset/aim/outline`);
for (const m of base.bad) console.log('  FAIL ' + m);

// anti-vacuity (D-30): each mutation must trip the check
const MUT = [
  { file: '14c_raycast.js', from: '!S.modelOffset(id, x, z, OFFV)', to: 'true' },                 // raycast forgets the offset
  { file: '05_mesher.js', from: 'NS.States.modelOffset(M.scratchBlocks[pi], wx, wz, MOFF)', to: 'false' },   // mesher forgets it
  { file: '02c_states.js', from: 'Math.imul(z, 116129781)', to: 'Math.imul(z, 116129782)' },       // wrong hash
  { file: '14c_raycast.js', from: 'dx = OFFV[0] - OFF0[0]', to: 'dx = OFFV[0]' },            // table's baked-in (0,0) offset not removed
  { file: '14c_raycast.js', from: 'dz = OFFV[2] - OFF0[2]', to: 'dz = OFFV[2]' }
];
let caught = 0;
for (const m of MUT) { if (run(m).bad.length) { caught++; console.log('   ✓ caught: ' + m.from); } else console.log('  NOT CAUGHT: ' + m.from); }
console.log(` assertions passed .. ${basePass.toLocaleString()}`);
console.log(`${caught} breaks caught`);
if (base.bad.length || caught !== MUT.length) process.exit(1);
