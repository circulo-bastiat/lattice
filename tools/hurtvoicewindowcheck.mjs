#!/usr/bin/env node
// hurtvoicewindowcheck.mjs — #3605: LivingEntity.damage plays hurt/death voice only on a FRESH hit; a stronger
// hit docked inside the invulnerability window deals the difference silently. Anti-vacuity: sabotage via fresh=true.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07y_equip.js', '07zzp_mobvoice.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
const table = {};
for (const l of readFileSync(join(ROOT, 'tools/golden/mob-sounds-1.18.2.tsv'), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); table[c[0]] = c.slice(2); }
M.DATA.mobSounds = table;
M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init();
const played = [];
M.Sound = { play: (ev) => { played.push(ev); return true; } };
const voices = (type) => {
  const e = { type, x: 0, y: 9, z: 0, health: 100, maxHealth: 100, hurtTime: 0 };
  played.length = 0; M.Combat.hurt(e, 5, 100, true); const fresh = played.length;
  played.length = 0; const r = M.Combat.hurt(e, 8, 100, true); const docked = played.length;
  return { fresh, docked, hit: r, health: e.health };
};
const fails = [];
let n = 0;
for (const t of ['iron_golem', 'cow', 'pig']) {
  const r = voices(t);
  if (!r.fresh) fails.push(t + ': no voice on fresh hit');
  if (r.docked) fails.push(t + ': voice on docked hit (' + r.docked + ')');
  if (r.health !== 92) fails.push(t + ': docked hit should deal the 3 difference, health ' + r.health);
}
// anti-vacuity: the old behaviour (voice on every hit) must be flagged by the same assertions
const src = readFileSync(join(ROOT, 'src/14j_combat.js'), 'utf8');
const gated = (s) => /if \(fresh && NS\.MobVoice\) NS\.MobVoice\.onDamage/.test(s) && /if \(fresh && NS\.Llama && NS\.Llama\.onDamaged\)/.test(s) && /if \(fresh\) Cb\.golemSound\(e, e\.health > 0/.test(s);
if (!gated(src)) fails.push('combat source not gated on fresh');
if (gated(src.replace('if (fresh && NS.MobVoice)', 'if (NS.MobVoice)'))) fails.push('sabotage 1 unnoticed'); else n++;
if (gated(src.replace('if (fresh) Cb.golemSound', 'Cb.golemSound'))) fails.push('sabotage 2 unnoticed'); else n++;
if (gated(src.replace('if (fresh && NS.Llama', 'if (NS.Llama'))) fails.push('sabotage 3 unnoticed'); else n++;
if (fails.length) { console.log('FAIL ' + fails.join('; ')); process.exit(1); }
console.log('hurtvoicewindowcheck: ok, ' + n + ' breaks caught');
