#!/usr/bin/env node
// advtrig-levitationcheck.mjs — G17-AT24 (#7987). Drives the REAL call site (Sv.tick, per tick while levitating,
// start recorded by Effects.onStatusEffectApplied) against LevitationCriterion: end/levitate (distance.y min 50).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '07q_effects.js', '14d_survival.js'];
const fails = []; let asserted = 0;

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const mk = () => {
    const done = [];
    const P = { type: 'player', x: 0.5, y: 70, z: 0.5, health: 20, effects: {} };
    P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
    return [P, done];
  };
  const tick = (P) => { try { MCL.Survival.tick(P); } catch (e) { if (!/Survival|undefined|null/.test(e.message)) throw e; } };
  // levitates 40 blocks up: not enough
  let [P, done] = mk();
  MCL.Effects.addStatusEffect(P, 'levitation', 200, 0, false, true, true);
  P.y = 110; tick(P);
  no(!done.includes('minecraft:end/levitate'), 'granted at 40 blocks');
  P.y = 121; tick(P);
  no(done.includes('minecraft:end/levitate'), 'not granted at 51 blocks');
  // no levitation: never
  [P, done] = mk(); P.y = 200; tick(P);
  no(!done.includes('minecraft:end/levitate'), 'granted without levitation');
  // removed effect forgets the start
  [P, done] = mk();
  MCL.Effects.addStatusEffect(P, 'levitation', 200, 0, false, true, true);
  MCL.Effects.removeStatusEffect(P, 'levitation'); P.y = 200; tick(P);
  no(!done.includes('minecraft:end/levitate'), 'granted after levitation removed');
  return f;
}
run().forEach((m) => fails.push(m));
const brk = (file, a, c) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, c); };
const mutants = [
  ['call site gone', brk('14d_survival.js', "'minecraft:levitation', {", "'minecraft:levitation_x', {")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:levitation'] = function", "Adv.matchers['minecraft:x'] = function")],
  ['distance ignored', brk('02l_advancements.js', "return P.distance(c.distance, s[0], s[1], s[2], pl.x, pl.y, pl.z) && ", "return ")],
  ['distance never', brk('02l_advancements.js', "return P.distance(c.distance, s[0], s[1], s[2], pl.x, pl.y, pl.z) && ", "return false && ")],
  ['start not cleared', brk('07q_effects.js', "e.levitationStartPos = null;", "")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-levitationcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-levitationcheck: OK — ${caught} breaks caught`);
