#!/usr/bin/env node
// advtrig-player_generates_container_lootcheck.mjs — G17-AT41 (#8192). Chest minecart open (Mc.storageInteract -> Mc.generateLoot)
// fires minecraft:player_generates_container_loot once with the table id; breaks its own matcher and call site.
import { loadEngine } from './loadsrc.mjs';
const fails = []; let asserted = 0;

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const M = loadEngine({ extra: ['02f_tags.js', '02l_advancements.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false, patch });
  const Mc = M.Minecart, Adv = M.Adv;
  Adv.manager = new Adv.Manager();
  const mkAdv = (id, table) => ({ id, criteria: { c: { trigger: 'minecraft:player_generates_container_loot', conditions: { loot_table: table } } }, requirements: [['c']], rewards: { loot: [], recipes: [], experience: 0 } });
  const A = mkAdv('t:mine', 'minecraft:chests/abandoned_mineshaft'), B = mkAdv('t:other', 'minecraft:chests/simple_dungeon');
  Adv.manager.advancements.set(A.id, A); Adv.manager.advancements.set(B.id, B);
  const done = [], pl = { x: 0, y: 0, z: 0, advancements: new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) }) };
  M.Hud = { openCartChest: () => true };
  M.Loot = { rng: () => ({ nextInt: () => 0 }), rollTable: () => [{ item: 'bone', count: 1 }] };
  const cart = { type: 'chest_minecart', x: 0, y: 0, z: 0, inventory: [], lootTable: 'minecraft:chests/abandoned_mineshaft', lootTableSeed: 1 };
  Mc.storageInteract(cart, pl);
  no(done.length === 1 && done[0] === 't:mine', 'first open: expected only t:mine, got ' + done.join());
  no(cart.inventory.filter(Boolean).length === 1, 'cart was not rolled');
  cart.lootTable = null; done.length = 0;
  Mc.storageInteract(cart, pl);
  no(done.length === 0, 'second open fired again');
  const m = Adv.matchers['minecraft:player_generates_container_loot'];
  no(m && m({ loot_table: 'chests/x' }, { player: pl, table: 'minecraft:chests/x' }) && !(m && m({ loot_table: 'chests/y' }, { player: pl, table: 'minecraft:chests/x' })), 'matcher table compare');
  return f;
}
run().forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site removed', brk('07zzr_minecart.js', "'minecraft:player_generates_container_loot'", "'minecraft:x'")],
  ['condition ignored', brk('02l_advancements.js', "return stripNs(c.loot_table) === stripNs(ctx.table);", "return true;")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-player_generates_container_lootcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-player_generates_container_lootcheck: OK — ${caught} breaks caught`);
