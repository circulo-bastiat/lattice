// fireworklockstepcheck.mjs -- #6602 (G17-L77): lockstep scenario 'firework': rockets with 0-3 stars, Flight 1-3; 20 salts.
// Reference = .decomp FireworkRocketEntity: ctor (:46-57) lifeTime = 10*(1+Flight) + nextInt(6) + nextInt(7); tick (:107-166) v = (vx*1.15, vy, vz*1.15) + (0,0.04,0), move,
// life++, explodeAndRemove when life > lifeTime; explode (:215-250) damage 5+2*stars (0 stars: none), targets within 5 blocks take base*sqrt((5-d)/5).
// Per tick pos/vel go through lockstep/trace.mjs compareTraces; the cow's damage is compared at the explosion tick.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07f_redstone.js', '07h_entities.js',
  '07i_entitylist.js', '14b_physics.js', '14c_raycast.js', '14f_inventory.js', '14l_use.js', '14j_combat.js', '07za_explosion.js', '07zzy_firework.js', '07zv_villagerbrain.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = { getBlock: () => 0, setBlock: () => true, blockLightAt: () => 15, clear() {} };
M.World = W; M.Behave.init(W); M.BlockEntities.init(); M.Entities.init(); M.EntityList.init(); M.Use.init(W);
if (M.Explosion.init) M.Explosion.init();
M.Physics.shapeAt = () => null;
const EL = M.EntityList, Fw = M.Firework;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const tagOf = (n, flight) => ({ Fireworks: { Flight: flight, Explosions: Array.from({ length: n }, () => ({ Type: 0, Colors: [1] })) } });
const FL = { fields: ['pos', 'vel'] };
const salts = Array.from({ length: 20 }, (_, i) => i);

// vanilla reference: draws in the order of the engine's init (2 x 3 gaussian-ish draws, then the two nextInt), cow at distance 3 on x
function reference(salt, n, flight) {
  const r = stream(salt); const g = () => M.U.polarGaussian(r) * 0.001;   // #8281: Random.nextGaussian (entity random), not a 3-draw stand-in
  let vx = g(), vy = 0.05, vz = g();
  const lifeTime = 10 * (1 + flight) + Math.floor(r() * 6) + Math.floor(r() * 7);
  let x = 0, y = 10, z = 0, life = 0; const rows = [];
  for (let t = 1; ; t++) {
    vx *= 1.15; vz *= 1.15; vy += 0.04; x += vx; y += vy; z += vz;
    life++;
    rows.push({ tick: t, pos: [x, y, z], vel: [vx, vy, vz] });
    if (life > lifeTime) { const d = 3; const base = n ? 5 + 2 * n : 0;
      return { rows, lifeTime, explodeTick: t, dmg: base > 0 && d * d <= 25 ? base * Math.sqrt((5 - d) / 5) : 0 }; }
  }
}
function engine(salt, n, flight, R) {
  EL.init(); const r = stream(salt); EL.random = r; Math.random = r; M.wrand = r;
  const e = EL.spawn('firework_rocket', 0, 10, 0, { tag: tagOf(n, flight) }); e.x = 0; e.y = 10; e.z = 0;
  const rows = []; let explodeTick = -1, cow = null;
  const end = R.rows[R.rows.length - 1].pos;
  for (let t = 1; t <= 200; t++) {
    if (t === R.explodeTick) {   // the target stands 3 blocks from the burst point
      cow = EL.spawn('cow', end[0] + 3, end[1], end[2]); cow.persistent = true; cow.health = cow.maxHealth = 1000; cow.vx = cow.vy = cow.vz = 0;
    }
    EL.tickOne(e);
    rows.push({ tick: t, pos: [e.x, e.y, e.z], vel: [e.vx, e.vy, e.vz] });
    if (e.removed) { explodeTick = t; break; }
  }
  return { rows, lifeTime: e.lifeTime, explodeTick, dmg: cow ? 1000 - cow.health : 0 };
}
function lane(salt, n, flight) {
  const R = reference(salt, n, flight), E = engine(salt, n, flight, R);
  let d = compareTraces(R.rows, E.rows, FL);
  if (!d && R.rows.length !== E.rows.length) d = { tick: Math.min(R.rows.length, E.rows.length), field: 'length', a: R.rows.length, b: E.rows.length };
  if (!d && R.lifeTime !== E.lifeTime) d = { tick: 0, field: 'lifeTime', a: R.lifeTime, b: E.lifeTime };
  if (!d && Math.abs(R.dmg - E.dmg) > 1e-3) d = { tick: E.explodeTick, field: 'damage', a: R.dmg, b: E.dmg };
  return { d, R, E };
}
const sample = Math.random;
let n_ok = 0;
for (let flight = 1; flight <= 3; flight++) for (let n = 0; n <= 3; n++) {
  const res = salts.map((s) => ({ s, ...lane(s, n, flight) })).filter((r) => r.d);
  ok(!res.length, `Flight ${flight}, ${n} stars: ` + res.slice(0, 2).map((r) => `salt ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
  n_ok++;
}
const r3 = reference(0, 3, 1);
ok(r3.dmg > 0 && r3.dmg <= 11, 'reference 3 stars deals damage 5+6 scaled by falloff: ' + r3.dmg);
ok(reference(0, 0, 1).dmg === 0, 'reference: no stars, no damage');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const ol = Fw.lifeFor; Fw.lifeFor = (f, rnd) => ol(f, rnd) + 1;
const b1 = lane(0, 2, 2); brk(b1.d && /length|lifeTime/.test(b1.d.field), `lifetime roll off by one reported (${b1.d && b1.d.field})`); Fw.lifeFor = ol;
const oe = Fw.explosionCount; Fw.explosionCount = (e) => { const c = oe(e); return c ? c + 1 : 0; };
const b2 = lane(0, 2, 2); brk(b2.d && b2.d.field === 'damage', `wrong star damage reported (${b2.d && b2.d.field})`); Fw.explosionCount = oe;
console.log(`fireworklockstepcheck: ${n_ok * 20 + 2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
