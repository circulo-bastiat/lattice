// xpbottlelockstepcheck.mjs -- #6727 (G17-L130): lockstep scenario 'xpbottle': thrown experience bottle at the floor and at a wall, 20 salts.
// Reference = .decomp ExperienceBottleEntity (getGravity 0.07F; onCollision: event 2002 colour PotionUtil.getColor(WATER)=3694022, 3 + nextInt(5) + nextInt(5) xp,
// ExperienceOrbEntity.spawn splitting by roundToOrbSize) and ThrownEntity.tick (pos += v; v *= 0.99; vy -= (double)0.07F), written out independently.
// Per tick: x y z vx vy vz of the bottle, impact tick, xp roll, orb sizes, event handoff.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07y_equip.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07q_effects.js', '14j_combat.js', '07zz_xporb.js', '07zzd_throw.js'], dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.World = Object.assign(M.World || {}, { get: () => 0, getBlock: () => 0, getLight: () => 0, tickingAt: () => true, setBlock: () => {} });
M.Physics.shapeAt = () => null; M.Physics.solidAt = () => false;
M.EntityList.init();
const { EntityList: EL, Throw: Th, Xp } = M;
if (Xp.init && !Xp.ready) Xp.init();
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const G = Math.fround(0.07), SPEED = 0.7, PITCH_OFF = -20;
const ORB = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
const split = (v) => { const o = []; while (v > 0) { const a = ORB.find((s) => v >= s); o.push(a); v -= a; } return o; };
// vanilla ThrownEntity.setVelocity: pitch -20 offset on y, speed 0.7, divergence 0 here (the roll is not under test)
function launch(pitchDeg, yawDeg) {
  const r = Math.PI / 180, p = pitchDeg * r, y = yawDeg * r, po = (pitchDeg + PITCH_OFF) * r;
  return [-Math.sin(y) * Math.cos(p) * SPEED, -Math.sin(po) * SPEED, Math.cos(y) * Math.cos(p) * SPEED];
}
function refFlight(p, ticks) {   // [x,y,z,vx,vy,vz] per tick; wall at x >= wallX, floor at y <= 0
  let [vx, vy, vz] = p.v, x = 0, y = p.h, z = 0, rows = [[x, y, z, vx, vy, vz]], hit = -1;
  for (let t = 1; t <= ticks && hit < 0; t++) {
    x += vx; y += vy; z += vz; vx *= 0.99; vy *= 0.99; vz *= 0.99; vy -= G;
    if (y <= 0 || (p.wall !== null && x >= p.wall)) hit = t;
    rows.push([x, y, z, vx, vy, vz]);
  }
  return { rows, hit };
}
let GRAV = 0.07;   // fault knob: the engine side only
function engineFlight(p, A) {
  EL.list.length = 0;
  const b = EL.spawn('experience_bottle', 0, p.h, 0); b.vx = p.v[0]; b.vy = p.v[1]; b.vz = p.v[2];
  const rows = [[b.x, b.y, b.z, b.vx, b.vy, b.vz]];
  for (let t = 1; t <= A.hit; t++) { EL.tickOne(b); rows.push([b.x, b.y, b.z, b.vx, b.vy, b.vz]); }
  return { b, rows };
}
const run = (kind, salt) => {
  const r = stream(salt * 11 + (kind === 'wall' ? 1 : 0));
  const p = { h: 1.5 + r() * 0.5, v: launch(-10 + r() * 50 - (kind === 'wall' ? 0 : 0), r() * 20 - 10), wall: kind === 'wall' ? 2 + r() * 2 : null };
  if (kind === 'wall') p.v = launch(-5 + r() * 10, r() * 6 - 3);
  const A = refFlight(p, 80);
  const d = { };
  if (A.hit < 0) return { d: { what: 'no impact' } };
  const E = engineFlight(p, A);
  for (let t = 0; t <= A.hit; t++) for (let k = 0; k < 6; k++) if (Math.abs(A.rows[t][k] - E.rows[t][k]) > 1e-9) return { d: { what: `tick ${t} field ${k}` } };
  // impact: server rolls 3 + nextInt(5) + nextInt(5) from the same stream the engine is given
  const q = stream(salt * 13 + 5), ra = q, rb = q;
  const a = Math.floor(ra() * 5), b2 = Math.floor(rb() * 5), xp = 3 + a + b2;
  const q2 = stream(salt * 13 + 5); EL.random = q2;
  const b = E.b; b.onGround = true; b.x = A.rows[A.hit][0]; b.y = A.rows[A.hit][1]; b.z = A.rows[A.hit][2];
  const before = EL.list.filter((e) => e.type === 'experience_orb').length;
  Th.lastBottleEvent = null;
  Th.tickBottle(b);
  const orbs = EL.list.filter((e) => e.type === 'experience_orb' && !e.removed).map((e) => e.value).sort((x, y) => y - x);
  const want = split(xp);
  const mergedWant = want.length;
  if (!b.removed) return { d: { what: 'bottle not discarded' } };
  const total = orbs.reduce((s, v) => s + v, 0);
  if (total !== xp && !(orbs.length < mergedWant)) return { d: { what: `xp ${total} != ${xp}` } };
  if (JSON.stringify(orbs) !== JSON.stringify(want.slice().sort((x, y) => y - x))) return { d: { what: `orbs ${orbs} != ${want}` } };
  const ev = Th.lastBottleEvent, ex = [Math.floor(A.rows[A.hit][0]), Math.floor(A.rows[A.hit][1]), Math.floor(A.rows[A.hit][2])];
  if (!ev || ev.id !== 2002 || ev.color !== 3694022 || ev.x !== ex[0] || ev.y !== ex[1] || ev.z !== ex[2]) return { d: { what: 'event ' + JSON.stringify(ev) } };
  return { d: null, xp, hit: A.hit };
};
const salts = Array.from({ length: 20 }, (_, i) => i);
const sweep = () => { const out = []; for (const k of ['floor', 'wall']) for (const s of salts) { const r = run(k, s); if (r.d) out.push(`${k} salt ${s}: ${r.d.what}`); else out.push(null); } return out.filter(Boolean); };
const res = sweep();
ok(!res.length, 'xpbottle 20 salts x floor/wall: ' + res.slice(0, 3));
const seen = new Set(); for (const s of salts) { const r = run('floor', s); if (r.xp) seen.add(r.xp); }
ok(seen.size >= 4, 'xp rolls vary (not vacuous): ' + [...seen]);
ok(Th.ITEMS.experience_bottle.speed === 0.7 && Th.ITEMS.experience_bottle.pitchOffset === -20, 'throw speed 0.7, pitch offset -20');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Th.tickBottle; Th.tickBottle = (e) => { const r = EL.random; EL.random = () => 0.99; o(e); EL.random = r; }; brk(sweep().length > 0, 'xp roll altered reported'); Th.tickBottle = o; }
{ const o = Xp.roundToOrbSize; Xp.roundToOrbSize = (v) => (v >= 7 ? 3 : o(v)); brk(sweep().length > 0, 'orb split altered reported'); Xp.roundToOrbSize = o; }
{ const o = EL.tickOne; EL.tickOne = (e) => { o(e); if (e.type === 'experience_bottle') e.vy -= 0.01; }; brk(sweep().length > 0, 'engine gravity 0.07 -> 0.08 reported'); EL.tickOne = o; }
{ const sp = Th.lastBottleEvent; const o = Th.tickBottle; Th.tickBottle = (e) => { o(e); if (Th.lastBottleEvent) Th.lastBottleEvent.color = 0x2E5CAD; }; brk(sweep().length > 0, 'event colour altered reported'); Th.tickBottle = o; }
console.log(`xpbottlelockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
