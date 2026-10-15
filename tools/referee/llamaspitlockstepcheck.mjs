// lockstep-llamaspit -- #6728: a llama spitting at a player 8 blocks away. Compares LlamaEntity.spitAt (spawn pos, aim dx/dy+0.2*horiz/dz, setVelocity power 1.5 + gaussian 0.0075*10),
// LlamaSpitEntity.tick flight (pos += v0, then v = v0*0.99 - 0.06), onEntityHit (mobProjectile, 1.0 damage) and the wall discard against an independent reference, over 20 salts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07z_potion.js', '07ze_llama.js', '07zw_mobnbt.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = M.World, CH = M.CH, S = M.States, EL = M.EntityList, Cb = M.Combat, Sv = M.Survival, Ll = M.Llama;
M.Behave.init(W); M.Entities.init(); EL.init(); M.Ai.init(); M.Spawn.init(); Cb.init(); W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
let fails = 0, breaks = 0, n = 0, landed = 0;
const ok = (c, m) => { n++; if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const dirt = S.stateOf('dirt');
const near = (a, b) => Math.abs(a - b) < 1e-6;
function refGauss(r) { let v1, v2, s; do { v1 = 2 * r() - 1; v2 = 2 * r() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0); const m = Math.sqrt(-2 * Math.log(s) / s); return [v1 * m, v2 * m]; }
function lane(salt, wall) {
  for (const e of EL.list.slice()) EL.remove(e); EL.list.length = 0;
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) { for (let y = 58; y <= 64; y++) W.setBlock(x, y, z, dirt); for (let y = 65; y <= 90; y++) W.setBlock(x, y, z, 0); }
  const r = stream(salt), ja = (k) => (r() - 0.5) * k;
  const ll = EL.spawn('llama', 0.5 + ja(1), 65, 0.5 + ja(1), {}); ll.noAi = true; ll.persistent = true; ll.yaw = ja(6);
  const P = { type: 'player', x: ll.x + ja(1), y: 65, z: ll.z + 8, width: 0.6, height: 1.8, eyeHeight: 1.62 };
  M.Player = P;
  const hits = []; const osv = Sv.hurt; Sv.hurt = function (e, t, amt) { hits.push([t, amt]); return true; };
  if (wall) for (let y = 65; y <= 70; y++) for (let x = -6; x <= 6; x++) W.setBlock(x, y, ll.z + 4, dirt);
  const seed = salt * 7 + 1, rs = stream(seed), rr = stream(seed);
  // independent reference
  const w = ll.width, h = ll.height, eye = Math.fround(h * 0.95);   // HorseBaseEntity.getActiveEyeHeight, float
  const sx = ll.x - (w + 1) * 0.5 * Math.sin(ll.yaw), sy = ll.y + eye - 0.1, sz = ll.z + (w + 1) * 0.5 * Math.cos(ll.yaw);
  const dx = P.x - ll.x, dz = P.z - ll.z, g = Math.sqrt(dx * dx + dz * dz) * 0.2, dy = (P.y + P.height / 3) - sy + g;
  const len = Math.hypot(dx, dy, dz), [g1, g2] = refGauss(rr), [g3] = refGauss(rr);
  let v = [(dx / len + g1 * 0.075) * 1.5, (dy / len + g2 * 0.075) * 1.5, (dz / len + g3 * 0.075) * 1.5];
  let p = [sx, sy, sz];
  const proj = Ll.spit(ll, P, rs);
  let bad = null;
  try {
    if (!proj) return 'no spit spawned';
    if (![sx, sy, sz].every((c, i) => near(c, [proj.x, proj.y, proj.z][i]))) bad = bad || `spawn pos ${proj.x},${proj.y},${proj.z} vs ${sx},${sy},${sz}`;
    if (![0, 1, 2].every((i) => near(v[i], [proj.vx, proj.vy, proj.vz][i]))) bad = bad || `spawn vel ${proj.vx},${proj.vy},${proj.vz} vs ${v}`;
    let sure = false, maybe = false;
    const inBox = (q, m) => Math.abs(q[0] - P.x) <= 0.3 + 0.3 + m && Math.abs(q[2] - P.z) <= 0.3 + 0.3 + m && q[1] >= P.y - 0.3 - m && q[1] <= P.y + 1.8 + 0.3 + m;   // box + 0.3 inflate + 0.125 spit half
    for (let t = 1; t <= 40 && !bad; t++) {
      EL.tick();
      const q0 = p;
      p = [p[0] + v[0], p[1] + v[1], p[2] + v[2]]; v = [v[0] * Math.fround(0.99), v[1] * Math.fround(0.99) - Math.fround(0.06), v[2] * Math.fround(0.99)];
      for (let k = 0; k <= 20; k++) { const q = q0.map((c, i) => c + (p[i] - c) * k / 20); if (inBox(q, -0.15)) sure = true; if (inBox(q, 0.15)) maybe = true; }
      if (hits.length || proj.removed) break;
      if (![proj.x, proj.y, proj.z].every((c, i) => near(c, p[i]))) bad = `tick ${t} pos ${proj.x},${proj.y},${proj.z} vs ${p}`;
    }
    if (wall) { if (!proj.removed || hits.length) bad = bad || 'wall: spit not discarded before reaching player'; }
    else if (!bad) {
      if (sure && hits.length !== 1) bad = `expected a hit, hits ${hits.length}`;
      else if (!maybe && hits.length) bad = 'unexpected hit';
      else if (hits.length && (hits[0][1] !== 1 || hits[0][0] !== 'mobProjectile')) bad = `hit ${hits[0]}`;
      if (!bad && hits.length) landed++;
    }
  } finally { Sv.hurt = osv; }
  return bad;
}
for (let s = 0; s < 20; s++) { const b = lane(s, false); ok(!b, `llamaspit salt ${s}: ${b}`); const c = lane(s, true); ok(!c, `llamaspit wall salt ${s}: ${c}`); }
ok(landed >= 5, `only ${landed}/20 spits landed on the player (vacuous)`);
const anyBad = (w) => { for (let s = 0; s < 20; s++) if (lane(s, w)) return true; return false; };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Ll.SPIT_POWER; Ll.SPIT_POWER = 1.6; brk(anyBad(false), 'power 1.5 -> 1.6'); Ll.SPIT_POWER = o; }
{ const o = Ll.SPIT_DAMAGE; Ll.SPIT_DAMAGE = 2; brk(anyBad(false), 'damage 1 -> 2'); Ll.SPIT_DAMAGE = o; }
{ const o = Ll.GRAVITY; Ll.GRAVITY = 0.05; brk(anyBad(false), 'gravity 0.06 -> 0.05'); Ll.GRAVITY = o; }
console.log(`lockstep-llamaspit: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
