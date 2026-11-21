#!/usr/bin/env node
// ghastsoundcheck.mjs — #644: ghast ambient/hurt/death sounds at volume 5.0 (GhastEntity).
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js', '07zzi_ghast.js'], dom: false });
const Gh = MCL.Ghast;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
function run() {
  const played = [];
  MCL.Sound = MCL.Sound || {};
  MCL.Sound.play = (id, o) => { played.push([id, o]); return true; };
  const e = { type: 'ghast', x: 1, y: 2, z: 3, health: 10, dead: false };
  Gh.playDamageSound(e, false); Gh.playDamageSound(e, true);
  const g = new Gh.AmbientGoal(e);
  for (let i = 0; i < 5000; i++) g.tick();
  const ids = played.map(p => p[0]);
  return { ids, vols: played.map(p => p[1].volume), src: played.map(p => p[1].source) };
}
function verdict() {
  const r = run();
  return r.ids[0] === 'entity.ghast.hurt' && r.ids[1] === 'entity.ghast.death' && r.ids.slice(2).length > 5 &&
    r.ids.slice(2).every(i => i === 'entity.ghast.ambient') && r.vols.every(v => v === 5.0) && r.src.every(s => s === 'hostile');
}
ok(verdict(), 'hurt, death, ambient ids; volume 5.0; hostile source');
function pv() {
  const played = []; MCL.Sound.play = (id, o) => { played.push(o); return true; };
  const e = { type: 'ghast', x: 1, y: 2, z: 3, health: 10, dead: false };
  for (let i = 0; i < 200; i++) Gh.playDamageSound(e, false);
  const ps = played.map(o => o.pitch), n = played.length;
  e.silent = true; Gh.playDamageSound(e, false);
  return n === 200 && played.length === 200 && ps.every(p => p >= 0.8 && p <= 1.2) && new Set(ps).size > 50;
}
ok(pv(), 'pitch varies in [0.8,1.2]; silent ghast emits nothing');
const saved = [Gh.SOUND_VOLUME, Gh.SOUND_HURT];
Gh.SOUND_VOLUME = 1.0; if (!verdict()) breaks++; Gh.SOUND_VOLUME = saved[0];
Gh.SOUND_HURT = 'x'; if (!verdict()) breaks++; Gh.SOUND_HURT = saved[1];
{ const L = MCL.EntityList, r = L.random; L.random = () => 0.5; if (!pv()) breaks++; L.random = r; }
ok(breaks === 3, breaks + ' breaks caught');
console.log(`\n${pass} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
