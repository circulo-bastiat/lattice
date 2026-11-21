#!/usr/bin/env node
// structpool11757check.mjs — #11757: net/minecraft/structure/pool/* (EmptyPoolElement, FeaturePoolElement, ListPoolElement,
// SinglePoolElement, StructurePool, StructurePoolBasedGenerator, StructurePoolElement(+Type), StructurePools) live in 04t_jigsaw.js
// (compileElement/poolOf/assemble). Every vanilla template_pool is compiled and a real village start is assembled through them.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(cut) {
  const M = loadEngine({ extra: ['07l_spawn.js'], dom: false, patch: (f, t) => {
    if (f !== '04t_jigsaw.js' || !cut) return t;
    if (!t.includes(cut[0])) throw new Error('cut not found: ' + cut[0]);
    return t.replace(cut[0], cut[1]);
  } });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  return M;
}
function probe(M) {
  const out = { kinds: {}, pools: 0, err: null, village: 0, fallbacks: 0 };
  const JG = M.Jigsaw;
  const names = Array.from(M.WG.names('template_pool'));
  const list = names.length ? names : ['village/plains/houses', 'village/plains/streets', 'village/plains/terminators', 'village/plains/town_centers', 'village/plains/zombie/houses', 'bastion/mobs/piglin', 'pillager_outpost/features'];
  const walk = (el) => { out.kinds[el.kind] = (out.kinds[el.kind] || 0) + 1; if (el.kind === 'list') el.subs.forEach(walk); };
  for (const n of list) {
    try { const p = JG.poolOf(n); out.pools++; if (p.fallback) out.fallbacks++; p.elements.forEach((e) => walk(e.el)); }
    catch (e) { out.err = String(e.message || e); break; }
  }
  try {
    for (let cz = -80; cz <= 80 && !out.village; cz += 4) for (let cx = -80; cx <= 80 && !out.village; cx += 4)
      for (const s of M.Structures.startsNear(cx, cz)) if (/village/.test(s.def.name) && s.pieces.length > 3) { out.village = s.pieces.length; break; }
  } catch (e) { out.err = out.err || String(e.message || e); }
  return out;
}
const M = trial(); const b = probe(M);
ok(!b.err, 'baseline error: ' + b.err);
ok(b.pools >= 7, 'pools compiled ' + b.pools);
for (const k of ['single', 'empty', 'feature', 'list']) ok(b.kinds[k] > 0, 'element kind present: ' + k);
ok(b.fallbacks > 0, 'StructurePool fallback kept');
ok(b.village > 3, 'village assembled through StructurePoolBasedGenerator');
const cuts = [
  ["if (t === 'empty_pool_element') return { kind: 'empty' };", ""],
  ["if (t === 'feature_pool_element') {", "if (false) {"],
  ["if (t === 'list_pool_element') {", "if (false) {"],
  ["kind: 'single', tpl: ti", "kind: 'singlex', tpl: ti"],
  ["fallback: src.fallback ? String(src.fallback).replace('minecraft:', '') : null", "fallback: null"],
  ["JG.assemble = function (opts) {", "JG.assemble = function (opts) { return null;"],
];
for (const c of cuts) {
  breaks++;
  let caught;
  try { const p = probe(trial(c)); caught = !!p.err || p.village <= 3 || !(p.kinds.empty > 0 && p.kinds.feature > 0 && p.kinds.list > 0 && p.kinds.single > 0 && p.fallbacks > 0); }
  catch (e) { caught = true; }
  ok(caught, 'anti-vacuity: cut survived: ' + c[0]);
  if (caught) console.log('  ✓ break caught');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `structpool11757check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
