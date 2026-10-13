#!/usr/bin/env node
// drinkcheck.mjs — G19d-d (#179): DRINKING. PotionItem / MilkBucketItem / HoneyBottleItem / StewItem /
// SuspiciousStewItem .finishUsing, and the hold that drives them (Use.drinkStart / P.act tick / Use.drinkFinish).
// Vanilla numbers: .decomp/net/minecraft/item/{PotionItem,MilkBucketItem,HoneyBottleItem,StewItem,SuspiciousStewItem}.java
// and potion/Potions.java (effect rows are read out of the decomp here, not typed from memory).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');

const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07q_effects.js', '07z_potion.js',
  '14d_survival.js', '14l_use.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const IT = MCL.Items, Iv = MCL.Inventory, U = MCL.Use, ES = MCL.Effects;

function mk(name, n, tag, o) {
  const inv = Iv.create();
  Iv.setItem(inv, 0, Iv.stack(name, n, 0, tag));
  return Object.assign({ mode: 0, instabuild: false, slot: 0, inventory: inv, food: 10, saturation: 0, health: 10, effects: {},
    x: 0, y: 0, z: 0, exhaustion: 0, maxHealth: 20 }, o || {});
}
const held = (P) => Iv.getItem(P.inventory, P.slot);
const nm = (s) => (Iv.isEmpty(s) ? 'empty' : IT.nameOf(s.i));
/** One drink: press, hold `ticks` ticks (P.act's own loop), return P. */
function drink(P, ticks) {
  if (!U.drinkStart(P, held(P))) return false;
  for (let t = 0; t < ticks; t++) {
    P.useTicks += 1;
    if (!P.usingItem) break;
    const dm = U.drinkMaxTicks(P);
    if (P.useTicks >= dm) { U.drinkFinish(P); break; }
  }
  return true;
}
const potionRows = (id) => {
  const src = readFileSync(join(ROOT, '.decomp/net/minecraft/potion/Potions.java'), 'utf8');
  const re = new RegExp('"' + id + '"[^;]*?;', 's');
  const m = src.match(re);
  return m ? [...m[0].matchAll(/StatusEffects\.(\w+), (\d+)(?:, (\d+))?/g)].length : -1;
};

