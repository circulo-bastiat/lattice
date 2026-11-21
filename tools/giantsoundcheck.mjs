#!/usr/bin/env node
// giantsoundcheck.mjs - #917: a giant is a HostileEntity that overrides no sounds, so a hit plays
// entity.hostile.hurt and the kill entity.hostile.death (HostileEntity.java:57-78).
// ANTI-VACUITY: re-run against broken tables; each must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

function scenario(brk) {
  const M = loadEngine({
    extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
            '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14j_combat.js', '07zk_undead.js'],
    dom: false
  });
  initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Ai.init(); if (M.Combat && M.Combat.init) M.Combat.init();
  const calls = [];
  M.Sound = { entitySound: (ev) => { calls.push(ev); return true; } };
  if (brk === 'nohurt') delete M.Undead.SOUNDS.giant.hurt;
  if (brk === 'wrongdeath') M.Undead.SOUNDS.giant.death = 'entity.zombie.death';
  const out = [];
  const say = (c, m) => { if (!c) out.push(m); };
  M.EntityList.list.length = 0;
  const g = M.EntityList.spawn('giant', 0, 64, 0);
  say(!!g, 'giant spawns');
  calls.length = 0; M.Combat.hurt(g, 1, true);
  say(calls.includes('entity.hostile.hurt'), 'hurt sound on a surviving hit: ' + calls);
  const g2 = M.EntityList.spawn('giant', 5, 64, 0);
  calls.length = 0; M.Combat.hurt(g2, 99999, true);
  say(calls.includes('entity.hostile.death'), 'death sound on the kill: ' + calls);
  return out;
}
const fails = scenario(null);
let caught = 0;
for (const b of ['nohurt', 'wrongdeath']) {
  if (scenario(b).length) { caught++; console.log(`  ✓ break caught: ${b}`); } else fails.push(`break NOT caught: ${b}`);
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`giantsoundcheck: ${fails.length ? 'FAIL' : 'PASS'}`);
console.log(`giantsoundcheck: ${caught} breaks caught (of 2)`);
process.exit(fails.length ? 1 : 0);
