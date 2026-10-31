#!/usr/bin/env node
// advancementcheck.mjs — PLAN G26c. The advancement data, tree layout and positioner.
//
//   node tools/advancementcheck.mjs
//
// §1 the data: every file in the jar is packed, and every one loads through AdvancementManager
//    (a parent that is missing would leave it unloaded).
// §2 the tree layout: 6 roots, the five tabs' advancement counts, x == depth, every sibling pair
//    at least one row apart, no two nodes within a row of each other in a column, the top of
//    every tree at row 0, and every row a value a Java `float` can hold (thirds appear).
// §3 the load order is Java's HashMap order, checked against an independent BigInt
//    implementation of Identifier.hashCode + HashMap.hash + bucket walk.
// §4 AdvancementProgress on real advancements (AND / OR requirements, fraction, ordering).
// §5 ANTI-VACUITY: the whole of §1-§4 is run against deliberately broken copies of the module
//    and of the data, and each must FAIL. "<n> breaks caught".

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { JARS } from './paths.mjs';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/advancements.meta.json'), 'utf8'));
const jarPath = existsSync(JARS + '/1.18.2.jar') ? JARS + '/1.18.2.jar' : JARS + '/1.18.2/1.18.2.jar';
const jarNames = new Jar(jarPath).names().filter((n) => n.startsWith('data/minecraft/advancements/') && n.endsWith('.json'));
const SRC = readFileSync(join(ROOT, 'src/02l_advancements.js'), 'utf8');

function engine(src, dataB64, bytes) {
  const NS = {};
  new Function('MCL', readFileSync(join(ROOT, 'src/00_ns.js'), 'utf8'))(NS);
  new Function('MCL', readFileSync(join(ROOT, 'src/01_util.js'), 'utf8'))(NS);
  new Function('MCL', readFileSync(join(ROOT, 'src/01b_inflate.js'), 'utf8'))(NS);
  new Function('MCL', src)(NS);
  NS.Adv.init({ advancements: dataB64, advancementsBytes: bytes });
  return NS.Adv;
}

// independent Java HashMap order (BigInt, no Math.imul)
function javaOrder(ids) {
  const M = 1n << 32n;
  const sh = (s) => { let h = 0n; for (const ch of s) h = (h * 31n + BigInt(ch.charCodeAt(0))) % M; return h; };
  let n = 1; while (n < Math.floor(ids.length / 0.75 + 1)) n *= 2;
  const rows = ids.map((id, i) => {
    const [ns, p] = id.split(':');
    const h = (31n * sh(ns) + sh(p)) % M;
    return { id, i, b: Number((h ^ (h >> 16n)) & BigInt(n - 1)) };
  });
  return rows.sort((a, b) => a.b - b.b || a.i - b.i).map((r) => r.id);
}

