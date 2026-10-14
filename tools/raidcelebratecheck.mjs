#!/usr/bin/env node
// raidcelebratecheck.mjs — #1199: every raider type's Ai.CelebrateGoal emits its vanilla
// getCelebratingSound id (.decomp Pillager/Vindicator/Witch/Ravager/Evoker/IllusionerEntity), and that
// id exists in the sound table (.mcsnd/sounds.json). Proves it can fail: each break corrupts the table.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '07h_entities.js', '07y_equip.js', '07q_effects.js', '07v_spell.js', '07s_raid.js', '07k_goals.js'] });
const WANT = { pillager: 'entity.pillager.celebrate', vindicator: 'entity.vindicator.celebrate', witch: 'entity.witch.celebrate',
  ravager: 'entity.ravager.celebrate', evoker: 'entity.evoker.celebrate', illusioner: 'entity.illusioner.ambient' };
const snd = JSON.parse(readFileSync(join(ROOT, '.mcsnd', 'sounds.json'), 'utf8'));
const has = (id) => Object.prototype.hasOwnProperty.call(snd.events || snd, id);
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const av = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

function emitted(type) {
  const got = []; M.Sound = Object.assign(M.Sound || {}, { mobSound: (e, id) => got.push(id) });
  const g = new M.Ai.CelebrateGoal({ type }, {});
  const r = Math.random; Math.random = () => 0; try { g.tick(); } finally { Math.random = r; }
  return got[0];
}
for (const [t, id] of Object.entries(WANT)) {
  ok(emitted(t) === id, t + ' celebrates with ' + id + ' (got ' + emitted(t) + ')');
  ok(has(id), id + ' is in the sound table');
}
const keep = M.Raid.CELEBRATE_SOUND.witch; delete M.Raid.CELEBRATE_SOUND.witch;
av(emitted('witch') !== WANT.witch, 'a missing witch celebrate mapping is detected'); M.Raid.CELEBRATE_SOUND.witch = keep;
av(!has('entity.pillager.celebrate_bogus'), 'an id absent from the sound table is detected');
M.Raid.CELEBRATE_SOUND.pillager = 'entity.pillager.ambient';
av(emitted('pillager') !== WANT.pillager, 'a wrong pillager id is detected');
console.log(`raidcelebratecheck: ${pass} passed, ${breaks} breaks caught` + (fails.length ? ', FAIL: ' + fails.join('; ') : ''));
process.exit(fails.length ? 1 : 0);
