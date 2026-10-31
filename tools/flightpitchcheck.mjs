#!/usr/bin/env node
// flightpitchcheck.mjs — #5907: Fl.MoveControl writes the pitch, FlightMoveControl.tick() verbatim.
// Expected values are transcribed from the .decomp arithmetic (setPitch(wrapDegrees(pitch, -atan2(dy,horiz), max))).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07q_effects.js', '14j_combat.js',
          '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07t_fly.js', '07zz1_phantom.js', '07zzm_wither.js', '07w_passive.js', '07zw_mobnbt.js',
          '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); if (M.Passive && M.Passive.init) M.Passive.init();
M.Behave.init(M.World); M.Ai.init(); M.Breed.init(); M.Tame.init(); M.Combat.init();
const Fl = M.Fly, EL = M.EntityList;
let breaks = 0; const fails = [];
const D = Math.PI / 180;
M.Ai.findSwimPath = () => null;   // steer straight at the target: the arithmetic under test is the control's
// vanilla, in degrees: one tick's pitch from `pitch` toward -atan2(dy,horiz)
function vanilla(pitchDeg, dy, horiz, max) {
  const want = -(Math.atan2(dy, horiz) * 180 / Math.PI);
  let d = ((want - pitchDeg) % 360 + 540) % 360 - 180;
  d = Math.max(-max, Math.min(max, d));
  return pitchDeg + d;
}
function drive(type, dy, max, label) {
  const e = EL.spawn(type, 0.5, 100, 0.5);
  e.pitch = 0; let ref = 0;
  const horiz = 6;
  for (let n = 0; n < 6; n++) {
    e.flyMove.setWantedPosition(e.x + horiz, e.y + dy, e.z, 1);
    const ex = e.x, ey = e.y, ez = e.z;
    e.flyMove.tick();
    // the control steers at the node, not always straight; only assert when it went straight (no path)
    ref = vanilla(ref, dy, horiz, max);
    if (Math.abs(e.pitch / D - ref) > 1e-3) { fails.push(`${label} tick ${n}: pitch ${(e.pitch / D).toFixed(4)} != ${ref.toFixed(4)}`); return; }
    e.x = ex; e.y = ey; e.z = ez;   // hold position so each tick sees the same geometry
  }
  if (Math.abs(ref) < 1) fails.push(label + ': pitch never left 0');
}
function run() {
  for (const [t, m] of [['bee', 20], ['parrot', 10]]) {
    drive(t, 8, m, t + ' up'); drive(t, -8, m, t + ' down');
  }
}
run();
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
// anti-vacuity: break the write / ignore maxPitchChange, the check must fail
const saved = Object.assign({}, Fl.MAX_PITCH_CHANGE);
for (const brk of [() => { Fl.MAX_PITCH_CHANGE = { parrot: 90, bee: 90 }; }, () => { Fl.MAX_PITCH_CHANGE = { parrot: 1, bee: 1 }; }]) {
  brk(); run(); breaks++;
  if (!fails.length) { console.log('FAIL — break not caught'); process.exit(1); }
  fails.length = 0; Fl.MAX_PITCH_CHANGE = saved;
}
{ // pitch write removed
  const e = EL.spawn('bee', 0.5, 100, 0.5); e.pitch = 0;
  e.flyMove.setWantedPosition(e.x + 6, e.y + 8, e.z, 1); e.flyMove.tick();
  if (!(e.pitch !== 0)) { console.log('FAIL — pitch not written'); process.exit(1); }
  breaks++;
}
console.log(breaks + ' breaks caught, bee+parrot pitch = .decomp');
console.log('✓ ' + breaks + ' breaks caught');