let asserted = 0;
/** Returns the list of failures. Empty means every claim held. */
function verify(A) {
  const f = [];
  const no = (c, m) => { asserted++; if (!c) f.push(m); };
  const mgr = A.manager, all = [...mgr.advancements.values()];
  // §1
  no(jarNames.length === 1141, `jar has ${jarNames.length} advancement files, expected 1141`);
  no(meta.files === 1141, `pack meta says ${meta.files} files`);
  no(Object.keys(A.data).length === 1141, `${Object.keys(A.data).length} packed, expected 1141`);
  no(mgr.advancements.size === 1141, `${mgr.advancements.size} loaded by the manager, expected 1141`);
  for (const n of jarNames) {
    const id = 'minecraft:' + n.slice('data/minecraft/advancements/'.length, -5);
    if (!mgr.get(id)) { no(false, `${id} did not load`); break; }
  }
  // §2
  no(mgr.roots.length === 6, `${mgr.roots.length} roots, expected 6`);
  const tabs = {};
  for (const a of all) if (a.display) { const t = a.id.split('/')[0]; tabs[t] = (tabs[t] || 0) + 1; }
  const want = { 'minecraft:story': 16, 'minecraft:nether': 24, 'minecraft:end': 9, 'minecraft:adventure': 28, 'minecraft:husbandry': 18 };
  for (const t in want) no(tabs[t] === want[t], `${t} has ${tabs[t]} displayed advancements, expected ${want[t]}`);
  no(all.filter((a) => a.display).length === 95, 'displayed advancement count is not 95');
  const shown = mgr.roots.filter((r) => r.display);
  no(shown.length === 5, `${shown.length} displayed roots, expected 5`);
  for (const r of shown) {
    const nodes = [], walk = (a, d) => { nodes.push([a, d]); a.children.forEach((c) => walk(c, d + 1)); };
    walk(r, 0);
    let min = Infinity;
    const cols = {};
    for (const [a, d] of nodes) {
      const dp = a.display;
      no(dp.x === d, `${a.id}: x ${dp.x} != depth ${d}`);
      no(Math.fround(dp.y) === dp.y, `${a.id}: y ${dp.y} is not a float`);
      no(dp.y >= 0, `${a.id}: negative row ${dp.y}`);
      min = Math.min(min, dp.y);
      (cols[d] = cols[d] || []).push(dp.y);
      const rows = a.children.map((c) => c.display.y);
      for (let i = 1; i < rows.length; i++) no(rows[i] - rows[i - 1] >= 1, `${a.id}: children ${i - 1},${i} are ${rows[i] - rows[i - 1]} apart`);
    }
    no(min === 0, `${r.id}: top row is ${min}`);
    for (const d in cols) {
      const ys = cols[d].slice().sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) no(ys[i] - ys[i - 1] >= 1, `${r.id}: column ${d} has two nodes ${ys[i] - ys[i - 1]} apart`);
    }
  }
  // §3
  const ids = Object.keys(A.data);
  const got = A.hashOrder(ids), exp = javaOrder(ids);
  no(got.join() === exp.join(), 'hashOrder differs from the BigInt Java HashMap order');
  // sibling order is the ORDER BUILT: the loader sweeps the map repeatedly, building whatever
  // has its parent already (an independent re-run of AdvancementManager.load's loop)
  const built = new Set(), seq = [];
  let left = exp.slice();
  while (left.length) {
    const rest = [];
    for (const id of left) {
      const par = A.data[id].p;
      if (par === undefined || built.has(par)) { built.add(id); seq.push(id); } else rest.push(id);
    }
    if (rest.length === left.length) break;
    left = rest;
  }
  const rank = new Map(seq.map((id, i) => [id, i]));
  for (const a of all) {
    const r = a.children.map((c) => rank.get(c.id));
    if (r.some((x, i) => i && x < r[i - 1])) { no(false, `${a.id}: children are not in build order`); break; }
  }
  no(A.identifierHash('x:hello') === 99166042, 'Identifier hash of x:hello is not 31*120+99162322');
  // §4
  const nether = mgr.get('minecraft:nether/all_effects');
  const p = new A.Progress(); p.init(nether.criteria, nether.requirements);
  no(!p.isDone() && p.getProgressBarPercentage() === 0 && p.getProgressBarFraction() === null, 'fresh progress is not empty');
  no(p.obtain('all_effects', 5) && !p.obtain('all_effects', 6) && !p.obtain('nope', 1), 'obtain');
  no(p.isDone() && p.getProgressBarPercentage() === 1, 'single requirement not done');
  no(p.reset('all_effects') && !p.isDone(), 'reset');
  const arms = mgr.get('minecraft:adventure/adventuring_time');            // 42 AND requirements
  const q = new A.Progress(); q.init(arms.criteria, arms.requirements);
  const n = arms.requirements.length;
  q.obtain(arms.requirements[0][0], 9);
  no(q.getProgressBarFraction() === '1/' + n, `fraction ${q.getProgressBarFraction()} for ${n} requirements`);
  no(q.getProgressBarPercentage() === Math.fround(1 / n), 'percentage is not fround(1/n)');
  const rc = mgr.get('minecraft:recipes/misc/charcoal');                    // one OR row of two
  no(rc.requirements.length === 1 && rc.requirements[0].length === 2, 'charcoal is not one OR row');
  const r2 = new A.Progress(); r2.init(rc.criteria, rc.requirements);
  r2.obtain(rc.requirements[0][1], 3);
  no(r2.isDone(), 'an OR row needs only one of its criteria');
  const r3 = new A.Progress(); r3.init(rc.criteria, rc.requirements);
  no(q.compareTo(r3) === -1 && r3.compareTo(q) === 1 && r3.compareTo(new A.Progress()) === 0, 'progress ordering');
  const rt = A.Progress.fromJson(JSON.parse(JSON.stringify(q.toJson())));
  no(rt.getObtainedCriteria().join() === q.getObtainedCriteria().join(), 'json round trip');
  no(A.Merger.AND(['a', 'b']).length === 2 && A.Merger.OR(['a', 'b']).length === 1, 'merger');
  return f;
}

