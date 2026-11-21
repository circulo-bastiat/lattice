// tools/cloudfarcheck.mjs — #11263: clouds clipped by the fog-tight world far plane. Builds the real fancy mesh, projects
// every vertex through the matrix the renderer really uploads (Cl.farViewProj) at several pitches/heights, and asserts none
// is clipped by the far plane in front of the camera; also asserts 10_gfx's far plane is the fog-tight one (the cause).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function load(src) {
  const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Array, Object, String, Number, JSON, Error, atob: (s) => Buffer.from(s, 'base64').toString('binary') });
  ctx.window = ctx; ctx.globalThis = ctx;
  for (const f of ['00_ns', '01_util', '01b_inflate', '09b_sky', '10_camera']) vm.runInContext(R('src/' + f + '.js'), ctx, { filename: f });
  vm.runInContext(src, ctx, { filename: '09d' });
  return ctx.MCL || ctx.MCLITE;
}
function verdict(src, fixCam) {
  const bad = [], NS = load(src), Cl = NS.Clouds;
  const gfx = R('src/10_gfx.js');
  if (!/cam\.far = Math\.max\(64, fogFar \+ 16\)/.test(gfx)) bad.push('10_gfx far plane no longer fog-tight; re-audit');
  for (const rd of [4, 8, 16]) for (const pitch of [-1.2, -0.4, 0, 0.4, 1.2]) for (const camY of [20, 80, 190, 250]) {
    const cam = NS.Cam.create ? NS.Cam.create() : {};
    Object.assign(cam, { x: 0, y: camY, z: 0, yaw: 0.7, pitch, fov: 70, aspect: 16 / 9, near: 0.05, far: Math.max(64, rd * 16 * 0.9 + 16), zeroToOne: false, bobM: null });
    if (!cam.proj) { cam.proj = new Float32Array(16); cam.view = new Float32Array(16); cam.viewProj = new Float32Array(16); cam.planes = new Float32Array(24); }
    try { NS.Cam.update(cam); } catch (e) { cam.planes = cam.planes || []; }
    const vp = fixCam(Cl, cam);
    const p = Cl.place(0, 0, 0, camY, 0, 192), v = Cl.build(p.x, p.y, p.z, [1, 1, 1], true);
    let clipped = 0, front = 0;
    for (let i = 0; i < v.length; i += 9) {
      const x = (v[i] + -p.fx) * 12, y = v[i + 1] + p.fy, z = (v[i + 2] + -p.fz) * 12;
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15], cz = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
      if (cw > 0.05) { front++; if (cz > cw) clipped++; }
    }
    if (clipped) bad.push(`rd ${rd} pitch ${pitch} y ${camY}: ${clipped}/${front} cloud verts beyond the far plane`);
  }
  return bad;
}
const src = R('src/09d_clouds.js');
const use = (Cl, cam) => Cl.farViewProj(cam);
const real = verdict(src, use);
const BREAKS = [
  ['clouds use the fog-tight cam.viewProj', src, (Cl, cam) => cam.viewProj],
  ['far plane 200', src.replace('Cl.FAR = 1024', 'Cl.FAR = 200'), use],
  ['farViewProj removed', src.replace('Cl.farViewProj = function', 'Cl.farViewProjX = function'), use],
];
let caught = 0;
for (const [n, s, f] of BREAKS) { let b; try { b = verdict(s, f); } catch (e) { b = [String(e)]; } if (b.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real.slice(0, 10)) console.log(' FAIL:', x);
console.log(`cloudfarcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
