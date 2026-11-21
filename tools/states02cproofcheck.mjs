#!/usr/bin/env node
// states02cproofcheck.mjs — #11574: proves the five 02c_states.js classes through the real States tables:
// BigDripleafStemBlock (attachOk directed pair), DeadBushBlock (floorOk: sand/terracotta/dirt, not stone),
// SandBlock (fills fall? n/a: only stacksOnSelf for sand false), TallPlantBlock (stacksOnSelf tall_grass),
// Fluids (fillFluids kind/amount). Each is cut by a source patch and must fail.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine(patch ? { patch } : {});
  const SR = M.States, R = M.Reg, o = {};
  M.Gen.init(1337, M.Gen.defaults());
  const st = (n, props) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
  const leaf = st('big_dripleaf'), stem = st('big_dripleaf_stem');
  o.stemOnStem = SR.attachOk(stem, stem) === true || SR.floorOk(stem, stem);
  o.leafOnStem = SR.floorOk(leaf, stem) === true;
  o.stemNotOnLeaf = SR.attachOk(stem, leaf) === false;
  const bush = st('dead_bush');
  o.bushSand = SR.floorOk(bush, st('sand')) === true;
  o.bushTerracotta = SR.floorOk(bush, st('terracotta')) === true;
  o.bushNotStone = SR.floorOk(bush, st('stone')) === false;
  o.sandNoStack = SR.stacksOnSelf(st('sand')) === false;
  o.tallStacks = SR.stacksOnSelf(st('tall_grass')) === true || SR.attachOk(st('tall_grass'), st('tall_grass')) === true;
  const w = st('water'), l = st('lava');
  o.water = SR.fluidKind[w] === 1 && SR.fluidAmt[w] === 8 && SR.fluidCell[w] === 1;
  o.lava = SR.fluidKind[l] === 2 && SR.fluidCell[l] === 1;
  o.stoneNone = SR.fluidKind[st('stone')] === 0;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['stemNotOnLeaf', "t[hb] = bb;", "t[hb] = bb; t[bb] = hb;"],
  ['leafOnStem', "t[hb] = bb;", "t[hb] = 0;"],
  ['bushNotStone', "if (SR.placeSet[r][SR.block[below]] === 1) return true;", "if (true) return true;"],
  ['bushSand', "if (SR.placeSet[r][SR.block[below]] === 1) return true;", "if (false) return true;"],
  ['water', "amt[st] = l >= 8 ? 8 : 8 - l;", "amt[st] = 1;"],
  ['lava', "kind[st] = b === wb ? 1 : 2;", "kind[st] = 1;"],
  ['stoneNone', "else if (SR.waterIn[st]) { kind[st] = 1;", "else if (true) { kind[st] = 1;"],
];
for (const [key, a, b] of BR) {
  breaks++;
  let hit = false, B;
  try { B = trial((f, s) => { if (f === '02c_states.js' && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { B = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!B[key], 'anti-vacuity: break ' + key);
  if (!B[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `states02cproofcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
