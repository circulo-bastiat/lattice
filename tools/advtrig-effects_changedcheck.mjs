#!/usr/bin/env node
// advtrig-effects_changedcheck.mjs — G17-AT23 (#7985). Drives the REAL call site (Effects.addStatusEffect ->
// onStatusEffectApplied -> Adv.trigger 'minecraft:effects_changed') against EffectsChangedCriterion. Users of the
// trigger: nether/all_potions, nether/all_effects (effects map), husbandry/kill_axolotl_target (source = axolotl).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '07q_effects.js'];
const POTIONS = ['speed', 'slowness', 'strength', 'jump_boost', 'regeneration', 'fire_resistance', 'water_breathing',
  'invisibility', 'night_vision', 'weakness', 'poison', 'slow_falling', 'resistance'];
let asserted = 0;

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const P = MCL.Player = { x: 0, y: 70, z: 0, type: 'player', health: 20, maxHealth: 20, food: 20 };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const has = (id) => done.includes('minecraft:' + id);
  const add = (n, src) => MCL.Effects.addStatusEffect(P, n, 600, 0, false, true, true, src);
  POTIONS.slice(0, 12).forEach((n) => no(add(n), 'effect not added: ' + n));
  no(!has('nether/all_potions'), 'all_potions granted with 12 of 13 effects');
  no(!has('nether/all_effects'), 'all_effects granted with a partial set');
  add(POTIONS[12]);
  no(has('nether/all_potions'), 'all_potions not completed with all 13');
  no(!has('nether/all_effects'), 'all_effects granted without the full 26');
  no(!has('husbandry/kill_axolotl_target'), 'axolotl source granted without a source');
  add('weakness', { type: 'zombie' });
  no(!has('husbandry/kill_axolotl_target'), 'axolotl advancement granted by a zombie source');
  MCL.Effects.removeStatusEffect(P, 'weakness');
  add('weakness', { type: 'axolotl', x: 0, y: 70, z: 0 });
  no(has('husbandry/kill_axolotl_target'), 'axolotl advancement not completed by an axolotl source');
  return f;
}
const fails = run();
const brk = (file, a, b) => (fl, s) => { if (fl !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('07q_effects.js', "'minecraft:effects_changed', {", "'minecraft:effects_changed_x', {")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:effects_changed'] = function", "Adv.matchers['minecraft:x'] = function")],
  ['effects ignored', brk('02l_advancements.js', "if (!fx || !P.range(w.amplifier, fx.amplifier) || !P.range(w.duration, fx.duration) ||\n        (has(w.ambient) && w.ambient !== !!fx.ambient) || (has(w.visible) && w.visible !== !!fx.showParticles)) return false;", "if (false) return false;")],
  ['source ignored', brk('02l_advancements.js', "return !!ctx.source && P.extended(c.source", "return true || P.extended(c.source")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-effects_changedcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-effects_changedcheck: OK — ${caught} breaks caught`);
