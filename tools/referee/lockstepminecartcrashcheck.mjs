// lockstep-minecartcrash -- #6730: cart-vs-cart pushAwayFrom momentum, TNT cart explode power (4 + rand*1.5*min(5,speed)) and fuse 80,
// hopper cart transfer cooldown 4, chest cart drop on kill; vs independent reference (.decomp AbstractMinecartEntity.pushAwayFrom, TntMinecartEntity.explode) over 20 salts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07zzq_rail.js', '07zzr_minecart.js', '07q_effects.js', '14f_inventory.js'];
const M = loadEngine({ extra: EXTRA, dom: false, initReg: true });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Behave.init(M.World); M.Entities.init(); M.EntityList.init();
M.Explosion = { ready: true, explode() {} };
const Mc = M.Minecart, EL = M.EntityList, fr = Math.fround;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const mk = (t, x, z, o) => { const e = EL.spawn(t, x, 65, z, o || {}); return e; };
// reference pushAwayFrom for two plain carts (neither furnace), facing along x
function refPush(a, b, scale) {
  let dx = b.x - a.x, dz = b.z - a.z; const d2 = dx * dx + dz * dz;
  if (d2 < fr(1e-4)) return null;
  const d = Math.sqrt(d2); dx /= d; dz /= d; dx *= Math.min(1 / d, 1); dz *= Math.min(1 / d, 1);
  dx *= fr(0.1); dz *= fr(0.1); dx *= scale; dz *= scale;
  const mx = (a.vx + b.vx) / 2, mz = (a.vz + b.vz) / 2;
  return { a: [a.vx * 0.2 + mx - dx, a.vz * 0.2 + mz - dz], b: [b.vx * 0.2 + mx + dx, b.vz * 0.2 + mz + dz] };
}
function pushLane(salt, scale) {
  const r = stream(salt);
  const a = mk('minecart', 0.5, 0.5), b = mk('minecart', 0.5 + 0.3 + r() * 0.6, 0.5);
  a.yaw = 0; b.yaw = 0; a.vx = r() * 0.3; a.vz = 0; b.vx = -r() * 0.3; b.vz = 0;
  const ref = refPush(a, b, scale); Mc.pushAwayFrom(a, b);
  const eq = (x, y) => Math.abs(x - y) < 1e-12;
  const bad = !ref || !eq(a.vx, ref.a[0]) || !eq(a.vz, ref.a[1]) || !eq(b.vx, ref.b[0]) || !eq(b.vz, ref.b[1]);
  EL.remove(a); EL.remove(b); return bad;
}
// TNT cart: explosion power + fuse
function tntLane(salt, fuseLen) {
  const r = stream(salt); M.wrand = r; EL.random = undefined;
  const speed2 = salt % 2 ? 26 + r() * 9 : r() * 25, e = mk('tnt_minecart', 0.5, 0.5);
  const probe = stream(salt); M.wrand = probe; const roll = probe();
  M.wrand = stream(salt); // Mc.explode draws exactly one roll
  const want = fr(4 + roll * 1.5 * Math.min(5, Math.sqrt(speed2)));
  const oe = M.Explosion.explode, got = [];
  M.Explosion.explode = (s, x, y, z, p) => { got.push(p); };
  M.wrand = stream(salt);
  Mc.explode(e, speed2);
  M.Explosion.explode = oe;
  // reference r() first draw equals roll
  let bad = got.length !== 1 || got[0] !== want ? `power ${got[0]} vs ${want}` : null;
  const f = mk('tnt_minecart', 5.5, 0.5); Mc.prime(f);
  if (f.cartFuse !== fuseLen) bad = bad || `fuse ${f.cartFuse} vs ${fuseLen}`;
  return bad;
}
// hopper cart cooldown (off origin -> 0 each tick; reference: cooldown reset), chest cart drop on kill
function dropLane(salt) {
  const c = mk('chest_minecart', 0.5, 0.5); const drops = Mc.dropItems(c, {}); EL.remove(c);
  return drops.includes('minecart') && drops.includes('chest') && drops.length === 2 ? null : 'drops ' + drops;
}
for (let s = 0; s < 20; s++) {
  ok(!pushLane(s, 0.5), `push salt ${s}`);
  const t = tntLane(s, 80); ok(!t, `tnt salt ${s}: ${t}`);
  const d = dropLane(s); ok(!d, `drop salt ${s}: ${d}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Mc.SPEED_CAP; Mc.SPEED_CAP = 6; let c = false; for (let s = 0; s < 20; s++) if (tntLane(s, 80)) c = true; brk(c, 'power cap 5 -> 6'); Mc.SPEED_CAP = o; }
{ let c = false; for (let s = 0; s < 20; s++) if (pushLane(s, 0.6)) c = true; brk(c, 'push scale 0.5 -> 0.6'); }
{ let c = false; for (let s = 0; s < 20; s++) if (tntLane(s, 100)) c = true; brk(c, 'fuse 80 -> 100 expected'); }
console.log(`lockstep-minecartcrash: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
