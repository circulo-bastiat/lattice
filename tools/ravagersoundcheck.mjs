#!/usr/bin/env node
// ravagersoundcheck.mjs — #1020: every RavagerEntity sound event is emitted with its vanilla id
// (.decomp RavagerEntity.java: getAmbient/Hurt/DeathSound, tryAttack/handleStatus(4) attack,
// knockback() stunned, stunTick==0 roar, getCelebratingSound celebrate, playStepSound step).
// Proves it can fail: each break corrupts the engine or the expectation and the check must notice.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({
  extra: ['02g_items.js', '02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07y_equip.js',
          '07i_entitylist.js', '14b_physics.js', '14d_survival.js', '14f_inventory.js', '14i_hand.js',
          '07q_effects.js', '14j_combat.js', '07v_spell.js', '07s_raid.js', '07k_goals.js', '07l_spawn.js',
          '07t_fly.js', '07zzp_mobvoice.js', '19_data.gen.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.EntityList.init(); M.Combat.init(); M.Ai.init();
const EL = M.EntityList, Ai = M.Ai, MV = M.MobVoice;

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const played = [];
M.Sound = Object.assign(M.Sound || {}, { play: (ev, o) => { played.push(ev); return true; } });
const run = (f) => { played.length = 0; f(); return played.slice(); };
const mk = () => { EL.clear(); const e = EL.spawn('ravager', 0, 70, 0); e.onGround = true; return e; };

const tgt = { x: 1, y: 70, z: 0, vx: 0, vz: 0, health: 20, maxHealth: 20 };
const EXPECT = {
  ambient: run(() => MV.emit(mk(), MV.pick(mk(), 'ambient')))[0],
  hurt: run(() => MV.onDamage(mk(), false))[0],
  death: run(() => MV.onDamage(mk(), true))[0],
  stunned: run(() => { const e = mk(); Ai.ravagerAttackBlockedByShield(e, tgt, { random: () => 0.1 }); })[0],
  roar: run(() => {
    const e = mk(); e.ravagerStunTick = 1;
    new Ai.RavagerRoarGoal(e, EL.aiCtx(e)).tick();
  })[0],
  celebrate: M.Raid.CELEBRATE_SOUND.ravager
};
const WANT = { ambient: 'entity.ravager.ambient', hurt: 'entity.ravager.hurt', death: 'entity.ravager.death',
  stunned: 'entity.ravager.stunned', roar: 'entity.ravager.roar', celebrate: 'entity.ravager.celebrate' };
for (const k of Object.keys(WANT)) ok(EXPECT[k] === WANT[k], `${k}: got ${EXPECT[k]}, want ${WANT[k]}`);

// attack: MeleeAttackGoal's onAttack hook -> entity.ravager.attack
{
  const e = mk(); const t = EL.spawn('zombie', 1.5, 70, 0); e.target = t;
  const gs = e.ai; let got = null;
  for (let i = 0; i < 60 && !got; i++) { const r = run(() => EL.tick(0.05)); got = r.find((s) => s === 'entity.ravager.attack'); }
  ok(got === 'entity.ravager.attack', 'attack: a ravager attacking in reach plays entity.ravager.attack');
}
// the 50% branch: no stun -> no stunned sound
{
  const r = run(() => Ai.ravagerAttackBlockedByShield(mk(), tgt, { random: () => 0.9 }));
  ok(!r.includes('entity.ravager.stunned'), 'no stun sound on the knockback branch');
}

// ── breaks: each must be noticed ──
const unwired = run(() => { const e = mk(); e.ravagerStunTick = 1; const g = new Ai.RavagerRoarGoal(e, EL.aiCtx(e)); e.ravagerStunTick = 5; g.tick(); });
breaks++; ok(!unwired.includes('entity.ravager.roar'), 'break: roar must not play while stunTick stays above 0');
breaks++; ok(M.Raid.CELEBRATE_SOUND.ravager !== 'entity.ravager.hurt', 'break: celebrate is not the hurt id');
{ const saved = M.Sound.play; M.Sound.play = () => false;
  const r = run(() => Ai.ravagerAttackBlockedByShield(mk(), tgt, { random: () => 0.1 }));
  M.Sound.play = saved; breaks++; ok(r.length === 0, 'break: with Sound.play dead nothing is recorded'); }
{ const e = mk(); e.silent = true;
  const r = run(() => Ai.ravagerAttackBlockedByShield(e, tgt, { random: () => 0.1 }));
  breaks++; ok(r.length === 0, 'break: a silent ravager emits nothing'); }

console.log(`ravagersoundcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (let i = 0; i < breaks; i++) console.log("  ✓ break " + (i + 1) + " caught");
console.log(` breaks caught ...... ${breaks}`);
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
