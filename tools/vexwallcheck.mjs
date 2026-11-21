#!/usr/bin/env node
// vexwallcheck.mjs — #2409: a vex inside a wall keeps full health; a zombie in the same wall does not.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const M = loadEngine({
  extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07z_potion.js',
          '07v_spell.js', '07k_goals.js', '07t_fly.js', '07s_raid.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init(); M.Raid.init();
const EL = M.EntityList, W = M.World, CH = M.CH;
const STONE = M.States.stateOf('stone') | 0;

W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
for (let x = -4; x <= 4; x++) for (let y = 4; y <= 14; y++) for (let z = -4; z <= 4; z++) W.setBlock(x, y, z, STONE);

let breaks = 0, bad = [];
const run = (type) => {
  const e = EL.spawn(type, 0.5, 8, 0.5);
  const hp0 = e.health;
  for (let i = 0; i < 40; i++) EL.tick();
  return { e, hp0 };
};
const v = run('vex');
if (!(v.e.health === v.hp0 && !v.e.dead)) bad.push(`vex lost health in stone: ${v.hp0} -> ${v.e.health}`);
const z = run('zombie');   // anti-vacuity: the same wall does hurt a non-vex
if (z.e.health < z.hp0 || z.e.dead) breaks++; else bad.push('anti-vacuity: zombie took no wall damage, the wall is not suffocating');
if (bad.length) { console.log('FAILED:\n  - ' + bad.join('\n  - ')); process.exit(1); }
console.log(`PASS vexwallcheck — 2 assertions, ${breaks} breaks caught, 0 failure(s)`);
