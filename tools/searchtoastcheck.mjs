#!/usr/bin/env node
// searchtoastcheck.mjs - #11724: net.minecraft.client.search.* + toast.{SystemToast,RecipeToast} (src/14p_search.js). Compares the suffix array
// against brute-force substring search, checks container semantics, toast queue rules, wiring (creative search, build.mjs); mutants must be caught.
import { readFileSync } from 'node:fs';
const src = (f) => readFileSync(f, 'utf8');
let fails = [], breaks = 0, pass = 0;
function run(mut) {
  const t0 = src('src/14p_search.js'), code = mut ? mut(t0) : t0;
  if (mut && code === t0) throw new Error('mutant did not change source');
  const MCL = {}; new Function('MCL', code + '\nreturn MCL;')(MCL); return MCL;
}
function checks(M) {
  const out = [], S = M.Search, T = M.Toasts;
  const words = ['stone', 'stone_bricks', 'cobblestone', 'oak_planks', 'ab', 'a', 'banana', 'bandana', 'Stone Slab'.toLowerCase(), 'oak_log'];
  const sa = new S.SuffixArray(); words.forEach((w) => sa.add(w, w)); sa.build();
  let bad = 0;
  for (const q of ['stone', 'one', 'an', 'oak', 'a', 'k_', 'ban', 'zzz', 'bricks', 'slab', 'ana']) {
    const want = words.filter((w) => w.includes(q)), got = sa.findAll(q);
    if (JSON.stringify(want) !== JSON.stringify(got)) bad++;
  }
  out.push(['suffix array == brute-force substring search, in insertion order', bad === 0]);
  const items = [{ id: 'minecraft:stone', n: 'Stone' }, { id: 'minecraft:oak_stairs', n: 'Oak Stairs' }, { id: 'mod:stone_gear', n: 'Gear of Stone' }];
  const c = new S.TextSearchableContainer((o) => [o.n], (o) => [o.id]); items.forEach((o) => c.add(o)); c.reload();
  out.push(['text query hits names only', c.findAll('stone').length === 2 && c.findAll('stairs')[0] === items[1]]);
  out.push(['ns:path intersects namespace and path|text', c.findAll('mod:stone').length === 1 && c.findAll('minecraft:stone')[0] === items[0] && c.findAll('minecraft:gear').length === 0]);
  const ic = new S.IdentifierSearchableContainer((o) => [o.id]); items.forEach((o) => ic.add(o)); ic.reload();
  out.push(['identifier container: path search, no name search', ic.findAll('stone').length === 2 && ic.findAll('Stairs').length === 0 && ic.findAll('stairs').length === 1]);
  out.push(['identifier ns:path', ic.findAll('minecraft:stone').length === 1 && ic.findAll('mod:stone').length === 1 && ic.findAll('mod:oak').length === 0]);
  T.list = [];
  const r1 = T.recipeShow('r1'), r2 = T.recipeShow('r2');
  out.push(['recipe toasts merge into one', r1 === r2 && T.list.length === 1 && r1.recipes.length === 2]);
  out.push(['recipe icon cycles every 5000/n ms', T.recipeAt(r1, 0) === 'r1' && T.recipeAt(r1, 2500) === 'r2' && T.recipeAt(r1, 5000) === 'r1']);
  out.push(['visible 5 s from first draw, restarts on update', T.visible(r1, 1000) && T.visible(r1, 5999) && !T.visible(r1, 6000) && (T.recipeShow('r3'), T.visible(r1, 7000) && T.visible(r1, 11999) && !T.visible(r1, 12000))]);
  T.list = [];
  out.push(['3 recipes cycle every 1666 ms', r1.recipes.length === 3 && T.recipeAt(r1, 1700) === 'r2' && T.recipeAt(r1, 3400) === 'r3']);
  const a = T.systemShow('pack_copy_failure', 'x', 'y'), b = T.systemShow('pack_copy_failure', 'x2', null), d = T.systemShow('narrator_toggle', 'n');
  out.push(['system show updates same-type toast, new type adds', a === b && b.title === 'x2' && b.desc === null && d !== a && T.list.length === 2]);
  T.systemAdd('narrator_toggle', 'again'); out.push(['system add always queues', T.list.length === 3]);
  T.tick(0); T.tick(5000); out.push(['tick expires toasts after 5 s', T.list.length === 0]);
  out.push(['failure helpers use vanilla keys', T.worldAccessFailure('m').title === 'selectWorld.access_failure' && T.worldDeleteFailure('m').title === 'selectWorld.delete_failure' && T.packCopyFailure('m').type === 'pack_copy_failure']);
  return out;
}
{ const r = checks(run()); for (const [m, v] of r) { if (v) pass++; else fails.push(m); } }
const wires = [['src/15e_creative.js', 'NS.Search.TextSearchableContainer'], ['build.mjs', "'14p_search.js'"]];
for (const [f, s] of wires) if (src(f).includes(s)) pass++; else fails.push(`${f} no longer has ${s}`);
const MUT = [
  (s) => s.replace('this.compare(s, mid) > 0) lo = mid + 1', 'this.compare(s, mid) > 1) lo = mid + 1'),
  (s) => s.replace('if (c >= 0) lo = mid + 1', 'if (c > 0) lo = mid + 1'),
  (s) => s.replace('if (c === -1) return 1;', 'if (c === -1) return -1;'),
  (s) => s.replace("both(this.byNamespace.findAll(q.slice(0, c).trim()), this.byPath", "either(this.byNamespace.findAll(q.slice(0, c).trim()), this.byPath"),
  (s) => s.replace('Tt.DURATION / n', 'Tt.DURATION / 2'),
  (s) => s.replace('time - t.start < Tt.DURATION', 'time - t.start <= Tt.DURATION'),
  (s) => s.replace('t.recipes.push(recipe); t.justUpdated = true;', 't.recipes.push(recipe);'),
  (s) => s.replace("if (!t) return Tt.systemAdd(type, title, desc);", "if (true) return Tt.systemAdd(type, title, desc);"),
  (s) => s.replace("'selectWorld.delete_failure'", "'selectWorld.access_failure'"),
  (s) => s.replace('this.textFinder(o).forEach', '[].forEach'),
];
for (const m of MUT) { let r; try { r = checks(run(m)); } catch (e) { breaks++; continue; } if (r.some(([, v]) => !v)) { breaks++; console.log("✓ mutant caught"); } else fails.push('mutant survived: ' + m.toString().slice(0, 70)); }
for (const f of fails) console.log('FAIL', f);
console.log(`searchtoastcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length || breaks < MUT.length ? 1 : 0);
