#!/usr/bin/env node
// advtrig-recipe_unlockedcheck.mjs — G17-AT32. minecraft:recipe_unlocked: Adv.matchers + the Adv.unlockRecipes call site
// (ServerRecipeBook.unlockRecipes). Asserts the recipe advancement completes, a different recipe does not, then breaks itself.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

function run(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02l_advancements.js'], patch });
  const am = JSON.parse(readFileSync(join(ASSETS, 'advancements.meta.json'), 'utf8'));
  M.Adv.init({ advancements: readFileSync(join(ASSETS, 'advancements.bin')).toString('base64'), advancementsBytes: am.rawBytes });
  const f = [], no = (c, m) => { if (!c) f.push(m); };
  const A = M.Adv;
  const uses = [];
  A.manager.advancements.forEach((a) => {
    if (a.id.indexOf('minecraft:recipes/') !== 0) return;
    for (const k of Object.keys(a.criteria)) if (a.criteria[k].trigger === 'minecraft:recipe_unlocked') { uses.push(a); break; }
  });
  no(uses.length > 1000, 'expected ~1046 recipe_unlocked advancements, got ' + uses.length);
  const player = { advancements: new A.Tracker({}) };
  const done = (id) => player.advancements.getProgress(A.manager.get(id)).isDone();
  const id = 'minecraft:recipes/decorations/crafting_table';
  no(A.manager.get(id), 'advancement missing: ' + id);
  no(!done(id), 'done before unlock');
  no(A.unlockRecipes(player, ['minecraft:stick']) === 1, 'stick not newly unlocked');
  no(!done(id), 'unrelated recipe completed crafting_table');
  no(A.unlockRecipes(player, ['minecraft:crafting_table']) === 1, 'crafting_table not newly unlocked');
  no(done(id), 'crafting_table advancement not completed');
  no(A.unlockRecipes(player, ['minecraft:crafting_table']) === 0, 'repeat unlock counted');
  const m = A.matchers['minecraft:recipe_unlocked'];
  no(m && m({ recipe: 'minecraft:a' }, { recipe: 'minecraft:a' }) === true, 'matcher: equal ids');
  no(m && m({ recipe: 'minecraft:a' }, { recipe: 'minecraft:b' }) === false, 'matcher: different ids');
  return f;
}

const fails = run();
const breaks = [
  ['matcher removed', (f, s) => f === '02l_advancements.js' ? s.replace("Adv.matchers['minecraft:recipe_unlocked'] = function", "var unused = function") : s],
  ['matcher always true', (f, s) => f === '02l_advancements.js' ? s.replace("return String(c.recipe)", "return true || String(c.recipe)") : s],
  ['call site removed', (f, s) => f === '02l_advancements.js' ? s.replace("Adv.trigger(player, 'minecraft:recipe_unlocked',", "(function(){})(player,") : s],
];
let caught = 0;
for (const [name, patch] of breaks) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('  ✓ break caught: ' + name); } else fails.push('break NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-recipe_unlockedcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log('assertions passed ..... 10');
console.log(`${caught} breaks caught (advtrig-recipe_unlockedcheck OK)`);
