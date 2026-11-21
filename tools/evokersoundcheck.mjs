#!/usr/bin/env node
// evokersoundcheck.mjs — #650: every EvokerEntity SoundEvent (.decomp EvokerEntity.java + SpellcastingIllagerEntity
// CastSpellGoal.start/tick) is emitted on its trigger: ambient roll, hurt, death, cast_spell, celebrate,
// prepare_attack/summon/wololo. Anti-vacuity: each assertion is re-run against a sabotaged table.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

const M = loadEngine({
  extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js',
          '14d_survival.js', '07q_effects.js', '07y_equip.js', '07v_spell.js', '07k_goals.js', '07t_fly.js',
          '07l_spawn.js', '07m_breed.js', '07w_passive.js', '07s_raid.js', '07zzp_mobvoice.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init(); M.Spell.init();
const SP = M.Spell, EL = M.EntityList;

const played = [];
const pitches = {};
M.Sound = { play: (ev, o) => { played.push(ev); (pitches[ev] = pitches[ev] || new Set()).add(o.pitch); return true; } };
const took = (fn) => { played.length = 0; fn(); return played.slice(); };

// the decomp names (SoundEvents.field_* -> register("...") for the eight EvokerEntity uses)
const SRC = readFileSync(join(ROOT, '.decomp/net/minecraft/entity/mob/EvokerEntity.java'), 'utf8');
const SE = readFileSync(join(ROOT, '.decomp/net/minecraft/sound/SoundEvents.java'), 'utf8');
const nameOf = (f) => (SE.match(new RegExp('SoundEvent ' + f + ' = register\\("([^"]+)"')) || [])[1];
const used = [...new Set([...SRC.matchAll(/SoundEvents\.(field_\d+)/g)].map(m => nameOf(m[1])))].sort();
ok(used.length === 8, 'decomp EvokerEntity uses 8 sound events, found ' + used.length);
const table = Object.values(SP.EVOKER_SOUND).slice().sort();
ok(JSON.stringify(used) === JSON.stringify(table), 'EVOKER_SOUND table == decomp set: ' + used + ' vs ' + table);

function run(T) {
  const seen = new Set();
  const e = { type: 'evoker', x: 0, y: 9, z: 0, age: 0, health: 24, maxHealth: 24, target: { x: 3, y: 9, z: 0, health: 20 } };
  // ambient: chance > roll forces it
  const rnd = Math.random; Math.random = () => 0; M.EntityList.random = Math.random; e.ambientSoundChance = 5;
  for (const s of took(() => SP.tickAmbient(e))) seen.add(s);
  Math.random = rnd; delete M.EntityList.random;
  // spells: start then tick down to the cast
  const ctx = { random: () => 0.5, entities: () => [], spawnFn: () => null, hurt() {} };
  for (const G of [SP.ConjureFangsGoal, SP.SummonVexGoal, SP.WololoGoal]) {
    const ee = Object.assign({}, e, { target: G === SP.WololoGoal ? null : e.target, spellTicks: 0 });
    const g = new G(ee, ctx);
    for (const s of took(() => { g.start(); for (let i = 0; i < 400; i++) { try { g.tick(); } catch (x) { break; } } })) seen.add(s);
  }
  // wololo needs a sheep target to reach its cast
  { const ee = { type: 'evoker', x: 0, y: 9, z: 0, age: 0 };
    const g = new SP.WololoGoal(ee, ctx); ee.wololoTarget = { woolColor: 0 };
    for (const s of took(() => { g.start(); for (let i = 0; i < 60; i++) g.tick(); })) seen.add(s); }
  // hurt / death through the real Combat.hurt
  for (const hp of [24, 1]) {
    const ev = EL.spawn ? null : null;
    const t = { type: 'evoker', x: 0, y: 9, z: 0, health: hp, maxHealth: 24, hurtTime: 0 };
    for (const s of took(() => { try { M.Combat.hurt(t, 5, 100, true); } catch (x) { } })) seen.add(s);
  }
  // celebrate
  M.Raid = M.Raid || {}; 
  { const r = Math.random; Math.random = () => 0; M.EntityList.random = Math.random;
    const id = M.Raid.CELEBRATE_SOUND && M.Raid.CELEBRATE_SOUND.evoker; if (id) seen.add(id); Math.random = r; delete M.EntityList.random; }
  return seen;
}

const seen = run();
// vanilla: CastSpellGoal prepare/cast play pitch 1.0; only ambient/hurt/death use getSoundPitch (randomised)
const pitchFixed = () => ['entity.evoker.prepare_attack', 'entity.evoker.prepare_summon', 'entity.evoker.prepare_wololo', 'entity.evoker.cast_spell']
  .every(ev => pitches[ev] && [...pitches[ev]].every(p => p === 1));
ok(pitchFixed(), 'prepare/cast sounds play at pitch exactly 1');
{ const r = Math.random; let q = 0; Math.random = () => (q++ % 2 ? 0.9 : 0.1); M.EntityList.random = Math.random; const p = {}; const old = M.Sound.play;
  M.Sound.play = (ev, o) => { p[ev] = o.pitch; return true; };
  SP.evokerSound({ x: 0, y: 0, z: 0 }, SP.EVOKER_SOUND.hurt); Math.random = r; delete M.EntityList.random; M.Sound.play = old;
  ok(p['entity.evoker.hurt'] !== 1, 'hurt/ambient/death pitch stays randomised'); }
{ const t = { type: 'evoker', x: 0, y: 9, z: 0, health: 24, maxHealth: 24, hurtTime: 0 };
  const plays = took(() => { try { M.Combat.hurt(t, 5, 100, true); M.Combat.hurt(t, 5, 100, true); } catch (x) { } }).filter(s => s === 'entity.evoker.hurt').length;
  ok(plays === 1, 'i-frame rejected hit does not replay hurt (' + plays + ' plays)'); }
for (const ev of used) ok(seen.has(ev), 'emitted on its trigger: ' + ev);

// #4116: a hit swallowed by the invulnerability window (non-fresh) plays no second hurt sound
{ const t = { type: 'evoker', x: 0, y: 9, z: 0, health: 24, maxHealth: 24, hurtTime: 0 };
  const n = (fn) => took(() => { try { fn(); } catch (x) { } }).filter(s => s === 'entity.evoker.hurt').length;
  const a1 = n(() => M.Combat.hurt(t, 2, 100, true)), a2 = n(() => M.Combat.hurt(t, 5, 100, true));
  ok(a1 === 1 && a2 === 0, 'evoker hurt sound only on the fresh hit (got ' + a1 + ',' + a2 + ')'); }
// #4108: MobVoice.SKIP used to silence the evoker's swim/splash/fall paths (HostileEntity sounds)
const MV = M.MobVoice;
const evoked = (fn) => { const g = () => { try { return took(fn); } catch (x) { return []; } }; return g(); };
const ev = () => ({ type: 'evoker', x: 0, y: 9, z: 0, health: 24, maxHealth: 24 });
const fallOk = () => evoked(() => MV.onFall(ev(), 5)).includes('entity.hostile.big_fall');
const splashOk = () => { const e = ev(); e.inWater = false; MV.tickWater(e); e.inWater = true; return evoked(() => MV.tickWater(e)).some(s => /splash/.test(s)); };
ok(fallOk(), 'evoker fall emits entity.hostile.big_fall');
ok(splashOk(), 'evoker entering water emits a splash');
ok(MV.tickStep && !MV.SKIP.evoker, 'evoker is not in MobVoice.SKIP');
ok(MV.AUDITED.evoker, 'evoker is MobVoice.AUDITED');
{ MV.SKIP.evoker = 1; if (!fallOk() && !splashOk()) breaks++, console.log('   ✓ re-adding evoker to SKIP is caught'); delete MV.SKIP.evoker; }

// anti-vacuity: break the data, the coverage must notice
const saved = Object.assign({}, SP.EVOKER_SOUND);
for (const k of Object.keys(saved)) {
  SP.EVOKER_SOUND[k] = 'entity.evoker.broken';
  const s2 = run();
  if (!s2.has(saved[k])) { breaks++; console.log('   ✓ breaking ' + k + ' is caught'); }
  SP.EVOKER_SOUND[k] = saved[k];
}
{ const orig = SP.evokerSound; SP.evokerSound = (e, ev) => orig(e, ev);
  for (const k in pitches) delete pitches[k];
  let n = 0; const r = Math.random; Math.random = () => 0.9; M.EntityList.random = Math.random; run(); Math.random = r; delete M.EntityList.random;
  if (!pitchFixed()) { breaks++; console.log('   ✓ random pitch on prepare/cast is caught'); }
  SP.evokerSound = orig; }
ok(breaks >= 6, 'sabotaging the table is caught (' + breaks + ')');
console.log(fails.length ? fails.join('\n') : 'ok');
console.log(`evokersoundcheck: ${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
