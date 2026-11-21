#!/usr/bin/env node
// viewbobcheck.mjs — #394: the WORLD camera bobs, rolls on hurt and tips on death (vanilla renderWorld).
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) console.log('  ✓ break caught: ' + m); if (c) pass++; else fails.push('anti-vacuity: ' + m); };
const MCL = loadEngine({ extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '14k_hand3d.js', '10_camera.js', '10_gfx.js'], dom: false, initReg: false });
const { Cam, Hand3D: H3, Gfx: G, U } = MCL;
const mk = () => { const c = Cam.create(); c.yaw = 0.5; c.pitch = 0.2; c.aspect = 1.5; c.far = 200; c.bobM = null; return c; };
const cam = () => { const c = mk(); Cam.update(c); return c; };
const diff = (a, b) => { let d = 0; for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
const base = cam().viewProj.slice();
const P = { walkDist: 3.3, walkDistO: 3.0, bob: 0.08, oBob: 0.08, hurtTime: 0, deathTime: 0 };
MCL.Player = P; MCL.Main = { partial: () => 0.5 }; MCL.Settings = { viewBobbing: true };
const expect = (p, bobOn) => {
  const m = H3._m.ident(new Float32Array(16)); H3.bobHurt(m, p, 0.5); if (bobOn) H3.bobView(m, p, 0.5);
  const c = mk(); const pr = new Float32Array(16), t = new Float32Array(16);
  Cam.update(c); U.mat4.multiply(pr, c.proj, m); U.mat4.multiply(t, pr, c.view); return t;
};
const runG = () => { const c = mk(); c.bobM = G.viewBobMatrix(); Cam.update(c); return c.viewProj; };

ok(diff(runG(), expect(P, true)) < 1e-5, 'walk bob: world viewProj = proj*bob*view');
okAv(diff(runG(), base) > 1e-3, 'walk bob changes the world view');
MCL.Settings.viewBobbing = false;
ok(diff(runG(), base) < 1e-6, 'viewBobbing=false removes the walk half');
const Q = { ...P, hurtTime: 5, hurtDuration: 10, hurtDir: 0 };
MCL.Player = Q; ok(diff(runG(), base) > 1e-3, 'hurt rolls the world');
ok(diff(runG(), expect(Q, false)) < 1e-5, 'hurt roll = bobHurt only');
MCL.Player = { ...P, deathTime: 10 }; ok(diff(runG(), base) > 1e-3, 'death tilts the world');
MCL.Player = { ...P, hurtTime: 0 }; ok(diff(runG(), base) < 1e-6, 'nothing when no hurt and bob off');
console.log('================ viewbobcheck ===============');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
for (const f of fails) console.log('FAIL ' + f);
process.exit(fails.length ? 1 : 0);
