#!/usr/bin/env node
// #4599: llama_spit yaw/pitch are ProjectileEntity.updateRotation's 0.2 low-pass (seeded from the velocity at spawn, prev = current), lerped by the renderer into Ry(yaw-90)*Rz(pitch).
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07i_entitylist.js', '07ze_llama.js', '07j_entityrender.js'], dom: false });
const Ll = M.Llama, ER = M.EntityRender;
const run = () => {
  const e = { type: 'llama_spit', x: 0, y: 64, z: 0, vx: 0, vy: 1, vz: 1 };   // 45 degrees up, yaw atan2(0,1)=0
  Ll.seedSpitRot(e); Ll.tick(e);
  return e;
};
const e = run();
ok(Math.abs(e.spitPitch - 45) < 1e-9, 'pitch seeded = 45');
ok(Math.abs(e.spitPitchO - 45) < 1e-9, 'prev pitch = seeded pitch');
Ll.tick(e);
ok(Math.abs(e.spitPitch - 45) < 1e-9, 'pitch stays on velocity direction');
const sp = { vx: 1, vy: 0, vz: 0 }; Ll.seedSpitRot(sp);
ok(Math.abs(sp.spitYaw - 90) < 1e-9 && sp.spitYawO === sp.spitYaw, 'yaw seeded');
const yawE = { type: 'llama_spit', x: 0, y: 64, z: 0, vx: 1, vy: 0, vz: 0 };
Ll.seedSpitRot(yawE); Ll.tick(yawE);
ok(Math.abs(yawE.spitYaw - 90) < 1e-9, 'yaw seeded = 90');
e.vy = 0; Ll.tick(e); Ll.tick(e);   // velocity turned (rotation reads the tick-START velocity, so one hook later): low-pass moves 0.2 of the way
const a0 = ER.spitAnimOf(e, 0).sleepPose.R, a1 = ER.spitAnimOf(e, 1).sleepPose.R;
ok(Math.abs(a0[3] - a1[3]) > 1e-3, 'Rz(pitch) differs between prev and current tick (lerped)');
ok(Math.abs(ER.spitAnimOf({ type: 'llama_spit' }, 1).sleepPose.R[3]) < 1e-12, 'level spit has no Rz');
// gravity trajectory: motion step (drag .99, vy-0.06) runs BEFORE Ll.tick, rotation must use the tick-start velocity (vanilla order)
{
  const g = { type: 'llama_spit', x: 0, y: 64, z: 0, vx: 0, vy: 0.5, vz: 1 }; Ll.seedSpitRot(g);
  let vy = 0.5, vz = 1, p = Math.atan2(vy, vz) * 180 / Math.PI, bad = 0;
  for (let i = 0; i < 12; i++) {
    p += (Math.atan2(vy, vz) * 180 / Math.PI - p) * 0.2;   // vanilla: rotate from v0, then drag+gravity
    vy = vy * 0.99 - 0.06; vz *= 0.99; g.vy = vy; g.vz = vz; g.y += 0.001;   // lite motion step first
    Ll.tick(g);
    if (Math.abs(g.spitPitch - p) > 1e-9) bad++;
  }
  ok(bad === 0, 'gravity trajectory pitch matches vanilla order');
}
// break: a frozen pitch must be caught
const keep = e.spitPitch; e.spitPitch = 0; e.spitPitchO = 0;
if (Math.abs(ER.spitAnimOf(e, 1).sleepPose.R[3]) < 1e-12 && keep !== 0) { breaks++; console.log('   ✓ anti-vacuity: break caught'); } else fails.push('break not caught');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length || breaks < 1 ? 1 : 0);
