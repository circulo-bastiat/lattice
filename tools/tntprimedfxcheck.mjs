#!/usr/bin/env node
// tntprimedfxcheck.mjs -- #5189: primed TNT plays entity.tnt.primed once at ignite and spawns one smoke
// particle at (x, y+0.5, z) every tick the fuse still runs (TntEntity.tick client half). Anti-vacuity: edited source must fail.
import { loadEngine } from './loadsrc.mjs';
console.log('tntprimedfxcheck -- #5189, primed TNT sound + smoke');
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
  '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14f_inventory.js', '14l_use.js',
  '14j_combat.js', '07za_explosion.js', '07zb_creeper.js', '07zc_tnt.js'];
function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  const sounds = [], parts = [];
  M.Sound = { entitySound: (...a) => sounds.push(a) };
  M.Particle = { spawn: (...a) => parts.push(a) };
  M.Tnt.ready = true;
  const e = { type: 'tnt', x: 3.5, y: 7, z: -2.5 };
  M.EntityList.DEFAULTS.tnt(e, {});
  ok(e.fuse === 80, 'fuse 80');
  ok(sounds.length === 1 && sounds[0][0] === 'entity.tnt.primed' && sounds[0][1] === 3.5 && sounds[0][2] === 7 &&
    sounds[0][3] === -2.5 && sounds[0][4] === 1 && sounds[0][5] === 1 && sounds[0][6] === 'neutral', 'one primed sound at ignite');
  for (let i = 0; i < 80; i++) M.Tnt.tick(e);
  ok(sounds.length === 1, 'no further sounds during fuse');
  ok(e.removed === true, 'exploded at fuse end');
  ok(parts.length === 79, 'one smoke per running tick (79), got ' + parts.length);
  ok(parts.every((p) => p[0] === 'smoke' && p[1] === 3.5 && p[2] === 7.5 && p[3] === -2.5 && !p[4] && !p[5] && !p[6]), 'smoke at y+0.5, zero velocity');
  ok(M.Tnt.OWED.length === 1, 'sound/smoke OWED line struck');
  return { fails, n };
}
const real = scenarios();
const fails = real.fails.slice(); let breaks = 0;
for (const [file, label, a, b] of [
  ['07i_entitylist.js', 'primed sound removed', "Snd.entitySound('entity.tnt.primed'", "Snd.entitySoundX('entity.tnt.primed'"],
  ['07zc_tnt.js', 'smoke removed', "NS.Particle.spawn('smoke'", "NS.Particle.spawnX('smoke'"],
  ['07zc_tnt.js', 'smoke at wrong height', 'e.y + 0.5, e.z, 0, 0, 0', 'e.y, e.z, 0, 0, 0'],
]) {
  let matched = false;
  const patch = (f, src) => { if (f !== file) return src; if (src.includes(a)) matched = true; return src.split(a).join(b); };
  let r; try { r = scenarios(patch); } catch (err) { r = { fails: ['threw'] }; }
  if (!matched) fails.push('edit matched nothing: ' + label);
  else if (r.fails.length) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('unnoticed break: ' + label);
}
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`tntprimedfxcheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
