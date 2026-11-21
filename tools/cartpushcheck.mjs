#!/usr/bin/env node
// cartpushcheck.mjs -- #5145: LivingEntity.tickCramming -> pushAway -> AbstractMinecartEntity.pushAwayFrom(this = cart, other = living).
// Expected delta: unit(dx,dz) * min(1/d,1) * fround(0.1) * 0.5; the cart gets -delta, the pusher +delta/4. Anti-vacuity: break the hooks.
import { loadEngine } from './loadsrc.mjs';

console.log('cartpushcheck -- #5145, living entities and the player push a minecart');
const K = Math.fround(0.1) * 0.5;

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zzr_minecart.js'], initReg: false, patch });
  const EL = M.EntityList, Ph = M.Physics; Ph.onClimbable = () => false;
  EL.list = [];
  const cart = () => ({ type: 'minecart', x: 0, y: 64, z: 0, vx: 0, vy: 0, vz: 0, width: 0.98, height: 0.7, removed: false });
  const mob = (x, z) => ({ type: 'zombie', x, y: 64, z, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.95, maxHealth: 20, removed: false });

  // zombie at +0.5 x: d=0.5, k=min(2,1)=1 -> delta 0.05 along +x
  let c = cart(), z = mob(0.5, 0); EL.list = [c, z]; EL.pushPlayer = () => null;
  EL.pushAround(z);
  ok(near(c.vx, -K) && near(c.vz, 0), 'cart gets -0.05 on x, got ' + c.vx);
  ok(near(z.vx, K / 4), 'zombie gets +delta/4, got ' + z.vx);

  // diagonal at distance sqrt(0.18)=0.4243: unit*1
  c = cart(); z = mob(0.3, 0.3); EL.list = [c, z]; EL.pushAround(z);
  ok(near(c.vx, -K * Math.SQRT1_2) && near(c.vz, -K * Math.SQRT1_2), 'diagonal delta');

  // the player pushes too
  c = cart(); const P = mob(0, -0.5); P.type = 'player'; EL.list = [c]; EL.pushPlayer = () => P;
  EL.pushAround(P);
  ok(near(c.vz, K) && near(P.vz, -K / 4), 'player pushes the cart along -z');

  // riding: no push
  c = cart(); z = mob(0.5, 0); z.vehicle = c; EL.list = [c, z]; EL.pushPlayer = () => null; EL.pushAround(z);
  ok(c.vx === 0 && z.vx === 0, 'a rider does not push its own cart');

  // noClip: no push
  c = cart(); z = mob(0.5, 0); z.noclip = true; EL.list = [c, z]; EL.pushAround(z);
  ok(c.vx === 0, 'noClip does not push');

  // spectator player: not pushed/pushing
  c = cart(); const S = mob(0.5, 0); S.type = 'player'; S.spectator = true; EL.list = [c]; EL.pushPlayer = () => S; EL.pushAround(mob(5, 5));
  ok(c.vx === 0, 'spectator does not push');

  // not overlapping: nothing
  c = cart(); z = mob(3, 0); EL.list = [c, z]; EL.pushPlayer = () => null; EL.pushAround(z);
  ok(c.vx === 0, 'no overlap, no push');
  return { fails, n };
}

const real = scenarios();
const fails = real.fails.slice(); let breaks = 0;
const breaksList = [
  ['cart filter restored', '(o.maxHealth === undefined && !isCart)', '(o.maxHealth === undefined)', '07i_entitylist.js'],
  ['cart branch dropped', 'if (NS.Minecart && NS.Minecart.isCart(q.type)) {', 'if (false) {', '07i_entitylist.js'],
  ['wrong scale', 'dx *= Math.fround(0.1); dz *= Math.fround(0.1);', 'dx *= 0.2; dz *= 0.2;', '07zzr_minecart.js'],
];
for (const [label, a, b, file] of breaksList) {
  let matched = true;
  const patch = (f, src) => { if (f !== file) return src; if (!src.includes(a)) matched = false; return src.split(a).join(b); };
  let r;
  try { r = scenarios(patch); } catch (err) { r = { fails: ['threw: ' + err.message] }; }
  if (!matched) { fails.push('anti-vacuity: edit for "' + label + '" matched nothing'); continue; }
  if (r.fails.length > 0) { breaks++; console.log('   ✓ break caught: ' + label); }
  else fails.push('anti-vacuity: breaking "' + label + '" went unnoticed');
}
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`cartpushcheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
