#!/usr/bin/env node
// effectattrcheck.mjs — G23b (#294). Effect attribute modifiers: the table in 07q_effects.js against
// StatusEffects.java (.decomp) — uuids and amounts read out of the source text — and the
// computed values (Swiftness I +20%, Slowness IV -60%, Health Boost II +8 and clamp, Absorption II 8).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const decomp = readFileSync(ROOT + '.decomp/net/minecraft/entity/effect/StatusEffects.java', 'utf8');
const srcText = readFileSync(ROOT + 'src/07q_effects.js', 'utf8');

function load(text) {
  const NS = { Survival: { MAX_HEALTH: 20 } };
  new Function('MCL', text)(NS);
  return NS.Effects;
}
let fails = 0;
let quiet = false;
let total = 0;
const ok = (c, m) => { total++; if (!c) { fails++; if (!quiet) console.log('FAIL ' + m); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

function run(ES, tag) {
  const f0 = fails;
  const mk = () => ({ health: 20, maxHealth: 20, effects: {} });
  let e = mk(); ES.addStatusEffect(e, 'speed', 100, 0);
  ok(near(ES.attrValue(e, 'generic.movement_speed', 0.1), 0.12), tag + ' speed I +20% MULTIPLY_TOTAL');
  e = mk(); ES.addStatusEffect(e, 'slowness', 100, 3);
  ok(near(ES.attrValue(e, 'generic.movement_speed', 0.1), 0.04), tag + ' slowness IV -60%');
  e = mk(); ES.addStatusEffect(e, 'speed', 100, 1); ES.addStatusEffect(e, 'slowness', 100, 0);
  ok(near(ES.attrValue(e, 'generic.movement_speed', 0.1), 0.1 * 1.4 * 0.85), tag + ' speed II x slowness I multiply');
  e = mk(); ES.addStatusEffect(e, 'strength', 100, 1); ES.addStatusEffect(e, 'weakness', 100, 0);
  ok(near(ES.attackDamageBonus(e, 2), 2 + 6 - 4), tag + ' strength II + weakness I');
  e = mk(); ES.addStatusEffect(e, 'haste', 100, 1); ES.addStatusEffect(e, 'mining_fatigue', 100, 0);
  ok(near(ES.attrValue(e, 'generic.attack_speed', 4), 4 * 1.2 * 0.9), tag + ' haste II x fatigue I attack_speed');
  e = mk(); ES.addStatusEffect(e, 'luck', 100, 2); ES.addStatusEffect(e, 'unluck', 100, 0);
  ok(ES.luckOf(e) === 2, tag + ' luck III + unluck I = 2');
  e = mk(); ES.addStatusEffect(e, 'health_boost', 100, 1);
  ok(e.maxHealth === 28, tag + ' health boost II +8 max health');
  e.health = 28; ES.removeStatusEffect(e, 'health_boost');
  ok(e.maxHealth === 20 && e.health === 20, tag + ' health boost removal clamps health');
  e = mk(); ES.addStatusEffect(e, 'absorption', 100, 1);
  ok(e.absorption === 8, tag + ' absorption II = 8');
  ES.removeStatusEffect(e, 'absorption');
  ok(e.absorption === 0, tag + ' absorption removed');
  ok(ES.attrValue(mk(), 'generic.movement_speed', 0.1) === 0.1, tag + ' no effect = base');
  return fails - f0;
}

// §0 the table against the decomp text
const ES = load(srcText);
for (const [eff, ms] of Object.entries(ES.ATTR_MODIFIERS)) for (const m of ms) {
  ok(decomp.includes('"' + m.uuid + '"'), 'uuid ' + m.uuid + ' of ' + eff + ' is in StatusEffects.java');
  const re = new RegExp('"' + m.uuid + '", (-?[0-9.]+)F?, EntityAttributeModifier.Operation.(\\w+)');
  const mm = decomp.match(re);
  ok(mm && Math.abs(parseFloat(mm[1]) - m.amount) < 1e-6 && ['ADDITION', 'MULTIPLY_BASE', 'MULTIPLY_TOTAL'][m.op] === mm[2], eff + ' amount/op match decomp');
}
ok(run(ES, '[real]') === 0, 'real run');

// anti-vacuity: every break must be caught
const breaks = [
  [t => t.replace("amount: 0.2, op: 2", "amount: 0.25, op: 2"), 'speed amount'],
  [t => t.replace("amount: -0.15, op: 2", "amount: -0.1, op: 2"), 'slowness amount'],
  [t => t.replace("ES.STRENGTH_PER_LEVEL = 3.0", "ES.STRENGTH_PER_LEVEL = 2.0"), 'strength damage'],
  [t => t.replace("mt *= 1 + ms[i].amount", "mt += ms[i].amount"), 'multiply_total as sum'],
  [t => t.replace("amount: 1.0, op: 0 }", "amount: 2.0, op: 0 }"), 'luck amount'],
  [t => t.replace("e.health = e.maxHealth;", "e.health = e.health;"), 'health boost clamp'],
  [t => t.replace("(e.absorption || 0) + 4 * (amp + 1)", "(e.absorption || 0) + 2 * (amp + 1)"), 'absorption amount'],
  [t => t.replace("amount: 0.1, op: 2 }", "amount: 0.0, op: 2 }"), 'haste amount']
];
let caught = 0;
for (const [fn, name] of breaks) {
  const t = fn(srcText);
  if (t === srcText) { console.log('FAIL break did not apply: ' + name); fails++; continue; }
  const save = fails;
  let bad = false;
  quiet = true;
  try { const E = load(t); const f = fails; bad = run(E, '[' + name + ']') > 0; fails = f; } catch (x) { bad = true; }
  fails = save; quiet = false;
  if (bad) { caught++; console.log('  ✓ broke ' + name + ' -> caught'); } else { console.log('FAIL break not caught: ' + name); fails++; }
}
console.log(` assertions passed .. ${total}`);
console.log(` failures ........... ${fails}`);
console.log(` breaks caught ...... ${caught}`);
if (fails) process.exit(1);
console.log(`${caught} breaks caught`);
