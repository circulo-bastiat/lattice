#!/usr/bin/env node
// effectsmutcheck.mjs - #11507: assertions for the 8 surviving mutants of src/07q_effects.js (ES.copyFrom return, ES.update hidden
// resume gate, absorption onApplied, typeHook guard, levitation bookkeeping, hasStatusEffect, health_boost ADDITION op).
// Narrow on purpose (loads only 07q_effects.js) so tools/mutate.mjs picks it. Prints "<n> breaks caught" against the real mutants.
import { loadEngine } from './loadsrc.mjs';
let N = 0;
function run(patch) {
  const fails = [];
  const ok = (c, m) => { N++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: ['07q_effects.js'], patch });
  const ES = M.Effects;
  {
    const d = { x: 1 }, s = { duration: 5, amplifier: 2, ambient: true, showParticles: false, showIcon: false };
    ok(ES.copyFrom(d, s) === d, 'copyFrom returns dst');
    const c = ES.copyInstance(ES.instance('speed', 7, 1)); ok(c && c.duration === 7 && c.amplifier === 1, 'copyInstance returns the copy');
    // update: the hidden tail resumes only when the top reaches exactly 0
    const top = ES.instance('speed', 10, 1); top.hiddenEffect = ES.instance('speed', 50, 0);
    ES.update({}, top); ok(top.duration === 9 && top.amplifier === 1 && top.hiddenEffect && top.hiddenEffect.duration === 49, 'no resume while duration > 0');
    const t1 = ES.instance('speed', 1, 1); t1.hiddenEffect = ES.instance('speed', 50, 0);
    let res = ES.update({}, t1); ok(res === true && t1.amplifier === 0 && t1.duration === 49 && !t1.hiddenEffect, 'resume at 0');
    const t2 = ES.instance('speed', 1, 1); let r2; try { r2 = ES.update({}, t2); } catch (x) { r2 = 'threw'; }
    ok(r2 === false, 'expiry with no hidden effect');
    // absorption, hooks, levitation
    const p = { type: 'player', x: 1, y: 2, z: 3, effects: {} };
    ES.addStatusEffect(p, 'absorption', 100, 1); ok(p.absorption === 8, 'absorption II adds 8 (' + p.absorption + ')');
    let thr = false; try { ES.addStatusEffect(p, 'speed', 100, 0); } catch (x) { thr = true; }
    ok(!thr, 'an effect with no type hook applies');
    ok(p.levitationStartPos === undefined && p.levitationTicks === undefined, 'non-levitation sets no levitation state');
    p.levitationTicks = 9; ES.addStatusEffect(p, 'levitation', 100, 0);
    ok(p.levitationStartPos && p.levitationStartPos.join() === '1,2,3' && p.levitationTicks === 0, 'levitation on a player records pos and ticks 0');
    const m = { type: 'zombie', x: 1, y: 2, z: 3, effects: {} }; ES.addStatusEffect(m, 'levitation', 100, 0);
    ok(m.levitationStartPos === undefined && m.levitationTicks === undefined, 'levitation on a mob records nothing');
    // hasStatusEffect
    let h; try { h = ES.hasStatusEffect(null, 'speed'); } catch (x) { h = 'threw'; }
    ok(h === false, 'hasStatusEffect(null) false');
    ok(ES.hasStatusEffect({}, 'speed') === false && ES.hasStatusEffect({ effects: {} }, 'speed') === false, 'hasStatusEffect on empty is false');
    ok(ES.hasStatusEffect(p, 'speed') === true && ES.hasStatusEffect({ effects: { speed: { duration: 0 } } }, 'speed') === false, 'hasStatusEffect needs duration > 0');
    // health_boost is an ADDITION modifier
    const hb = { effects: {}, maxHealth: 20 }; ES.addStatusEffect(hb, 'health_boost', 100, 1);
    const ms = ES.modifiersOf(hb, 'generic.max_health');
    ok(ms.length === 1 && ms[0].op === 0 && ms[0].amount === 8, 'health_boost = +8 ADDITION');
    ok(ES.attrValue(hb, 'generic.max_health', 20) === 28, 'health_boost II max health 28');
  }
  return fails;
}

const base = run(), NB = N;
let breaks = 0, bad = false;
if (base.length) { console.log('FAIL'); for (const f of base) console.log('  - ' + f); bad = true; }
const MUT = [
  ['07q_effects.js', 'return dst;', 'return !dst;'],
  ['07q_effects.js', 'if (inst.duration === 0 && inst.hiddenEffect) {', 'if (inst.duration === 0 || inst.hiddenEffect) {'],
  ['07q_effects.js', 'ES.setAbsorption(e, (e.absorption || 0) + 4 * (amp + 1)); },', 'ES.setAbsorption(e, (e.absorption || 0) - 4 * (amp + 1)); },'],
  ['07q_effects.js', 'if (h && h[which]) h[which]', 'if (h || h[which]) h[which]'],
  ['07q_effects.js', "if (inst.effect === 'levitation' && e.type === 'player') { e.levitationStartPos", "if (inst.effect === 'levitation' || e.type === 'player') { e.levitationStartPos"],
  ['07q_effects.js', 'e.levitationTicks = 0; }', 'e.levitationTicks = 1; }'],
  ['07q_effects.js', 'return !!(e && e.effects && e.effects[effect] && e.effects[effect].duration > 0);', 'return !!(e || e.effects && e.effects[effect] && e.effects[effect].duration > 0);'],
  ["07q_effects.js", "amount: 4.0, op: 0 }],\n    luck", "amount: 4.0, op: 1 }],\n    luck"],
];
for (const [f, from, to] of MUT) {
  let hit = false, sawText = false;
  const patch = (name, s) => { if (name !== f) return s; if (s.includes(from)) sawText = true; return s.replace(from, to); };
  let fl; try { fl = run(patch); } catch (x) { fl = ['threw']; }
  if (!sawText) { console.log('FAIL mutant text not found: ' + from); bad = true; continue; }
  if (fl.length) { breaks++; console.log('   ✓ mutant caught: ' + from.slice(0, 60)); } else { console.log('FAIL not caught: ' + from); bad = true; }
}
console.log(`effectsmutcheck: ${NB} assertions, ${bad ? 1 : 0} failed, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
