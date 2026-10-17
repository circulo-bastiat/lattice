#!/usr/bin/env node
// advtrig-brewed_potioncheck.mjs — G17-AT37. minecraft:brewed_potion: Adv.matchers + the PotionSlot.onTakeItem call site.
// Takes a potion out of a real brewing menu's bottle slot; asserts nether/brew_potion completes, that a non-matching
// `potion` condition does not, then breaks matcher and call site and requires the asserts to fail.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

function run(patch) {
  const M = loadEngine({
    extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02l_advancements.js', '14f_inventory.js', '14d_survival.js',
            '14g_menu.js', '07q_effects.js', '07z_potion.js', '07zzq_brewing.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
            '07f_redstone.js', '14b_physics.js', '07i_entitylist.js', '13_input.js', '15b_gui.js', '15_hud.js'],
    dom: false, patch
  });
  const im = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: im.rawBytes });
  const am = JSON.parse(readFileSync(join(ASSETS, 'advancements.meta.json'), 'utf8'));
  M.Adv.init({ advancements: readFileSync(join(ASSETS, 'advancements.bin')).toString('base64'), advancementsBytes: am.rawBytes });
  M.BlockEntities.init();
  const f = [], no = (c, m) => { if (!c) f.push(m); };
  const A = M.Adv, Inv = M.Inventory, Me = M.Menu;
  const take = (potion) => {
    M.BlockEntities.clear();
    const be = M.BlockEntities.create(0, 4, 0, 'brewing_stand');
    const pl = { x: 0, y: 4, z: 0, menu: { inventory: Inv.create() }, xpTotal: 0 };
    pl.advancements = new A.Tracker({});
    be.items[0] = M.Brewing.potionStack('potion', potion);
    const m = Me.brewingMenu(be, pl.menu.inventory);
    Me.doClick(m, 0, 0, Me.PICKUP, pl);
    return pl;
  };
  const done = (pl, id) => pl.advancements.getProgress(A.manager.get(id)).isDone();
  no(done(take('awkward'), 'minecraft:nether/brew_potion'), 'taking a brewed potion did not complete nether/brew_potion');
  const m = A.matchers['minecraft:brewed_potion'], pl = { x: 0, y: 0, z: 0 };
  no(m && m({}, { player: pl, potion: 'empty' }) === true, 'empty conditions should match');
  no(m && m({ potion: 'minecraft:awkward' }, { player: pl, potion: 'awkward' }) === true, 'same potion should match');
  no(m && m({ potion: 'minecraft:swiftness' }, { player: pl, potion: 'minecraft:awkward' }) === false, 'other potion matched');
  return f;
}

const fails = run();
const breaks = [
  ['matcher removed', (f, s) => f === '02l_advancements.js' ? s.replace("Adv.matchers['minecraft:brewed_potion'] = function", "var unused = function") : s],
  ['potion ignored', (f, s) => f === '02l_advancements.js' ? s.replace("return id === got;", "return true;") : s],
  ['call site removed', (f, s) => f === '14g_menu.js' ? s.replace("NS.Adv.trigger(pl, 'minecraft:brewed_potion'", "(function(){})(pl, 'minecraft:brewed_potion'") : s],
];
let caught = 0;
for (const [name, patch] of breaks) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('  ✓ break caught: ' + name); } else fails.push('break NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-brewed_potioncheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log('assertions passed ..... 4');
console.log(`${caught} breaks caught (advtrig-brewed_potioncheck OK)`);
