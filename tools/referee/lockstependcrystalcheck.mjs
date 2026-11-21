// lockstep-endcrystal -- #6717: end crystal hit (EndCrystalEntity.damage): discard, power-6 DESTROY explosion without fire, explosive-source second crystal discarded with NO second blast, damage falloff, block set, dragon-attacker immunity; vs independent reference over 20 salts.
// Reference = .decomp EndCrystalEntity.damage (isInvulnerableTo, dragon attacker -> false, remove, !isExplosive -> createExplosion(null,x,y,z,6.0F,DESTROY) = no fire) and Explosion.collectBlocksAndDamageEntities
// (16^3 shell rays, power*(0.7+r*0.6), 0.3 steps, (res+0.3)*0.3, damage floor((s*s+s)/2*7*diameter+1), s=(1-d/diameter)*exposure, eyeY used for the knock vector only).
// Note: in 1.18.2 an explosion that kills the neighbour crystal is explosive, so the neighbour does NOT explode (no chain reaction); the brief's "next tick explosion" is not what the jar does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07za_explosion.js', '07zzl_enderdragon.js', '07zzn_endcrystal.js', '07zw_mobnbt.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = M.World, CH = M.CH, S = M.States, EL = M.EntityList, Ex = M.Explosion, EC = M.EndCrystal, Cb = M.Combat, Sv = M.Survival;
M.Behave.init(W); M.Entities.init(); EL.init(); M.Ai.init(); M.Spawn.init(); Cb.init(); Ex.init(); M.EnderDragon.init(); EC.init(); W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const fr = Math.fround, dirt = S.stateOf('dirt'), bedrock = S.stateOf('bedrock'), RES = new Map([[dirt, 0.5], [bedrock, 3600000]]);
const resOf = (id) => (id === 0 ? null : RES.get(id));
// independent block collection
function refBlocks(cx, cy, cz, power, rnd) {
  const out = new Set();
  for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (let c = 0; c < 16; c++) {
    if (a && a < 15 && b && b < 15 && c && c < 15) continue;
    let dx = fr(fr(a / 15 * 2) - 1), dy = fr(fr(b / 15 * 2) - 1), dz = fr(fr(c / 15 * 2) - 1);
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= l; dy /= l; dz /= l;
    let rem = fr(power * fr(0.7 + fr(rnd() * 0.6))), px = cx, py = cy, pz = cz;
    while (rem > 0) {
      const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz), r = resOf(W.getBlock(x, y, z));
      if (r !== null) rem = fr(rem - fr((r + 0.3) * 0.3));
      if (rem > 0) out.add(x + ',' + y + ',' + z);
      px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3; rem = fr(rem - 0.22500001);
    }
  }
  return out;
}
const refDmg = (d, power) => { const dia = power * 2, s = 1 - d / dia; return s > 0 ? Math.floor((s * s + s) / 2 * 7 * dia + 1) : 0; };
function lane(salt, power, attacker) {
  for (const e of EL.list.slice()) EL.remove(e); EL.list.length = 0;
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) { for (let y = 58; y <= 64; y++) W.setBlock(x, y, z, dirt); for (let y = 65; y <= 80; y++) W.setBlock(x, y, z, 0); }
  W.setBlock(0, 64, 0, bedrock); W.setBlock(3, 64, 0, bedrock);
  const r = stream(salt); M.wrand = r;
  const ja = (k) => (r() - 0.5) * k;
  const a = EL.spawn('end_crystal', 0.5, 65, 0.5, {}), b = EL.spawn('end_crystal', 3.5, 65, 0.5, {});
  const cows = [4, 8, 12].map((d) => { const c = EL.spawn('cow', 0.5 + ja(0.2), 65, 0.5 + d, {}); c.noAi = true; c.persistent = true; return c; });
  const cowDist = cows.map((c) => Math.hypot(c.x - 0.5, 0, c.z - 0.5));
  const P = { type: 'player', x: -4.5 + ja(1), y: 65, z: 0.5 + ja(1), width: 0.6, height: 1.8, eyeHeight: 1.62 };
  M.Player = P; const pd = Math.hypot(P.x - 0.5, 0, P.z - 0.5);
  const hurt = new Map(); const oh = Cb.hurt, osv = Sv.hurt;
  Cb.hurt = function (e, amt) { hurt.set(e, amt); return true; }; Sv.hurt = function (e, t, amt) { hurt.set(e, amt); return false; };
  let blasts = [], calls = 0; const oe = Ex.explode;
  Ex.explode = function (src, x, y, z, p, ...rest) { blasts.push([x, y, z, p, rest[4], rest[5]]); return oe.call(this, src, x, y, z, p, ...rest); };
  const expect = new Set(); let refSet = null;
  if (!attacker) refSet = refBlocks(0.5, 65, 0.5, power, stream(salt));
  const before = new Set(); for (let x = -8; x <= 9; x++) for (let y = 56; y <= 72; y++) for (let z = -8; z <= 9; z++) if (W.getBlock(x, y, z)) before.add(x + ',' + y + ',' + z);
  let landed;
  try { landed = EC.damage(a, attacker ? { attacker } : {}); } finally { Ex.explode = oe; Cb.hurt = oh; Sv.hurt = osv; }
  let bad = null;
  if (attacker) {
    if (landed || a.removed || blasts.length) bad = 'dragon attacker not refused';
    return bad;
  }
  if (landed !== true || !a.removed) bad = 'crystal not discarded';
  if (!b.removed) bad = bad || 'neighbour crystal survived';
  if (blasts.length !== 1) bad = bad || 'blasts ' + blasts.length + ' (explosive neighbour must not re-explode)';
  else if (blasts[0][3] !== power) bad = bad || 'power ' + blasts[0][3] + ' vs ' + power;
  if (blasts[0] && blasts[0][5]) bad = bad || 'fire flag set';
  const gone = new Set(); for (const k of before) { const [x, y, z] = k.split(',').map(Number); if (!W.getBlock(x, y, z)) gone.add(k); }
  const wantGone = new Set([...refSet].filter((k) => before.has(k) && !k.startsWith('0,64,0') && !k.startsWith('3,64,0') && !(W.getBlock(...k.split(',').map(Number)) === bedrock)));
  for (const k of refSet) { const [x, y, z] = k.split(',').map(Number); if (W.getBlock(x, y, z) === bedrock) wantGone.delete(k); }
  const same = gone.size === wantGone.size && [...gone].every((k) => wantGone.has(k));
  if (!same) bad = bad || `block set ${gone.size} vs ref ${wantGone.size}`;
  for (let i = 0; i < 3; i++) { const want = refDmg(cowDist[i], power), got = hurt.get(cows[i]) || 0; if (want !== got) bad = bad || `cow ${[4, 8, 12][i]}m dmg ${got} vs ${want}`; }
  const wantP = refDmg(pd, power); if ((hurt.get(P) || 0) !== wantP) bad = bad || `player dmg ${hurt.get(P)} vs ${wantP}`;
  for (let x = -8; x <= 9; x++) for (let y = 56; y <= 72; y++) for (let z = -8; z <= 9; z++) if (W.getBlock(x, y, z) && !before.has(x + ',' + y + ',' + z)) bad = bad || 'block appeared (fire?) at ' + x + ',' + y + ',' + z;
  return bad;
}
for (let s = 0; s < 20; s++) {
  const bad = lane(s, 6, null); ok(!bad, `endcrystal salt ${s}: ${bad}`);
  const dr = lane(s, 6, { type: 'ender_dragon' }); ok(!dr, `endcrystal salt ${s} dragon: ${dr}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = EC.EXPLOSION_POWER; EC.EXPLOSION_POWER = 5; brk(!!lane(3, 6, null), 'power 6 -> 5'); EC.EXPLOSION_POWER = o; }
{ const o = EC.damage; EC.damage = function (e, s) { return o.call(this, e, Object.assign({}, s, { attacker: undefined })); };
  brk(!!lane(2, 6, { type: 'ender_dragon' }), 'dragon immunity removed'); EC.damage = o; }
{ const o = Ex.explode; Ex.explode = function (s, x, y, z, p, g, r, d, h, f, ...rest) { return o.call(this, s, x, y, z, p, g, r, d, h, true, ...rest); };
  brk(!!lane(5, 6, null), 'fire flag forced on'); Ex.explode = o; }
console.log(`lockstep-endcrystal: ${40 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
