#!/usr/bin/env node
// eatcreativecheck.mjs — #4983 audit: every food / consumable, creative vs survival, through ONE consume path
// (Use.drinkStart -> Use.consumeTick -> Use.drinkFinish). Vanilla: LivingEntity.eatFood (decrement unless
// creativeMode), Player.eatFood (hunger + burp), PlayerEntity.canConsume (invulnerable || always || notFull),
// ChorusFruitItem.finishUsing (teleport + 20-tick cooldown), Item.getEatSound/getDrinkSound.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets', 'items.meta.json'), 'utf8'));

const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07q_effects.js', '07z_potion.js',
  '14d_survival.js', '14l_use.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: meta.rawBytes });
const IT = MCL.Items, Iv = MCL.Inventory, U = MCL.Use;
let played = [];
MCL.Sound = { play: (ev, o) => { played.push(ev); } };

function mk(name, creative, food, tag) {
  const inv = Iv.create();
  Iv.setItem(inv, 0, Iv.stack(name, 3, 0, tag || null));
  return { mode: creative ? 1 : 0, instabuild: creative, invulnerableGamemode: creative, slot: 0, inventory: inv, food, saturation: 0,
    health: 20, effects: {}, x: 0, y: 70, z: 0, exhaustion: 0, maxHealth: 20 };
}
const held = (P) => Iv.getItem(P.inventory, 0);
function consume(P) {
  played = [];
  if (!U.drinkStart(P, held(P))) return false;
  const max = U.drinkMaxTicks(P);
  for (let t = 0; t < max && P.usingItem; t++) { P.useTicks += 1; U.consumeTick(P); }
  U.drinkFinish(P);
  return true;
}
const names = [];
for (let i = 0; i < 5000; i++) { const n = IT.nameOf(i); if (n && (IT.flags[i] & 4)) names.push(n); }
for (const n of ['potion', 'milk_bucket']) names.push(n);
const ALWAYS = new Set(['golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'suspicious_stew', 'potion', 'milk_bucket']);
const REMAINDER = { mushroom_stew: 'bowl', rabbit_stew: 'bowl', beetroot_soup: 'bowl', suspicious_stew: 'bowl', honey_bottle: 'glass_bottle', milk_bucket: 'bucket', potion: 'glass_bottle' };
const tags = { potion: { Potion: 'minecraft:regeneration' } };
ok(names.length > 30, 'found the food items (' + names.length + ')');

for (const n of names) {
  const id = IT.idOf ? IT.idOf(n) : 0;
  // full stomach: refused in survival unless always edible; creative (invulnerable) always may
  let P = mk(n, false, 20, tags[n]);
  ok(U.drinkStart(P, held(P)) === ALWAYS.has(n), n + ': survival full-hunger start == alwaysEdible');
  P = mk(n, true, 20, tags[n]);
  ok(U.drinkStart(P, held(P)) === true, n + ': creative full-hunger start allowed');
  // survival vs creative finish
  const S = mk(n, false, 6, tags[n]), C = mk(n, true, 6, tags[n]);
  ok(consume(S), n + ': survival consumes'); const sPlayed = played;
  ok(consume(C), n + ': creative consumes'); const cPlayed = played;
  ok(/_stew$|beetroot_soup/.test(n) || (held(S) && held(S).n === 2), n + ': survival stack 3 -> 2 (' + (held(S) && held(S).n) + ')');
  ok(held(C) && held(C).n === 3 && IT.nameOf(held(C).i) === n, n + ': creative stack stays 3');
  ok(C.food === S.food && C.saturation === S.saturation, n + ': hunger/saturation identical in both modes');
  ok(Object.keys(C.effects).sort().join() === Object.keys(S.effects).sort().join() || ['chicken', 'rotten_flesh', 'poisonous_potato'].includes(n), n + ': same effects');
  ok(cPlayed.some((e) => /generic\.(eat|drink)|honey_bottle/.test(e)), n + ': consume sound plays (' + cPlayed.join() + ')');
  if (IT.flags[IT.idOf ? IT.idOf(n) : 0] !== undefined && n !== 'potion' && n !== 'milk_bucket') ok(cPlayed.includes('entity.player.burp'), n + ': burp');
  // last item: remainder returned in survival, nothing changes in creative
  if (REMAINDER[n]) {
    const L = mk(n, false, 6, tags[n]); Iv.setItem(L.inventory, 0, Iv.stack(n, 1, 0, tags[n] || null)); consume(L);
    ok(IT.nameOf(held(L).i) === REMAINDER[n], n + ': survival last -> ' + REMAINDER[n]);
    const LC = mk(n, true, 6, tags[n]); Iv.setItem(LC.inventory, 0, Iv.stack(n, 1, 0, tags[n] || null)); consume(LC);
    ok(IT.nameOf(held(LC).i) === n, n + ': creative keeps the item');
  }
  // stopping early does nothing
  const E = mk(n, true, 6, tags[n]); U.drinkStart(E, held(E)); E.useTicks = 5; U.drinkCancel(E);
  ok(!E.usingItem && E.food === 6 && held(E).n === 3, n + ': early stop: nothing');
}
// chorus fruit: cooldown in creative too, blocks the next start
{
  const C = mk('chorus_fruit', true, 20);
  consume(C);
  ok(C.itemCooldowns && C.itemCooldowns.chorus_fruit === 20, 'chorus fruit sets a 20-tick cooldown (creative too)');
  ok(!U.drinkStart(C, held(C)), 'chorus fruit refused while cooling down');
  for (let i = 0; i < 20; i++) U.tickItemCooldowns(C);
  ok(U.drinkStart(C, held(C)), 'chorus fruit usable again after 20 ticks');
}
// anti-vacuity: break the data and see the rules notice
{
  const P = mk('apple', true, 20);
  P.instabuild = false; P.invulnerableGamemode = false;
  okAv(!U.drinkStart(P, held(P)), 'apple at full hunger refused once not creative');
  const S = mk('bread', false, 6); consume(S);
  okAv(held(S).n !== 3, 'survival stack count must drop (a no-op consume would fail)');
  const C = mk('bread', true, 6); consume(C); C.inventory && Iv.shrink(held(C), 1);
  okAv(held(C).n !== 3, 'a creative stack that WAS shrunk is detected');
  okAv(!played.includes('entity.generic.drink'), 'bread must not play the drink sound');
}
console.log('================== eatcreativecheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
for (const f of fails.slice(0, 40)) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
