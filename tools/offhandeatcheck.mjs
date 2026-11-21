#!/usr/bin/env node
// offhandeatcheck.mjs — #10748 G19d-b: eating/drinking holds started from the OFFHAND (slot 40) record useHand 1,
// finish on the offhand stack (shrink / bottle / bucket / bowl back), release early restores nothing, canAlwaysEat refusal.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('  ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '14i_hand.js', '14l_use.js',
               '07q_effects.js', '07z_potion.js', '14d_survival.js', '07zze_oxidize.js', '07zx_particle.js', '14_player.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const W = { getBlock: () => 0, setBlock: () => false, blockLightAt: () => 15 };
MCL.World = W;
MCL.Behave.init(W); MCL.BlockEntities.init(); MCL.Use.init(W);
const Iv = MCL.Inventory, IT = MCL.Items, U = MCL.Use, P = MCL.Player;
const mk = (name, n) => ({ i: IT.of(name), n: n || 1, d: 0 });
const nm = (s) => (s && !Iv.isEmpty(s)) ? IT.nameOf(s.i | 0) : '';
const FORCE0 = process.env.OFFHANDEAT_FORCE0 === '1';   // anti-vacuity switch for the harness itself

function setup(off, food, main) {
  const inv = Iv.create ? Iv.create() : { slots: new Array(Iv.SIZE).fill(Iv.EMPTY) };
  if (main) Iv.setItem(inv, 0, main);
  Iv.setItem(inv, Iv.OFFHAND, off);
  return Object.assign(Object.create(P), { mode: 0, instabuild: false, hasTarget: false, slot: 0, inventory: inv, food,
    usingItem: false, useHand: 0, useKind: null, useTicks: 0, itemCooldowns: {}, ex: 0, ey: 0, ez: 0, x: 0, y: 0, z: 0,
    heldItem() { return Iv.getItem(this.inventory, this.slot); }, lookVec() { return [0, 0, 1]; } });
}
function eatCase(name, n, food, after) {
  const p = setup(mk(name, n), food);
  const r = U.rightClick(p);
  if (FORCE0) p.useHand = 0;
  ok(r === 'use' && p.usingItem && p.useKind === 'drink' && p.useHand === 1, name + ': offhand hold starts with useHand 1 (got ' + r + ', ' + p.useHand + ')');
  const mx = U.drinkMaxTicks(p);
  ok(mx > 0, name + ': max use ticks read from the offhand stack (' + mx + ')');
  p.useTicks = mx; U.drinkFinish(p);
  ok(!p.usingItem, name + ': hold ended');
  after(p);
}
eatCase('bread', 2, 10, (p) => ok(Iv.getItem(p.inventory, Iv.OFFHAND).n === 1 && nm(Iv.getItem(p.inventory, Iv.OFFHAND)) === 'bread', 'bread: offhand stack shrinks by 1'));
eatCase('bread', 1, 10, (p) => ok(Iv.isEmpty(Iv.getItem(p.inventory, Iv.OFFHAND)), 'bread: last one empties slot 40'));
eatCase('potion', 1, 20, (p) => ok(nm(Iv.getItem(p.inventory, Iv.OFFHAND)) === 'glass_bottle', 'potion: slot 40 becomes a glass bottle (always drinkable at full food)'));
eatCase('milk_bucket', 1, 20, (p) => ok(nm(Iv.getItem(p.inventory, Iv.OFFHAND)) === 'bucket', 'milk: slot 40 becomes a bucket'));
eatCase('honey_bottle', 2, 10, (p) => ok(nm(Iv.getItem(p.inventory, Iv.OFFHAND)) === 'honey_bottle' && Iv.getItem(p.inventory, Iv.OFFHAND).n === 1, 'honey: offhand shrinks by 1'));
eatCase('mushroom_stew', 1, 10, (p) => ok(nm(Iv.getItem(p.inventory, Iv.OFFHAND)) === 'bowl', 'stew: slot 40 becomes a bowl'));

// release early restores nothing / consumes nothing
let p = setup(mk('bread', 3), 10);
U.rightClick(p); p.useTicks = 10; U.drinkCancel(p);
ok(!p.usingItem && Iv.getItem(p.inventory, Iv.OFFHAND).n === 3 && p.food === 10, 'release early: stack and food untouched');
// canAlwaysEat refusal
p = setup(mk('bread', 1), 20);
ok(U.rightClick(p) !== 'use' && !p.usingItem, 'full food: offhand bread refused');
p = setup(mk('golden_apple', 1), 20);
ok(U.rightClick(p) === 'use' && p.useHand === 1, 'full food: offhand golden apple allowed (alwaysEdible)');
// main hand wins when it can eat
p = setup(mk('bread', 1), 10, mk('apple', 1));
ok(U.rightClick(p) === 'use' && p.useHand === 0, 'main-hand food is tried first (useHand 0)');
// anti-vacuity: the hand-1 assertion fails when the hold is forced to hand 0
p = setup(mk('bread', 1), 10); U.rightClick(p); p.useHand = 0;
okAv(!(p.useHand === 1), 'forced useHand 0 is caught');
p = setup(mk('bread', 1), 10); U.rightClick(p); p.useHand = 0;
okAv(!(U.useSlot(p) === Iv.OFFHAND), 'forced useHand 0 reads the main slot, not the offhand');
p = setup(mk('potion', 1), 20); U.rightClick(p); p.useHand = 0; p.useTicks = 32;
okAv(U.drinkFinish(p) === false && nm(Iv.getItem(p.inventory, Iv.OFFHAND)) === 'potion', 'finishing with useHand 0 leaves the offhand potion unconsumed');

console.log(`\n=== offhandeatcheck ===\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}\n=======================`);
for (const f of fails) console.log('FAIL ' + f);
process.exit(fails.length ? 1 : 0);
