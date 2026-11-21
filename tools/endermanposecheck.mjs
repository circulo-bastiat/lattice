#!/usr/bin/env node
// endermanposecheck.mjs -- #1767: EndermanEntityModel.setAngles arm/leg half+clamp 0.4 (carrying/angry are #1749's).
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zx_particle.js', '07zg_enderman.js', '07j_entityrender.js'], dom: false });
initRegistry(M);
const ER = M.EntityRender;
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const base = (p, ls, la) => ER.setupAnimDelta(p, ls, la, 0, 0, false, 'biped', { rest: {} });
const run = (fn, tag) => {
  const E = (c, a) => ({ carrying: c, angry: a });
  for (const p of ['right_arm', 'left_arm', 'right_leg', 'left_leg']) {
    const big = fn(p, 0, 1, E(false, false)), b = base(p, 0, 1);
    ok(near(big.rx, Math.max(-0.4, Math.min(0.4, b.rx * 0.5))), tag + p + ' clamped at full swing');
    ok(Math.abs(big.rx) <= 0.4 + 1e-9, tag + p + ' within 0.4');
  }
  const b = base('right_leg', 0.3, 0.1), s = fn('right_leg', 0.3, 0.1, E(false, false));
  ok(Math.abs(b.rx) > 0 && near(s.rx, b.rx * 0.5), tag + 'small swing halved');
  const c = fn('right_arm', 0, 1, E(true, false)), l = fn('left_arm', 0, 1, E(true, false));
  ok(near(c.rx, -0.5) && near(c.rz, 0.05) && near(l.rz, -0.05), tag + 'carrying arms');
  ok(near(fn('head', 0, 0, E(false, true)).dpy, -5) && near(fn('hat', 0, 0, E(false, true)).dpy, -5), tag + 'angry head+hat -5');
  ok(!fn('head', 0, 0, E(false, false)).dpy, tag + 'calm head not lifted');
};
const real = (p, ls, la, e) => ER.setupAnimDelta(p, ls, la, 0, 0, false, 'biped', { enderman: e, rest: {} });
run(real, '');
for (const [name, brk] of [
  ['no clamp', (p, ls, la, e) => { const o = { ...real(p, ls, la, e) }; if (/arm|leg/.test(p) && !e.carrying) o.rx = base(p, ls, la).rx * 0.5; return o; }],
  ['no half', (p, ls, la, e) => { const o = { ...real(p, ls, la, e) }; if (/arm|leg/.test(p) && !e.carrying) o.rx = Math.max(-0.4, Math.min(0.4, base(p, ls, la).rx)); return o; }],
  ['no carrying', (p, ls, la, e) => real(p, ls, la, { carrying: false, angry: e.angry })],
  ['no angry', (p, ls, la, e) => real(p, ls, la, { carrying: e.carrying, angry: false })]]) {
  const before = fails.length; run(brk, '[' + name + '] ');
  if (fails.length > before) breaks++; fails.length = before;
}
M.Particle.init && M.Particle.init();
ok(M.Enderman.portalParticles({ x: 0, y: 0, z: 0 }) === 2, 'portalParticles emits 2');
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length || breaks < 4 ? 1 : 0);