const good = engine(SRC, b64('advancements.bin'), meta.rawBytes);
const fails = verify(good);
const say = (...a) => console.log(...a);
say(`   advancements ${good.manager.advancements.size}, roots ${good.manager.roots.length}`);

// §5 — every mutant must be caught
const mutSrc = (from, to) => { if (!SRC.includes(from)) throw new Error('mutant anchor gone: ' + from); return SRC.replace(from, to); };
const mutData = (fn) => {
  const A = JSON.parse(Buffer.from(require_inflate(b64('advancements.bin')), 'utf8'));
  fn(A.a);
  return A;
};
import { inflateRawSync, deflateRawSync } from 'node:zlib';
function require_inflate(b) { return inflateRawSync(Buffer.from(b, 'base64')).toString('utf8'); }
const repack = (o) => { const raw = Buffer.from(JSON.stringify(o)); return [deflateRawSync(raw).toString('base64'), raw.length]; };
const mutants = [
  ['pushDown never moves the row', () => engine(mutSrc('p.row = fr(p.row + amount);', ''), b64('advancements.bin'), meta.rawBytes)],
  ['no float rounding', () => engine(mutSrc('var fr = Math.fround;', 'var fr = function (x) { return x; };'), b64('advancements.bin'), meta.rawBytes)],
  ['children ordered backwards', () => engine(mutSrc('if (this.children.indexOf(a) < 0) this.children.push(a);', 'if (this.children.indexOf(a) < 0) this.children.unshift(a);'), b64('advancements.bin'), meta.rawBytes)],
  ['HashMap spread dropped', () => engine(mutSrc('((h ^ (h >>> 16)) & (n - 1))', '(h & (n - 1))'), b64('advancements.bin'), meta.rawBytes)],
  ['OR row treated as AND', () => engine(mutSrc('if (c && c.date !== null) return true;', 'if (!c || c.date === null) return false;'), b64('advancements.bin'), meta.rawBytes)],
  ['an advancement missing from the data', () => { const o = mutData((a) => { delete a['minecraft:story/mine_stone']; }); const [d, n] = repack(o); return engine(SRC, d, n); }],
  ['a parent that does not exist', () => { const o = mutData((a) => { a['minecraft:story/mine_stone'].p = 'minecraft:nowhere'; }); const [d, n] = repack(o); return engine(SRC, d, n); }],
  ['a requirement row split in two', () => { const o = mutData((a) => { a['minecraft:recipes/misc/charcoal'].q = [['has_log'], ['has_the_recipe']]; }); const [d, n] = repack(o); return engine(SRC, d, n); }],
];
let caught = 0;
for (const [name, mk] of mutants) {
  let bad;
  try { bad = verify(mk()); } catch (e) { bad = ['threw: ' + e.message]; }
  if (bad.length) { caught++; say('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) {
  console.log('advancementcheck: FAIL');
  for (const m of fails.slice(0, 40)) console.log('   x ' + m);
  process.exit(1);
}
console.log(`assertions passed ..... ${asserted}`);
console.log(`advancementcheck: OK — 1141 advancements, 6 roots, 95 positioned, ${caught} breaks caught`);
