#!/usr/bin/env node
// offhandcheck.mjs — #182 G19d-f: F swaps main hand and offhand (slot 40); Use.rightClick tries the
// OFF_HAND after the main hand PASSes; a spyglass/bow hold started from the offhand records useHand 1.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log("  ✓ break caught: " + m); } else fails.push("anti-vacuity: " + m); };
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '14i_hand.js', '14l_use.js',
               '07zze_oxidize.js', '07zx_particle.js', '14_player.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const W = { getBlock: () => 0, setBlock: () => false, blockLightAt: () => 15 };
MCL.World = W;
MCL.Behave.init(W); MCL.BlockEntities.init(); MCL.Use.init(W);
const Iv = MCL.Inventory, IT = MCL.Items, U = MCL.Use;
const P = MCL.Player; P.hotbar = new Array(9).fill(0);
const mk = (name, n) => ({ i: IT.of(name), n: n || 1, d: 0 });

function fresh() {
  P.inventory = Iv.create ? Iv.create() : { slots: new Array(Iv.SIZE).fill(Iv.EMPTY) };
  P.slot = 0; P.mode = 0; P.usingItem = false; P.useHand = 0;
}
function run(swap) {
  fresh();
  const a = mk('spyglass'), b = mk('bow');
  Iv.setItem(P.inventory, 0, a); Iv.setItem(P.inventory, Iv.OFFHAND, b);
  P.usingItem = true; P.handsBusy = true;
  const r = swap();
  return { r, main: Iv.getItem(P.inventory, 0), off: Iv.getItem(P.inventory, Iv.OFFHAND), a, b };
}
// 1. F swaps both ways and clears the hold
let t = run(() => P.swapHands());
ok(t.r === true && t.main === t.b && t.off === t.a, 'swapHands trades main and offhand stacks');
ok(!P.usingItem, 'swapHands ends the active hold (clearActiveItem)');
// anti-vacuity: a disabled swap is seen as failing
t = run(() => false);
okAv(!(t.main === t.b && t.off === t.a), 'the swap assertion fails when nothing swaps');
// 2. spectator: no swap
fresh(); Iv.setItem(P.inventory, 0, mk('bow'));
P.mode = MCL.Gamemode.SPECTATOR;
ok(P.swapHands() === false && Iv.isEmpty(Iv.getItem(P.inventory, Iv.OFFHAND)) && !Iv.isEmpty(Iv.getItem(P.inventory, 0)), 'spectator cannot swap');
// 3. empty main, spyglass offhand: rightClick(P) falls to the offhand and records useHand 1
fresh();
Iv.setItem(P.inventory, Iv.OFFHAND, mk('spyglass'));
const stub = Object.assign(Object.create(P), { mode: 0, instabuild: false, hasTarget: false, slot: 0, inventory: P.inventory,
  heldItem() { return Iv.getItem(this.inventory, this.slot); }, ex: 0, ey: 0, ez: 0, lookVec() { return [0, 0, 1]; } });
const res = U.rightClick(stub);
ok(res === 'use' && stub.usingItem && stub.useHand === 1, 'empty main + offhand spyglass: offhand use starts, useHand 1 (got ' + res + ')');
// main-hand item wins and records hand 0
fresh();
Iv.setItem(P.inventory, 0, mk('spyglass')); Iv.setItem(P.inventory, Iv.OFFHAND, mk('spyglass'));
const stub2 = Object.assign(Object.create(stub), { inventory: P.inventory, usingItem: false, useHand: 0 });
ok(U.rightClick(stub2) === 'use' && stub2.useHand === 0, 'main hand is tried first (useHand 0)');
okAv(!(U.rightClick(stub2, 1) === 'use' && stub2.useHand === 1), 'a hold already running refuses a second start');

// 4. shield / food held in the offhand: the hold records hand 1 and reads the offhand stack
fresh();
Iv.setItem(P.inventory, Iv.OFFHAND, mk('shield'));
const st3 = Object.assign(Object.create(stub), { inventory: P.inventory, usingItem: false, useHand: 0, food: 10 });
ok(U.rightClick(st3) === 'use' && st3.useKind === 'shield' && st3.useHand === 1 && U.shieldStack(st3) === Iv.getItem(P.inventory, Iv.OFFHAND), 'offhand shield: hold from hand 1, shieldStack is the offhand');
fresh();
Iv.setItem(P.inventory, Iv.OFFHAND, mk('bread'));
const st4 = Object.assign(Object.create(stub), { inventory: P.inventory, usingItem: false, useHand: 0, food: 10 });
ok(U.rightClick(st4) === 'use' && st4.useKind === 'drink' && st4.useHand === 1 && U.drinkMaxTicks(st4) > 0, 'offhand food: eat starts from hand 1 and reads the offhand stack');
okAv(!(U.useSlot(Object.assign(Object.create(st4), { useHand: 0 })) === Iv.OFFHAND), 'useSlot of hand 0 is not the offhand');

console.log(`\n=== offhandcheck ===\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}\n====================`);
for (const f of fails) console.log('FAIL ' + f);
process.exit(fails.length ? 1 : 0);
