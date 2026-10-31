#!/usr/bin/env node
// explosionsoundcheck.mjs -- #5252: Ex.explode plays entity.generic.explode (BLOCKS, 4.0,
// pitch (1+(f-f)*0.2)*0.7 in [0.56,0.84]) once at the centre, destroyed blocks or not.
import { loadEngine } from './loadsrc.mjs';
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js'];
function run(power, griefing, strip) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Behave.init(M.World); M.Entities.init(); M.EntityList.init(); M.Explosion.init();
  M.World.init(1);
  const c = M.World.makeChunk(0, 0); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(0, 0), c);
  const log = [];
  M.Sound = { play: (n, o) => log.push([n, o]) };
  if (strip) M.Sound = undefined;
  for (let i = 0; i < 20; i++) M.Explosion.explode(null, 8.5, 70, 8.5, power, griefing);
  return log;
}
let fail = 0, breaks = 0;
const ok = (c, m) => { if (!c) { console.log('x ' + m); fail++; } };
for (const [p, g, label] of [[4, true, 'tnt/creeper blast'], [4, false, 'non-griefing blast'], [0, true, 'power 0']]) {
  const log = run(p, g);
  ok(log.length === 20, label + ': expected 20 sounds, got ' + log.length);
  for (const [n, o] of log) {
    ok(n === 'entity.generic.explode', label + ' name ' + n);
    ok(o.volume === 4 && o.source === 'block', label + ' vol/source');
    ok(o.pitch >= 0.56 && o.pitch <= 0.84, label + ' pitch ' + o.pitch);
    ok(o.x === 8.5 && o.y === 70 && o.z === 8.5, label + ' position');
  }
  ok(new Set(log.map((l) => l[1].pitch)).size > 1, label + ' pitch not randomised');
}
// anti-vacuity: no Sound module -> nothing logged
breaks++; if (run(4, true, true).length !== 0) { console.log('x vacuous'); fail++; }
console.log(`${breaks} breaks caught, ${fail} failed`);
process.exit(fail ? 1 : 0);
