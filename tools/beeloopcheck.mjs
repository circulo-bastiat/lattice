#!/usr/bin/env node
// beeloopcheck.mjs — #2621: a live bee owns a looping entity.bee.loop voice following AbstractBeeSoundInstance's
// volume/pitch law; anger swaps it for loop_aggressive and back; removal stops it. Ends "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07h_entities.js', '07_world.js', '07b_behaviour.js', '14b_physics.js', '07i_entitylist.js', '07zo_bee.js'], dom: false });
const table = JSON.parse(readFileSync(join(MCLITE_ROOT, '.mcsnd/sounds.json'), 'utf8'));
const voices = [];
M.Sound = { loopVoice: (ev) => { const v = { event: ev, stopped: false, stop() { v.stopped = true; }, set(vol, p) { v.vol = vol; v.pitch = p; } }; voices.push(v); return v; } };

function run(B) {
  const r = {};
  r.has = !!table['entity.bee.loop'] && !!table['entity.bee.loop_aggressive'];
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const still = B.loopLaw(0.005, false), mid = B.loopLaw(0.3, false), fast = B.loopLaw(2, false), baby = B.loopLaw(0.3, true);
  r.still = still.volume === 0 && still.pitch === 0;
  r.vol = near(mid.volume, 0.36) && near(fast.volume, 0.6);
  r.pitch = near(mid.pitch, 0.7 + 0.7 * 0.4) && near(baby.pitch, 1.1 + 1.1 * 0.4);
  voices.length = 0;
  const e = { x: 0, y: 0, z: 0, angerTime: 0 };
  B.soundTick(e); e.x = 0.3; B.soundTick(e);
  r.voice = voices.length === 1 && voices[0].event === 'entity.bee.loop' && near(voices[0].vol, 0.36);
  e.angerTime = 100; B.soundTick(e);
  r.aggro = voices.length === 2 && voices[0] && voices[0].stopped && voices[1].event === 'entity.bee.loop_aggressive';
  e.angerTime = 0; B.soundTick(e);
  r.back = voices.length === 3 && voices[2].event === 'entity.bee.loop';
  e.removed = true; B.soundTick(e);
  r.gone = !!(voices[2] && voices[2].stopped);
  return r;
}
const good = run(M.Bee);
for (const [k, m] of [['has', 'both events in the sound table'], ['still', 'speed<0.01 -> silent'], ['vol', 'volume = lerp(clamp(v,0,.5),0,1.2)'],
  ['pitch', 'pitch law adult/baby'], ['voice', 'live bee has a passive loop voice'], ['aggro', 'anger swaps to loop_aggressive'],
  ['back', 'passive resumes'], ['gone', 'removed bee stops voice']]) ok(good[k], m);

// anti-vacuity: break each law and the check must notice
const breaks = {
  loopLaw: B => ({ ...B, loopLaw: (v) => ({ volume: v, pitch: 1 }) }),
  noVoice: B => ({ ...B, soundTick: () => {} }),
  wrongEvent: B => ({ ...B, soundTick: (e) => { const l = M.Sound.loopVoice('entity.bee.loop'); l.set(0, 0); } }),
};
let caught = 0;
for (const [n, f] of Object.entries(breaks)) {
  let bad; try { bad = run(f(M.Bee)); } catch (x) { fails.push('break ' + n + ' crashed the harness instead of failing a law: ' + x.message); continue; }
  if (Object.entries(bad).some(([k, v]) => v !== good[k])) { caught++; console.log('  ✓ break caught'); } else fails.push('break not caught: ' + n);
}
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`beeloopcheck: ${pass} assertions, 0 failures, ${caught} breaks caught`);
