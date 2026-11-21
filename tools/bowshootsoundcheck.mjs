#!/usr/bin/env node
// bowshootsoundcheck.mjs — #1016: Cb.mobShoot (skeleton/stray/wither skeleton/illusioner bow shot) plays
// entity.skeleton.shoot once per shot, pitch 1/(rand*0.4+0.8) in [0.833,1.25] (AbstractSkeletonEntity.attack,
// IllusionerEntity.attack). Proves it can fail: a forged pitch window and a muted engine must both be noticed.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({
  extra: ['02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '14e_gamemode.js', '07q_effects.js', '14j_combat.js', '14d_survival.js', '07zx_particle.js'],
  initReg: false
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.Items.init({ items: readFileSync(join(ROOT, 'assets', 'items.bin')).toString('base64'),
  itemsBytes: JSON.parse(readFileSync(join(ROOT, 'assets', 'items.meta.json'), 'utf8')).rawBytes });
M.EntityList.init();

let played = [];
M.Sound = { play: (ev, o) => played.push([ev, o]) };
const shoot = (type, r) => {
  played = [];
  const shooter = { type, x: 0, y: 4, z: 0, height: 1.99, eyeHeight: 1.74 }, target = { type: 'player', x: 0, y: 4, z: 6, height: 1.8 };
  M.Combat.mobShoot(shooter, target, 1, () => r);
  return played.filter((p) => p[0] === 'entity.skeleton.shoot');
};
const ok = (s, lo, hi) => s.length === 1 && s[0][1].pitch >= lo && s[0][1].pitch <= hi;
let pass = 0, fail = 0, caught = 0, breaks = 0;
for (const type of ['skeleton', 'stray', 'wither_skeleton', 'illusioner'])
  for (const r of [0, 0.5, 0.999]) {
    const s = shoot(type, r);
    if (ok(s, 0.833, 1.2501)) pass++; else { fail++; console.log(`  ✗ ${type} rnd ${r}: ${s.length} sounds, pitch ${s[0] && s[0][1].pitch}`); }
  }
breaks++; if (!ok(shoot('skeleton', 0.5), 1.3, 2)) caught++, console.log("  ✓ forged pitch window rejected"); else { fail++; console.log('  ✗ forged pitch window not caught'); }
breaks++; { const real = M.Sound.play; M.Sound.play = null; if (!ok(shoot('skeleton', 0.5), 0.833, 1.2501)) caught++, console.log("  ✓ muted engine rejected"); else { fail++; console.log('  ✗ muted engine not caught'); } M.Sound.play = real; }
console.log(`bowshootsoundcheck: ${pass} ok, ${fail} failed`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${fail}`);
console.log(`${caught} breaks caught`);
process.exit(fail ? 1 : 0);
