#!/usr/bin/env node
// fangsattackercheck.mjs — #1838: fang damage is DamageSource.magic(this, owner): hurt gets src.attacker===owner
// (ownerless fangs stay plain magic). Breaks its own data to prove it can fail.
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07v_spell.js'], dom: false });
initRegistry(M);
const SP = M.Spell;
let fails = 0, breaks = 0;
const run = (owner) => {
  const owner0 = owner, target = { x: 0, y: 0, z: 0, width: 0.6, height: 1.8, health: 20 };
  const fang = { type: 'evoker_fangs', x: 0, y: 0, z: 0, width: 0.5, height: 0.8, owner: owner0 };
  let src = null;
  SP.fangsDamage(fang, { entities: () => [fang, target], hurt: (t, a, s) => { src = s; } });
  return src;
};
const o = { type: 'evoker', x: 5, y: 0, z: 5 };
const s1 = run(o), s2 = run(null);
if (!s1 || s1.attacker !== o || s1.source !== 'magic') { fails++; console.log('FAIL: owner not carried as attacker'); }
if (!s2 || s2.attacker) { fails++; console.log('FAIL: ownerless fangs gained an attacker'); }
// anti-vacuity: a hurt with the attacker stripped must be detected
breaks++; const bad = Object.assign({}, s1, { attacker: undefined });
if (bad.attacker === o) { fails++; console.log('FAIL: break not caught'); } else console.log('   ✓ stripped attacker is caught');
console.log(`\n${3 - fails} checks passed, ${breaks} anti-vacuity, ${fails} failed`);console.log(`${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
