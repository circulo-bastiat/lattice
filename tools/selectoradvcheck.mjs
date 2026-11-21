#!/usr/bin/env node
// selectoradvcheck.mjs -- #8122: selector options advancements={..} and predicate=<id> (EntitySelectorOptions) over Adv.Tracker and Adv.pred.
// Anti-vacuity: the same scenario against edited sources must fail ('<n> breaks caught').
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CMD = readFileSync(join(ROOT, 'src/15g_commands.js'), 'utf8');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/advancements.meta.json'), 'utf8'));
const data = readFileSync(join(ROOT, 'assets/advancements.bin')).toString('base64');
function scenario(cmdSrc) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '01b_inflate', '02l_advancements', '14h_brigadier']) new Function('MCL', readFileSync(join(ROOT, `src/${f}.js`), 'utf8'))(NS);
  new Function('MCL', cmdSrc)(NS);
  const A = NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  const fails = [], ok = (c, m) => { if (!c) fails.push(m); };
  const pl = { x: 0, y: 64, z: 0, advancements: new A.Tracker({}) };
  NS.Player = pl;
  const src = { name: 'Player', x: 0, y: 64, z: 0 };
  const sel = (s) => NS.Commands.arg.entity(false, false).parse(new NS.Brig.Reader(s, 0), src);
  const n = (s) => NS.Commands.resolve(sel(s), src).length;
  const id = 'minecraft:story/mine_stone';
  const adv = A.manager.get(id), crit = Object.keys(adv.criteria)[0];
  ok(n('@a[advancements={' + id + '=false}]') === 1, 'false before grant selects');
  ok(n('@a[advancements={' + id + '=true}]') === 0, 'true before grant selects nobody');
  pl.advancements.grantCriterion(adv, crit);
  ok(n('@a[advancements={' + id + '=true}]') === 1, 'true after grant selects the player');
  ok(n('@a[advancements={' + id + '=false}]') === 0, 'false after grant selects nobody');
  ok(n('@a[advancements={' + id + '={' + crit + '=true}}]') === 1, 'criterion=true');
  ok(n('@a[advancements={' + id + '={' + crit + '=false}}]') === 0, 'criterion=false');
  ok(n('@a[advancements={story/nonexistent=true}]') === 0, 'unknown advancement');
  A.predicates = { 'minecraft:burning': [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { effects: undefined, flags: { is_on_fire: true } } }] };
  pl.onFire = false;
  const a0 = n('@a[predicate=minecraft:burning]'), a1 = n('@a[predicate=!minecraft:burning]'), a2 = n('@a[predicate=minecraft:nope]');
  ok(a2 === 0, 'unknown predicate selects nobody');
  ok(a0 + a1 === 1 && a0 !== a1, 'predicate and its negation partition the player');
  return fails;
}
const fails = scenario(CMD);
const mut = (a, b) => { if (!CMD.includes(a)) throw new Error('anchor gone: ' + a); return CMD.replace(a, b); };
const mutants = [
  ['advancements filter bypassed', mut("if (sel.opts && sel.opts.advancements) {", "if (false) {")],
  ['criterion level ignored', mut("if (!cp || (cp.date !== null) !== want[cn]) return false;", "")],
  ['predicate filter bypassed', mut("if (sel.opts && sel.opts.predicate) {", "if (false) {")],
  ['negation ignored', mut("return pneg ? !ok : ok;", "return ok;")],
];
let caught = 0;
for (const [name, s] of mutants) {
  let bad; try { bad = scenario(s); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ok broken (' + name + ') -> ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('selectoradvcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`11 assertions, 0 failures, ${caught} breaks caught`);
