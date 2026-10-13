#!/usr/bin/env node
// ghastmodelcheck.mjs — #640: the ghast draws all 10 parts of GhastEntityModel (body + 9 tentacles).
//
//   node tools/ghastmodelcheck.mjs [--verbose]
//
// Vanilla (.decomp GhastEntityModel.java): body cuboid(-8,-8,-8,16,16,16) uv(0,0) pivot(0,17.6,0);
// tentacle i = cuboid(-1,0,-1,2,h,2) uv(0,0), h = Random(1660L).nextInt(7)+8 in order, pivot
// x = (((i%3)-(i/3%2)*0.5+0.25)/2*2-1)*5, y = 24.6, z = ((i/3)/2*2-1)*5; sheet 64x32;
// setAngles: tentacle[i].pitch = 0.2*sin(age*0.3+i)+0.4. The expected numbers below are computed
// here from the .java's own formulas (an independent java.util.Random), not read from the table.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
  '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const BE = M.BEModel, ER = M.EntityRender;

function javaHeights() {
  const MASK = (1n << 48n) - 1n; let s = (1660n ^ 0x5DEECE66Dn) & MASK;
  const next = (b) => { s = (s * 0x5DEECE66Dn + 0xBn) & MASK; return Number(BigInt.asIntN(32, s >> (48n - BigInt(b)))); };
  const nextInt = (n) => { let r = next(31), u = r; for (; ((u - (r = u % n) + (n - 1)) | 0) < 0; u = next(31)); return r; };
  const hs = []; for (let i = 0; i < 9; i++) hs.push(nextInt(7) + 8); return hs;
}

function run(layer, kindOf, delta, o) {
  const parts = {}; for (const p of layer.parts) parts[p.n] = p;
  o(layer.parts.length === 10, 'ghast has 10 parts, not ' + layer.parts.length);
  const b = parts.body;
  o(!!b && b.w === 16 && b.h === 16 && b.d === 16 && b.py === 17.6, 'body is 16^3 at pivot y 17.6');
  const hs = javaHeights();
  for (let i = 0; i < 9; i++) {
    const t = parts['tentacle' + i];
    if (!o(!!t, 'tentacle' + i + ' exists')) continue;
    o(t.x === -1 && t.y === 0 && t.z === -1 && t.w === 2 && t.d === 2 && t.h === hs[i],
      'tentacle' + i + ' box (-1,0,-1,2,' + hs[i] + ',2), got h=' + t.h);
    o(t.tu === 0 && t.tv === 0, 'tentacle' + i + ' uv (0,0)');
    const px = (((i % 3) - (Math.trunc(i / 3) % 2) * 0.5 + 0.25) / 2 * 2 - 1) * 5;
    const pz = (Math.trunc(i / 3) / 2 * 2 - 1) * 5;
    o(t.px === px && t.py === 24.6 && t.pz === pz, 'tentacle' + i + ' pivot (' + px + ',24.6,' + pz + ')');
    const age = 7.5, d = delta('tentacle' + i, age);
    o(!!d && Math.abs(d.rx - (0.2 * Math.sin(age * 0.3 + i) + 0.4)) < 1e-9, 'tentacle' + i + ' pitch animates');
  }
  o(kindOf() === 'ghast', 'modelKindOf(ghast) is "ghast"');
}

const L = BE.layer('ghast');
run(L, () => ER.modelKindOf('ghast'),
    (n, age) => ER.setupAnimDelta(n, 0, 0, 0, 0, false, ER.modelKindOf('ghast'), { ageInTicks: age }), ok);
const passMain = pass;

// anti-vacuity: break the data five ways; each must be caught.
let caught = 0, breaks = 0;
const clone = () => JSON.parse(JSON.stringify(L));
const attempt = (mut, kind, dl) => {
  breaks++; const f = []; const c = clone(); mut(c);
  run(c, kind, dl, (cond, m) => { if (!cond) f.push(m); return cond; });
  if (f.length) caught++; else fails.push('break not caught: ' + mut);
};
const good = (n, age) => ER.setupAnimDelta(n, 0, 0, 0, 0, false, 'ghast', { ageInTicks: age });
attempt((c) => { c.parts = c.parts.filter((p) => p.n !== 'tentacle4'); }, () => 'ghast', good);
attempt((c) => { c.parts.find((p) => p.n === 'tentacle2').h = 15; }, () => 'ghast', good);
attempt((c) => { c.parts.find((p) => p.n === 'tentacle7').px = 0; }, () => 'ghast', good);
attempt((c) => {}, () => null, good);
attempt((c) => {}, () => 'ghast', () => null);
console.log(passMain + ' assertions, ' + fails.length + ' failures, ' + caught + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
process.exit(caught === breaks ? 0 : 1);
