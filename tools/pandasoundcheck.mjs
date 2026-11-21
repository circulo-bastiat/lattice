#!/usr/bin/env node
// pandasoundcheck.mjs - #927: PandaEntity's voice. getAmbientSound (aggressive/worried/plain by gene), getHurtSound,
// getDeathSound, playStepSound 0.15/1.0, tryAttack bite, tick pre_sneeze at progress 1, sneeze(), playEatingAnimation.
// ANTI-VACUITY: each break is re-run against the engine and must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

function scenario(brk) {
  const M = loadEngine({
    extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
            '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '14j_combat.js', '07zw_mobnbt.js', '07zl_panda.js', '07zzp_mobvoice.js'],
    dom: false
  });
  initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
  const mobSounds = {};
  for (const l of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'mob-sounds-1.18.2.tsv'), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const t = l.split('\t'); mobSounds[t[0]] = t.slice(2); }
  M.DATA = Object.assign({}, M.DATA, { mobSounds });
  M.Physics.blockAt = () => 1;   // MobVoice.tickStep reads the block under the feet
  M.World = M.World || { getBlock: () => 0 };   // #3665: meleeNavTick canSee raycasts
  M.Ai.findPath = () => null;   // no world to path through; the bite is adjacent
  M.Entities.init(); M.EntityList.init(); M.Ai.init(); if (M.Combat && M.Combat.init) M.Combat.init();
  const calls = [];
  M.Sound = { play: (ev, o) => { calls.push({ ev, o }); return true; } };
  const Pd = M.Panda, Cb = M.Combat, EL = M.EntityList;
  if (brk === 'silent') Pd.playSound = () => false;
  if (brk === 'nobaby') { const f = Pd.playSound; Pd.playSound = (e, ev, v, pi) => f(e, ev, v, pi === undefined ? (Math.random() - Math.random()) * 0.2 + 1 : pi); }
  if (brk === 'sneezepitch') { const f = Pd.playSound; Pd.playSound = (e, ev, v, pi) => f(e, ev, v, /sneeze/.test(ev) ? undefined : pi); }
  if (brk === 'dup') Pd.tickVoice = () => 0;   // #3531: a second panda voice
  if (brk === 'ambient') { Pd.isAttacking = () => false; Pd.isWorried = () => false; }
  const out = [];
  const say = (c, m) => { if (!c) out.push(m); };
  const G = Pd.Gene;
  EL.list.length = 0;
  const p = EL.spawn('panda', 0, 64, 0);
  say(Pd.tickVoice === undefined, '#3531: MobVoice owns panda ambient+step; Pd.tickVoice must not exist');
  const has = (ev) => calls.some((x) => x.ev === ev);
  // ambient by gene
  for (const [gene, ev] of [[G.AGGRESSIVE, Pd.SOUND.aggressive], [G.WORRIED, Pd.SOUND.worried], [G.NORMAL, Pd.SOUND.ambient]]) {
    p.mainGene = gene; p.hiddenGene = gene;
    calls.length = 0; p.ambientSoundChance = 5000; M.MobVoice.tick(p);
    say(has(ev), `ambient for gene ${gene} should be ${ev}, got ${calls.map((c) => c.ev)}`);
  }
  // step: 0.15 volume, pitch 1
  p.mainGene = p.hiddenGene = G.NORMAL; p.onGround = true; p.ambientSoundChance = -80;
  calls.length = 0; p.pdPx = undefined; p.x = 0; p.z = 0; M.MobVoice.tick(p);
  for (let i = 0; i < 10; i++) { p.x += 0.5; p.ambientSoundChance = -80; M.MobVoice.tick(p); }
  const st = calls.filter((c) => c.ev === Pd.SOUND.step);
  say(st.length >= 1 && st.every((c) => c.o.volume === 0.15 && c.o.pitch === 1), 'step at volume 0.15 pitch 1');
  // hurt / death
  calls.length = 0; Cb.hurt(p, 1, true);
  say(has('entity.panda.hurt'), 'hurt sound on a surviving hit');
  p.invulnerableTime = 0; calls.length = 0; Cb.hurt(p, 9999, true);
  say(has('entity.panda.death'), 'death sound on the kill');
  // baby: getSoundPitch +1.5 on ambient/hurt/death
  EL.list.length = 0;
  const kid = EL.spawn('panda', 40, 64, 0); kid.growAge = -24000; kid.isBaby = true; kid.mainGene = kid.hiddenGene = G.NORMAL;
  calls.length = 0; kid.ambientSoundChance = 5000; M.MobVoice.tick(kid);
  say(calls.length >= 1 && calls.every((c) => c.o.pitch > 1.3), 'baby ambient pitch ~1.5');
  calls.length = 0; Cb.hurt(kid, 1, true);
  say(has('entity.panda.hurt') && calls.every((c) => c.o.pitch > 1.3), 'baby hurt pitch ~1.5');
  kid.invulnerableTime = 0; calls.length = 0; Cb.hurt(kid, 9999, true);
  say(has('entity.panda.death') && calls.every((c) => c.o.pitch > 1.3), 'baby death pitch ~1.5');
  // sneeze
  const q = EL.spawn('panda', 20, 64, 0);
  q.sneezing = true; q.sneezeProgress = 0; calls.length = 0;
  Pd.tickSneeze(q, {});
  say(calls.filter((c) => c.ev === 'entity.panda.pre_sneeze').length === 1, 'pre_sneeze at progress 1');
  Pd.tickSneeze(q, {});
  say(calls.filter((c) => c.ev === 'entity.panda.pre_sneeze').length === 1, 'pre_sneeze only once');
  say(!has('entity.panda.sneeze'), 'no sneeze before progress > 20');
  for (let i = 0; i < 25; i++) Pd.tickSneeze(q, {});
  say(calls.filter((c) => c.ev === 'entity.panda.sneeze').length === 1, 'sneeze once at the end');
  // only babies sneeze: vanilla playSound(sound, 1, 1) is a literal pitch 1.0, not getSoundPitch
  const bq = EL.spawn('panda', 25, 64, 0); bq.growAge = -24000; bq.isBaby = true; bq.sneezing = true; bq.sneezeProgress = 0; calls.length = 0;
  for (let i = 0; i < 25; i++) Pd.tickSneeze(bq, {});
  const sn = calls.filter((c) => /pre_sneeze|panda\.sneeze/.test(c.ev));
  say(sn.length === 2 && sn.every((c) => c.o.pitch === 1), 'baby pre_sneeze/sneeze pitch exactly 1.0, got ' + sn.map((c) => c.o.pitch));
  // eat
  calls.length = 0; Pd.eatSound(q, 3, () => 0); say(calls.length === 0, 'no eat sound off the 5th tick');
  Pd.eatSound(q, 5, () => 0.9); say(calls.length === 1 && calls[0].o.volume === 1, 'eat volume 1.0 on roll 1');
  calls.length = 0; Pd.eatSound(q, 10, () => 0.1); say(calls.length === 1 && calls[0].o.volume === 0.5, 'eat volume 0.5 on roll 0');
  // bite
  EL.list.length = 0;
  const b = EL.spawn('panda', 0, 64, 0), z = EL.spawn('zombie', 1, 64, 0);
  b.target = z; calls.length = 0;
  const g = new Pd.AttackGoal(b, {});
  g.tick();
  say(has('entity.panda.bite'), 'bite on a swing');
  return out;
}
const fails = scenario(null);
let caught = 0;
for (const b of ['silent', 'ambient', 'nobaby', 'dup', 'sneezepitch']) {
  if (scenario(b).length) { caught++; console.log(`  ✓ break caught: ${b}`); } else fails.push(`break NOT caught: ${b}`);
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`pandasoundcheck: ${fails.length ? 'FAIL' : 'PASS'}`);
console.log(`pandasoundcheck: ${caught} breaks caught (of 5)`);
process.exit(fails.length ? 1 : 0);
