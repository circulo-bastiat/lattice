#!/usr/bin/env node
// snowgolemsoundcheck.mjs - #722: the snow golem's voice. SnowGolemEntity.attack plays snow_golem.shoot (vol 1,
// pitch 0.4/(rand*0.4+0.8)); ambient/hurt/death via getAmbientSound/getHurtSound/getDeathSound.
// ANTI-VACUITY: each assertion is re-run against a broken engine (sound removed / wrong pitch) and must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

function scenario(brk) {
  const M = loadEngine({
    extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
            '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14j_combat.js', '07zw_mobnbt.js', '07zq_snowgolem.js', '07zzp_mobvoice.js'],
    dom: false
  });
  initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')),
    mobSounds: { snow_golem: readFileSync(join(MCLITE_ROOT, 'tools/golden/mob-sounds-1.18.2.tsv'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('snow_golem\t')).split('\t').slice(2) } });
  M.Entities.init(); M.EntityList.init(); M.Ai.init(); if (M.Combat && M.Combat.init) M.Combat.init();
  const calls = [];
  M.Sound = { play: (ev, o) => { calls.push({ ev, o }); return true; } };
  const SG = M.SnowGolem, Cb = M.Combat, EL = M.EntityList;
  if (brk === 'silent') SG.playSound = () => false;
  if (brk === 'dup') M.MobVoice.OWN = {};
  const out = [];
  const say = (c, m) => { if (!c) out.push(m); };
  EL.list.length = 0;
  const g = EL.spawn('snow_golem', 0, 64, 0), z = EL.spawn('zombie', 8, 64, 0);
  for (const r of [0, 0.5, 0.999]) {
    calls.length = 0;
    Cb.mobShootSnowball(g, z, () => (brk === 'pitch' ? 0.5 : r));
    const c = calls.filter((x) => x.ev === 'entity.snow_golem.shoot');
    say(c.length === 1, `throw (rnd ${r}) played ${c.length} shoot sounds`);
    const p = c[0] && c[0].o.pitch;
    say(p !== undefined && Math.abs(p - 0.4 / (r * 0.4 + 0.8)) < 1e-9 && p >= 0.4 / 1.2 - 1e-9 && p <= 0.4 / 0.8 + 1e-9, `shoot pitch ${p} for rnd ${r}`);
    say(c[0] && c[0].o.volume === 1, 'shoot volume 1');
  }
  calls.length = 0; Cb.hurt(g, 1, true);
  say(calls.filter((x) => x.ev === 'entity.snow_golem.hurt').length === 1, 'exactly one hurt sound on a surviving hit');
  calls.length = 0; Cb.hurt(g, 9999, true);
  say(calls.filter((x) => x.ev === 'entity.snow_golem.death').length === 1, 'exactly one death sound on the kill');
  EL.list.length = 0;
  const g2 = EL.spawn('snow_golem', 0, 64, 0);
  { const g3 = EL.spawn('snow_golem', 8, 64, 8); if (brk === 'init120') g3.ambientSoundChance = -120;
    SG.tickAmbient(g3); say(g3.ambientSoundChance === 1, 'fresh golem ambientSoundChance starts 0 (MobEntity:90), ++ after one roll (' + g3.ambientSoundChance + ')'); }
  calls.length = 0; Cb.hurtZero(g2, z);
  say(calls.some((x) => x.ev === 'entity.snow_golem.hurt'), 'hurt sound on a 0-damage snowball hit');
  calls.length = 0; g2.ambientSoundChance = 5000;
  M.MobVoice.tick(g2); SG.mobTick(g2, {});
  say(calls.filter((x) => x.ev === 'entity.snow_golem.ambient').length === 1, 'exactly one ambient sound when the roll succeeds');
  if (brk === 'd80') g2.ambientSoundChance = -80;
  say(g2.ambientSoundChance <= -119 && g2.ambientSoundChance >= -120, 'ambient counter reset to GolemEntity min delay -120 (' + g2.ambientSoundChance + ')');
  return out;
}
const fails = scenario(null);
let caught = 0;
for (const b of ['silent', 'pitch', 'dup', 'd80', 'init120']) {
  if (scenario(b).length) { caught++; console.log(`  ✓ break caught: ${b}`); } else fails.push(`break NOT caught: ${b}`);
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`snowgolemsoundcheck: ${fails.length ? 'FAIL' : 'PASS'}`);
console.log(`snowgolemsoundcheck: ${caught} breaks caught (of 5)`);
process.exit(fails.length ? 1 : 0);
