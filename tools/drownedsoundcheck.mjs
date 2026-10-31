#!/usr/bin/env node
// drownedsoundcheck.mjs — #992: DrownedEntity sounds (.decomp): ambient/hurt/death swap to *_water while touching
// water, step entity.drowned.step, getSwimSound entity.drowned.swim (Entity.move, in water), attack() plays
// entity.drowned.shoot (1.0, pitch 1/(r*0.4+0.8)). Proves it can fail.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({
  extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '14e_gamemode.js', '07q_effects.js', '14j_combat.js', '07zx_particle.js', '07zk_undead.js'],
  initReg: false
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, U = M.Undead;
const evs = JSON.parse(readFileSync(join(ROOT, '.mcsnd', 'sounds.json'), 'utf8'));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const played = [];
M.Sound = Object.assign(M.Sound || {}, { play: (ev, o) => { played.push([ev, o]); } });
M.Sound.entitySound = (ev, x, y, z, volume, pitch, source) => M.Sound.play(ev, { x, y, z, volume, pitch, source });
const rz = () => 0.5;
const mk = (wet) => { const d = EL.spawn('drowned', 0, 64, 0); d.growAge = 0; d.maxHealth = d.health = 20; d.inWater = wet; d.onGround = !wet; d.ambientSoundChance = 0; return d; };

const run = () => {
  const out = {};
  for (const wet of [false, true]) {
    const k = wet ? 'w' : 'l';
    let d = mk(wet); d.ambientSoundChance = 600;
    played.length = 0; U.tickSounds(d, rz); out['amb' + k] = played.map((p) => p[0]);
    d = mk(wet); played.length = 0; Cb.hurt(d, 1, undefined, true); out['hurt' + k] = played.map((p) => p[0]);
    d = mk(wet); played.length = 0; Cb.hurt(d, 100, undefined, true); out['death' + k] = played.map((p) => p[0]);
    d = mk(wet); d.vy = 0.5; played.length = 0; U.tickSounds(d, rz); d.x = 2; U.tickSounds(d, rz);
    out['move' + k] = played.map((p) => [p[0], p[1].volume]);
  }
  const d = mk(false), t = EL.spawn('zombie', 5, 64, 0);
  played.length = 0; Cb.mobShootTrident(d, t, () => 0.5); out.shoot = played.map((p) => [p[0], p[1].volume, p[1].pitch]);
  return out;
};
const J = JSON.stringify;
const good = (o) => J(o.ambl) === '["entity.drowned.ambient"]' && J(o.ambw) === '["entity.drowned.ambient_water"]' &&
  J(o.hurtl) === '["entity.drowned.hurt"]' && J(o.hurtw) === '["entity.drowned.hurt_water"]' &&
  J(o.deathl) === '["entity.drowned.death"]' && J(o.deathw) === '["entity.drowned.death_water"]' &&
  o.movel.length === 1 && o.movel[0][0] === 'entity.drowned.step' && o.movel[0][1] === 0.15 &&
  o.movew.length === 1 && o.movew[0][0] === 'entity.drowned.swim' && o.movew[0][1] > 0 && o.movew[0][1] <= 1 &&
  o.shoot.length === 1 && o.shoot[0][0] === 'entity.drowned.shoot' && o.shoot[0][1] === 1 && Math.abs(o.shoot[0][2] - 1 / 1.0) < 1e-9;
const o = run(); if (process.env.DBG) console.log(J(o));
ok(good(o), 'full vanilla comparison');
for (const ev of Object.values(U.SOUNDS.drowned)) ok(evs[ev], `${ev} not in sounds.json`);

const caught = (label, fn) => {
  const save = { S: { ...U.SOUNDS.drowned }, sh: Cb.mobShootTrident, ts: U.tickSounds };
  fn();
  let bad; try { bad = !good(run()); } catch (e) { bad = true; }
  Object.keys(U.SOUNDS.drowned).forEach((k) => delete U.SOUNDS.drowned[k]); Object.assign(U.SOUNDS.drowned, save.S);
  Cb.mobShootTrident = save.sh; U.tickSounds = save.ts;
  breaks += bad ? 1 : 0;
  if (bad) console.log(`   ✓ break caught: ${label}`); else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
caught('swim event removed', () => { delete U.SOUNDS.drowned.swim; });
caught('water hurt variant removed', () => { delete U.SOUNDS.drowned.hurt_water; });
caught('water ambient variant removed', () => { delete U.SOUNDS.drowned.ambient_water; });
caught('death_water swapped', () => { U.SOUNDS.drowned.death_water = 'entity.drowned.death'; });
caught('step event swapped', () => { U.SOUNDS.drowned.step = 'entity.zombie.step'; });
caught('tickSounds removed', () => { U.tickSounds = () => {}; });
caught('shoot sound dropped', () => { const f = Cb.mobShootTrident; Cb.mobShootTrident = (e, t, r) => { const s = M.Sound.entitySound; M.Sound.entitySound = () => {}; try { return f(e, t, r); } finally { M.Sound.entitySound = s; } }; });

console.log('\n================ drownedsoundcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
