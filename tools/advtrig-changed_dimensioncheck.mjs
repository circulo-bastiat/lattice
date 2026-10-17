#!/usr/bin/env node
// advtrig-changed_dimensioncheck.mjs — G17-AT28 (#7994). Drives the REAL call site (World.setDimension ->
// Adv.trigger 'minecraft:changed_dimension'); users: nether/root, end/root, story/enter_the_nether, story/enter_the_end.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const fails = []; let asserted = 0;

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02l_advancements.js', '07_world.js'], dom: false, patch });
  MCL.World.init(1);
  MCL.Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const P = MCL.Player = { x: 0, y: 70, z: 0, type: 'player' };
  P.advancements = new MCL.Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const has = (id) => done.includes('minecraft:' + id);
  MCL.World.setDimension('overworld');
  no(done.length === 0, 'no-op switch granted something');
  MCL.World.setDimension('the_end');
  no(has('end/root') && has('story/enter_the_end'), 'the_end advancements not completed');
  no(!has('nether/root') && !has('story/enter_the_nether'), 'the_end completed a nether advancement');
  MCL.World.setDimension('the_nether');
  no(has('nether/root') && has('story/enter_the_nether'), 'nether advancements not completed');
  return f;
}
run().forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('07_world.js', "'minecraft:changed_dimension', {", "'minecraft:changed_dimension_x', {")],
  ['to ignored', brk('02l_advancements.js', "return c.to == null || dimId(c.to) === dimId(ctx.to);", "return true;")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:changed_dimension'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-changed_dimensioncheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-changed_dimensioncheck: OK — ${caught} breaks caught`);