// ── potion: jar-exact effects, bottle remainder
{
  ok(existsSync(join(ROOT, '.decomp/net/minecraft/item/PotionItem.java')), 'decomp present');
  let P = mk('potion', 2, { Potion: 'minecraft:regeneration' });
  ok(drink(P, 32), 'potion hold starts');
  ok(ES.hasStatusEffect(P, 'regeneration') && P.effects.regeneration.duration === 900, 'regeneration 900 ticks (Potions.java)');
  ok(held(P).n === 1 && nm(held(P)) === 'potion', 'one potion consumed, one left');
  let bottles = 0; for (let i = 0; i < Iv.SIZE; i++) { const s = Iv.getItem(P.inventory, i); if (!Iv.isEmpty(s) && nm(s) === 'glass_bottle') bottles += s.n; }
  ok(bottles === 1, 'glass bottle handed back when the stack remains');
  P = mk('potion', 1, { Potion: 'minecraft:strong_swiftness' });
  drink(P, 32);
  ok(nm(held(P)) === 'glass_bottle', 'last potion becomes the glass bottle in place');
  ok(P.effects.speed && P.effects.speed.amplifier === 1 && P.effects.speed.duration === 1800, 'strong swiftness = speed II 1800');
  P = mk('potion', 1, { Potion: 'minecraft:healing' }, { health: 4 });
  drink(P, 32);
  ok(P.health === 8, 'instant health heals 4 immediately');
  P = mk('potion', 1, { Potion: 'minecraft:regeneration' }, { instabuild: true });
  drink(P, 32);
  ok(nm(held(P)) === 'potion' && held(P).n === 1 && ES.hasStatusEffect(P, 'regeneration'), 'creative: effect applies, potion not consumed');
  ok(potionRows('regeneration') >= 1, 'Potions.java defines regeneration (decomp read)');
  // early release does nothing
  P = mk('potion', 1, { Potion: 'minecraft:regeneration' });
  U.drinkStart(P, held(P)); P.useTicks = 31; U.bowRelease(P);
  ok(!P.usingItem && !P.handsBusy && !ES.hasStatusEffect(P, 'regeneration') && held(P).n === 1 && nm(held(P)) === 'potion', 'early release: nothing happens, stack intact');
  okAv(!ES.hasStatusEffect(P, 'regeneration'), 'a 31-tick hold must not apply (would fail if finish ran at 31)');
  ok(P.useTicks === 0, 'hold reset');
}
// ── milk
{
  let P = mk('milk_bucket', 1, null, { effects: { poison: ES.instance('poison', 100, 0), speed: ES.instance('speed', 100, 0) } });
  drink(P, 32);
  ok(Object.keys(P.effects).length === 0, 'milk clears ALL effects');
  ok(nm(held(P)) === 'bucket', 'milk leaves a bucket');
  P = mk('milk_bucket', 1, null, { effects: { poison: ES.instance('poison', 100, 0) } });
  drink(P, 31);
  ok(ES.hasStatusEffect(P, 'poison') && nm(held(P)) === 'milk_bucket', 'milk at 31 ticks: nothing');
}
// ── honey
{
  let P = mk('honey_bottle', 2, null, { effects: { poison: ES.instance('poison', 100, 0), speed: ES.instance('speed', 100, 0) } });
  ok(U.drinkMaxTicks((U.drinkStart(P, held(P)), P)) === 40, 'honey holds 40 ticks');
  U.drinkCancel(P);
  drink(P, 39);
  ok(held(P).n === 2 && P.usingItem, 'honey at 39 ticks: nothing');
  okAv(held(P).n === 2 && P.food === 10, 'honey at 39 ticks leaves food untouched');
  U.drinkCancel(P);
  drink(P, 40);
  ok(!ES.hasStatusEffect(P, 'poison') && ES.hasStatusEffect(P, 'speed'), 'honey removes poison only');
  ok(P.food === 16 && Math.abs(P.saturation - 1.2) < 1e-4, 'honey: 6 food, saturation 6*0.1*2 (' + P.food + '/' + P.saturation + ')');
  ok(held(P).n === 1, 'one honey consumed');
  P = mk('honey_bottle', 1); drink(P, 40);
  ok(nm(held(P)) === 'glass_bottle', 'last honey -> glass bottle');
  P = mk('honey_bottle', 1, null, { food: 20 });
  ok(!U.drinkStart(P, held(P)), 'honey refused on a full stomach');
}
// ── stews
{
  let P = mk('mushroom_stew', 1); drink(P, 32);
  ok(P.food === 16 && nm(held(P)) === 'bowl', 'mushroom stew: 6 food, bowl back');
  P = mk('beetroot_soup', 1); drink(P, 32);
  ok(P.food === 16 && nm(held(P)) === 'bowl', 'beetroot soup: 6 food, bowl');
  P = mk('rabbit_stew', 1); drink(P, 32);
  ok(P.food === 20 && nm(held(P)) === 'bowl', 'rabbit stew: 10 food (capped 20), bowl');
  P = mk('suspicious_stew', 1, { Effects: [{ EffectId: 16, EffectDuration: 100 }, { EffectId: 15 }] });
  drink(P, 32);
  ok(P.effects.night_vision && P.effects.night_vision.duration === 100 && P.effects.blindness.duration === 160, 'suspicious stew: NBT effects, default 160');
  ok(nm(held(P)) === 'bowl', 'suspicious stew -> bowl');
  P = mk('mushroom_stew', 1, null, { food: 20 });
  ok(!U.drinkStart(P, held(P)), 'plain stew refused on a full stomach');
  P = mk('suspicious_stew', 1, null, { food: 20 });
  ok(U.drinkStart(P, held(P)), 'suspicious stew is always edible');
  P = mk('mushroom_stew', 1); drink(P, 20);
  ok(P.food === 10 && nm(held(P)) === 'mushroom_stew', 'stew early release: nothing');
  P = mk('mushroom_stew', 1, null, { instabuild: true }); drink(P, 32);
  ok(nm(held(P)) === 'mushroom_stew', 'creative stew not consumed');
}
// ── the click routes into it
{
  const P = mk('potion', 1, { Potion: 'minecraft:regeneration' });
  P.hasTarget = false; P.mayBuild = true; P.heldItem = () => held(P); P.syncHotbar = () => {}; P.placeBlock = () => false;
  P.ex = 0; P.ey = 1; P.ez = 0; P.eyeHeight = 0; P.lookVec = () => [0, 1, 0]; P.yaw = 0;
  U.init && U.init({ getBlock: () => 0, setBlock: () => false });
  const r = U.rightClick(P);
  ok(r === 'use' && P.usingItem && P.useKind === 'drink', 'rightClick with a potion starts the drink hold (' + r + ')');
}
console.log('================== drinkcheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
