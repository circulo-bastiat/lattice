#!/usr/bin/env node
// advtrig-entity_killed_playercheck.mjs — G17-AT16 (#7978). Drives the REAL call site (Survival.die ->
// Adv.trigger 'minecraft:entity_killed_player'); only adventure/root (killed_by_something) uses it. Breaks itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '14d_survival.js'];
const fails = []; let asserted = 0;
function run(patch, cond, want) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const root = Adv.manager.get('minecraft:adventure/root');
  if (cond) root.criteria.killed_by_something.conditions = cond;
  const done = [];
  const P = MCL.Player = { x: 0.5, y: 70, z: 0.5, type: 'player', health: 20 };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const crit = () => P.advancements.getProgress(root).criteria.get('killed_by_something').date !== null;
  MCL.Survival.die(P, 'fall');
  if (cond && !want) no(!crit(), 'non-matching condition completed it');
  else no(crit(), 'adventure/root killed_by_something not completed by the player death');
  return f;
}
run().forEach((m) => fails.push(m));
run(undefined, { killing_blow: { is_fire: false } }, true).forEach((m) => fails.push(m));
// a condition no killing blow meets (is_fire) must NOT complete it
run(undefined, { killing_blow: { is_fire: true } }).forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14d_survival.js', "'minecraft:entity_killed_player'", "'minecraft:entity_killed_player_x'")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:entity_killed_player'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch, name === 'no matcher' ? { killing_blow: { is_fire: false } } : undefined, name === 'no matcher'); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
// matcher ignoring killing_blow must be caught by the non-matching run
{ let bad; try { bad = run(brk('02l_advancements.js', 'P.extended(c.entity, lc, { \'this\': ctx.entity }) && P.damage(c.killing_blow, lc, ctx.damage)', 'P.extended(c.entity, lc, { \'this\': ctx.entity })'), { killing_blow: { is_fire: true } }); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (killing_blow ignored) → ' + bad[0]); } else fails.push('mutant NOT caught: killing_blow ignored'); }
if (fails.length) { console.log('advtrig-entity_killed_playercheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-entity_killed_playercheck: OK — ${caught} breaks caught`);
