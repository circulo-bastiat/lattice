#!/usr/bin/env node
// dripleaf11595check.mjs — #11595: proves 02k_survive.js's SmallDripleafBlock.canSurvive (rules 13 in both
// tables) through the real entry point World.canSurvive: tag floor, upper half needs own lower half, water rule.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, ASSETS } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '07_world.js'], dom: false, ...(patch ? { patch } : {}) });
  M.Tags.init({ tags: b64('tags.bin'), tagsBytes: rdj('tags.meta.json').blobBytes });
  const S = M.States, W = M.World, R = M.Reg, o = {};
  const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
  W.getBlock = (x, y, z) => cells.get(k(x, y, z)) || 0;
  W.loadedAt = () => true;
  const withProps = (n, p) => { let s = S.stateOf(n); for (const [a, b] of Object.entries(p)) s = S.withProp ? S.withProp(s, a, b) : s; return s; };
  const half = (h) => { const base = S.stateOf('small_dripleaf'); const all = []; for (let i = 0; i < 20344; i++) if (S.name(i) === 'small_dripleaf') all.push(i);
    return all.filter((s) => S.propValue(s, R.PROP.half) === R.PVAL[h]); };
  const lowers = half('lower'), uppers = half('upper');
  const lo = lowers[0], up = uppers[0];
  const on = (below, st) => { cells.clear(); cells.set(k(0, 0, 0), S.stateOf(below)); return W.canSurvive(0, 1, 0, st); };
  o.clay = on('clay', lo) === true;
  o.moss = on('moss_block', lo) === true;
  o.dirt = on('dirt', lo) === false;
  o.stone = on('stone', lo) === false;
  o.sand = on('sand', lo) === false;
  o.upperOnDirt = on('dirt', up) === false;
  cells.clear(); cells.set(k(0, 0, 0), lo); o.upperOnLower = W.canSurvive(0, 1, 0, up) === true;
  cells.clear(); cells.set(k(0, 0, 0), up); o.upperOnUpper = W.canSurvive(0, 1, 0, up) === false;
  cells.clear(); cells.set(k(0, 0, 0), S.stateOf('dirt')); cells.set(k(0, 1, 0), S.stateOf('water'));
  o.waterOnDirt = W.canSurvive(0, 1, 0, lo) === true;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const F = '02k_survive.js';
const BR = [
  ['upperhalf', 'return (SR.block[below] === SR.block[st] &&', 'return groundOk(L, SR.ground[SR.block[st]], x, y, z, below); (SR.block[below] === SR.block[st] &&', ['upperOnLower']],
  ['upperlower', "SR.propValue(below, R.PROP.half) === R.PVAL.lower) ? 1 : 0;", "true) ? 1 : 0;", ['upperOnUpper']],
  ['tag', "if (tagQ(L, 'small_dripleaf_placeable', below)) return 1;", '', ['clay', 'moss']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; if (process.env.DBG) console.log(e); }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  if (process.env.DBG) console.log(key, JSON.stringify(X)); const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `dripleaf11595check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
