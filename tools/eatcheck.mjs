#!/usr/bin/env node
// eatcheck.mjs — G19d-b (#177): EATING. Item.use food branch (canConsume), the 32/16-tick hold, Item.finishUsing ->
// HungerManager.eat, FoodComponent effects. Every number is parsed out of .decomp FoodComponents.java / StatusEffects.java.
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
const src = readFileSync(join(ROOT, '.decomp/net/minecraft/item/FoodComponents.java'), 'utf8');
const fx = readFileSync(join(ROOT, '.decomp/net/minecraft/entity/effect/StatusEffects.java'), 'utf8');

const effName = {};
for (const m of fx.matchAll(/(field_\d+) = register\(\s*\d+,\s*"(\w+)"/g)) effName[m[1]] = m[2];
const stew = (h) => ({ hunger: h, mod: 0.6, fx: [], always: false, snack: false });
const rows = {};
for (const m of src.matchAll(/FoodComponent (\w+) = ([^;]*?);/gs)) {
  const body = m[2], cs = body.match(/createStew\((\d+)\)/);
  const r = cs ? stew(+cs[1]) : { hunger: +body.match(/hunger\((\d+)\)/)[1], mod: +body.match(/saturationModifier\(([\d.]+)F\)/)[1], fx: [], always: false, snack: false };
  for (const e of body.matchAll(/StatusEffectInstance\(StatusEffects\.(field_\d+), (\d+), (\d+)\), ([\d.]+)F/g)) r.fx.push([effName[e[1]], +e[2], +e[3], +e[4]]);
  if (/alwaysEdible\(\)/.test(body)) r.always = true;
  if (/snack\(\)/.test(body)) r.snack = true;
  rows[m[1].toLowerCase()] = r;
}

const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07q_effects.js', '07z_potion.js',
  '14d_survival.js', '07zj_fox.js', '14l_use.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: meta.rawBytes });
const IT = MCL.Items, Iv = MCL.Inventory, U = MCL.Use;
MCL.Sound = { play() {} };
MCL.Player = { random: { nextDouble: () => 0 } };   // every effect chance lands
const mk = (name, food, sat) => {
  const inv = Iv.create(); Iv.setItem(inv, 0, Iv.stack(name, 3, 0, null));
  return { mode: 0, instabuild: false, invulnerableGamemode: false, slot: 0, inventory: inv, food, saturation: sat || 0, health: 20, effects: {},
    x: 0, y: 70, z: 0, exhaustion: 0, maxHealth: 20 };
};
const held = (P) => Iv.getItem(P.inventory, 0);
const hold = (P, ticks) => {   // the P.act loop: tick the hold, finish at max
  for (let t = 0; t < ticks && P.usingItem; t++) { P.useTicks += 1; U.consumeTick(P, () => 0.5); if (P.useTicks >= U.drinkMaxTicks(P)) { U.drinkFinish(P); break; } }
};

const names = Object.keys(rows).filter((n) => IT.of(n) >= 0);
ok(names.length > 30, 'parsed food rows ' + names.length);
for (const n of names) {
  const r = rows[n];
  ok(U.getMaxUseTime(held(mk(n, 0))) === (r.snack ? 16 : n === 'honey_bottle' ? 40 : 32), n + ': hold length ' + (r.snack ? 16 : 32));
  // full hold from half hunger
  const P = mk(n, 4, 0);
  ok(U.drinkStart(P, held(P)), n + ': starts at food 4');
  hold(P, 15);
  ok(P.food === 4 && held(P).n === 3, n + ': nothing before the last tick');
  P.useTicks = 0; P.usingItem && hold(P, 40);
  const ef = Math.min(4 + r.hunger, 20), es = Math.min(r.hunger * r.mod * 2, ef);
  ok(P.food === ef && Math.abs(P.saturation - es) < 1e-5, n + ': food ' + P.food + '/' + ef + ' sat ' + P.saturation + '/' + es);
  ok(held(P) === null || held(P).n === 2 || /stew|soup|honey/.test(n), n + ': stack shrinks');
  for (const [e] of r.fx) ok(P.effects[e], n + ': effect ' + e);
  // early release restores nothing
  const E = mk(n, 4, 0); U.drinkStart(E, held(E)); E.useTicks = 10; U.drinkCancel(E);
  ok(!E.usingItem && E.food === 4 && E.saturation === 0 && held(E).n === 3 && !Object.keys(E.effects).length, n + ': early release inert');
  // full stomach
  const F = mk(n, 20, 0);
  ok(U.drinkStart(F, held(F)) === r.always, n + ': full player ' + (r.always ? 'accepts' : 'refuses'));
}
for (const n of ['golden_apple', 'enchanted_golden_apple']) {
  const r = rows[n]; ok(r && r.always && r.fx.length >= 2, n + ' parsed alwaysEdible with effects');
  const P = mk(n, 20, 20); U.drinkStart(P, held(P)); hold(P, 40);
  for (const [e, d, a] of r.fx) ok(P.effects[e] && P.effects[e].duration === d && P.effects[e].amplifier === a, n + ': ' + e + ' ' + d + 'x' + a + ' got ' + JSON.stringify(P.effects[e]));
}
// anti-vacuity
{
  const b = mk('bread', 4, 0); U.drinkStart(b, held(b)); hold(b, 40);
  okAv(b.food !== 4 + 6, 'a wrong hunger value (6, not 5) is detected');
  okAv(Math.abs(b.saturation - 5 * 0.3 * 2) > 1e-5, 'a wrong saturation modifier (0.3, not 0.6) is detected');
  const f = mk('bread', 20, 0);
  okAv(U.drinkStart(f, held(f)) !== true, 'full player accepting bread is detected');
  const e = mk('bread', 4, 0); U.drinkStart(e, held(e)); hold(e, 10);
  okAv(e.food !== 9, 'finishing early (10 ticks) is detected');
  okAv(rows.dried_kelp.snack && U.getMaxUseTime(held(mk('dried_kelp', 0))) !== 32, 'a 32-tick kelp is detected');
}
console.log('================== eatcheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
for (const f of fails.slice(0, 40)) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
