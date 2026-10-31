#!/usr/bin/env node
// illusionersoundcheck.mjs — #1015: illusioner BlindTargetGoal/GiveInvisibilityGoal play
// entity.illusioner.prepare_blindness / prepare_mirror on start and cast_spell on the cast tick.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '07q_effects.js', '07y_equip.js', '07s_raid.js', '07v_spell.js'] });
const SP = M.Spell;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const av = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

function run(Goal, setup) {
  const played = [];
  M.Sound = { play: (ev) => { played.push(ev); return true; } };
  const e = { x: 0, y: 0, z: 0, age: 1000, health: 20, target: { id: 7, health: 20, x: 1, y: 0, z: 0 } };
  if (setup) setup(e);
  const g = new Goal(e, {});
  g.start();
  for (let i = 0; i < 25; i++) g.tick();
  return played;
}
const blind = run(SP.BlindTargetGoal);
const mirror = run(SP.GiveInvisibilityGoal);
ok(blind[0] === 'entity.illusioner.prepare_blindness' && blind[1] === 'entity.illusioner.cast_spell' && blind.length === 2, 'blind sounds: ' + blind);
ok(mirror[0] === 'entity.illusioner.prepare_mirror' && mirror[1] === 'entity.illusioner.cast_spell' && mirror.length === 2, 'mirror sounds: ' + mirror);
// anti-vacuity: a silent goal (no sounds configured) must fail the same predicate
const silent = run(function (e, ctx) { return new SP.CastSpellGoal(e, ctx, { spellId: 5, spellTicks: 20, startTimeDelay: 1, castSpell: function () {} }); });
av(!(silent[0] === 'entity.illusioner.prepare_blindness'), 'a soundless goal is detected');
av(silent.length === 0, 'a soundless goal plays nothing');
// silenced mob plays nothing
av(run(SP.BlindTargetGoal, (e) => { e.silent = true; }).length === 0, 'silent illusioner is quiet');
// #1029: IllusionerEntity.getCelebratingSound is the ambient sound (IllusionerEntity.java:141)
ok(M.Raid && M.Raid.CELEBRATE_SOUND.illusioner === 'entity.illusioner.ambient', 'illusioner celebrates with entity.illusioner.ambient');
{ const keep = M.Raid.CELEBRATE_SOUND.illusioner; delete M.Raid.CELEBRATE_SOUND.illusioner;
  av(M.Raid.CELEBRATE_SOUND.illusioner !== 'entity.illusioner.ambient', 'a missing illusioner celebrate sound is detected'); M.Raid.CELEBRATE_SOUND.illusioner = keep; }
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
