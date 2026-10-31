#!/usr/bin/env node
// stagetablecheck.mjs — #1902 C2ME-4: NS.Gen.STAGES equals vanilla ChunkStatus.java (order + margin) and the RANGE constants.
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry } from './loadsrc.mjs';
const NS = loadEngine({}); initRegistry(NS);
const vsrc = readFileSync('.decomp/net/minecraft/world/chunk/ChunkStatus.java', 'utf8');
function parse(txt) {
  const out = []; const re = /register\(\s*"([a-z_]+)",\s*(?:null|field_\d+),\s*(-?\d+),/g; let m;
  while ((m = re.exec(txt))) out.push([m[1], +m[2]]);
  return out;
}
let n = 0, bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.log('FAIL ' + msg); } };
function verify(stages, txt, F, CV) {
  const v = parse(txt); let f = 0;
  const e = (c, m) => { if (!c) f++; };
  e(v.length === stages.length, 'count');
  v.forEach(([id, mg], i) => { e(stages[i] && stages[i].id === id && stages[i].margin === mg, id); });
  const st = Object.fromEntries(stages.map(s => [s.id, s]));
  e(st.features && st.features.read === F && st.features.write === F, 'features range');
  e(st.carvers && st.carvers.write === CV, 'carvers range');
  e(stages.every(s => s.dep === 0), 'dep');
  return f;
}
const S = NS.Gen.STAGES, F = NS.Features.RANGE, CV = NS.Carvers && NS.Carvers.RANGE;
ok(F === 1, 'F.RANGE'); ok(CV === 8, 'CV.RANGE ' + CV);
ok(verify(S, vsrc, F, CV) === 0, 'table vs vanilla');
let caught = 0;
const breaks = [
  () => verify(S.map((s, i) => i === 6 ? { ...s, margin: 7 } : s), vsrc, F, CV),
  () => verify(S.slice(0, -1), vsrc, F, CV),
  () => verify([S[1], S[0], ...S.slice(2)], vsrc, F, CV),
  () => verify(S.map(s => s.id === 'features' ? { ...s, write: 2 } : s), vsrc, F, CV),
  () => verify(S.map(s => s.id === 'noise' ? { ...s, dep: 1 } : s), vsrc, F, CV),
  () => verify(S, vsrc.replace('"carvers", field_12796, 8', '"carvers", field_12796, 4'), F, CV),
];
for (const b of breaks) { n++; if (b() > 0) caught++; else console.log('NOT CAUGHT'); }
console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`);
process.exit(bad || caught !== breaks.length ? 1 : 0);
