// shapetable.mjs — #4944. The vanilla OUTLINE / INTERACTION / VISUAL shape of every engine real state, ONE copy,
// two callers (gen-data.mjs for the browser, loadsrc.mjs for every headless check — same reason as supportrule.mjs).
//
// Source: tools/golden/blockshapes-1.18.2.tsv, produced by RUNNING the 1.18.2 bytecode (tools/extract-shapes.mjs).
// Collision is NOT here: the registry already carries it and shapecheck proves it equals vanilla's.
//
// The TSV is in vanilla registry order and the engine's states are in its own (blocks A-Z, mixed-radix properties), so the
// join is on `block[prop=value,...]` and needs the engine's property layout; it is read straight from block-runtime.bin
// with the registry decoder alone (no States, no Physics), so this module imports nothing from loadsrc.
//
//   -> { dict: [[x0,y0,z0,x1,y1,z1 (x1024), ...] per shape], outline|interaction|visual: run-length [dictIndex, run, ...] }
// dictIndex -1 = "the same as the collision shape" (vanilla's default for all three, and the fallback for the two engine-only
// states item_frame and glow_item_frame). Only the OVERRIDES are stored.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js'];

export function shapeTable(ASSETS) {
  const NS = new Function("'use strict';\n" + FILES.map((f) => readFileSync(join(ROOT, 'src', f), 'utf8')).join('\n') + '\nreturn MCL;')();
  const R = NS.Reg;
  const rm = JSON.parse(readFileSync(join(ASSETS, 'block-runtime.meta.json'), 'utf8'));
  R.decodeConstants(NS.Z.unpack(readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), rm.rawBytes));

  const dict = [], rows = new Map(), idx = new Map();
  for (const l of readFileSync(join(ROOT, 'tools', 'golden', 'blockshapes-1.18.2.tsv'), 'utf8').split('\n')) {
    const f = l.split('\t');
    if (f[0] === 'S') { idx.set(f[1], dict.length); dict.push(f[2] ? f[2].split(';').flatMap((b) => b.split(',').map(Number)) : []); }
    else if (/^\d/.test(f[0])) {
      const m = /^minecraft:(\w+)(?:\[(.*)\])?$/.exec(f[1]);
      rows.set(m[1] + '[' + (m[2] ? m[2].split(',').sort().join(',') : '') + ']', [f[2], f[5], f[4]].map((i) => (i === f[3] ? -1 : idx.get(i))));
    }
  }
  const out = [[], [], []], names = Object.keys(R.PROP).sort();
  for (let b = 0; b < R.blockCount; b++) for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) {
    const local = s - R.realFirst[b], kv = [];
    for (let k = R.propFirst[b]; k < R.propFirst[b + 1]; k++)
      kv.push(R.propNames[R.propId[k]] + '=' + R.valueNames[R.propVals[R.propValOff[k] + (((local / R.propStride[k]) | 0) % R.propValN[k])]]);
    const r = rows.get(R.names[b] + '[' + kv.sort().join(',') + ']') || [-1, -1, -1];
    out.forEach((rle, i) => { const n = rle.length; if (n && rle[n - 2] === r[i]) rle[n - 1]++; else rle.push(r[i], 1); });
  }
  // keep only the shapes an override points at
  const keep = new Map(), small = [];
  for (const rle of out) for (let i = 0; i < rle.length; i += 2) if (rle[i] >= 0) {
    if (!keep.has(rle[i])) { keep.set(rle[i], small.length); small.push(dict[rle[i]]); }
    rle[i] = keep.get(rle[i]);
  }
  return { dict: small, outline: out[0], interaction: out[1], visual: out[2] };
}
