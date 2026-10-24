// lockstep-dragonbreath -- #6729: dragon_fireball flight -> impact -> 600-tick dragon-breath area_effect_cloud (radius 3 growing to 7 by (7-3)/600 per tick, wait 20, reapply 20, Instant Damage amp 1 = 6 at flat 0.5), player health trace, vs an independent reference over 20 salts.
// Reference = .decomp DragonFireballEntity.onCollision (setRadius 3, setDuration 600, setRadiusGrowth (7-r)/duration, Instant Damage amp 1) + AreaEffectCloudEntity.tick/StatusEffect.applyInstantEffect (floor(0.5*(6<<1)+0.5) = 6).
// Note: the brief's "shrink -0.0075 / wait 10" is the LINGERING POTION path; the dragon fireball cloud GROWS and keeps the default wait 20.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07za_explosion.js', '07zzh_blaze.js', '07q_effects.js', '07z_potion.js', '07zzl_enderdragon.js', '07zw_mobnbt.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = M.World, CH = M.CH, S = M.States, EL = M.EntityList, Cb = M.Combat, Sv = M.Survival, ED = M.EnderDragon, Po = M.Potion;
M.Behave.init(W); M.Entities.init(); EL.init(); M.Ai.init(); M.Spawn.init(); Cb.init(); ED.init(); W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const fr = Math.fround, dirt = S.stateOf('dirt');
Po.cloudDry = true;
function lane(salt, R0) {
  for (const e of EL.list.slice()) EL.remove(e); EL.list.length = 0;
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) { for (let y = 58; y <= 64; y++) W.setBlock(x, y, z, dirt); for (let y = 65; y <= 90; y++) W.setBlock(x, y, z, 0); }
  const r = stream(salt); M.wrand = r;
  const ox = (r() - 0.5) * 2, oz = (r() - 0.5) * 2;
  const P = { type: 'player', x: 0.5 + ox, y: 65, z: 0.5 + oz, width: 0.6, height: 1.8, eyeHeight: 1.62, maxHealth: 20, health: 20, food: 20 };
  M.Player = P;
  const trace = []; let tk = 0; const osv = Sv.hurt;
  Sv.hurt = function (e, t, amt) { if (e === P) trace.push([tk, amt]); return false; };
  const dragon = { type: 'ender_dragon', x: 0.5, y: 80, z: 0.5, maxHealth: 200, health: 200, width: 16, height: 8 };
  const fb = EL.spawn('dragon_fireball', 0.5 + ox, 75, 0.5 + oz, { power: [0, -1, 0], shooter: dragon });
  const st = { spawn: null, impact: null, cloud: null, radii: [] };
  try {
    for (tk = 1; tk <= 760; tk++) {
      EL.tick();
      const cl = EL.list.find((e) => e.type === 'area_effect_cloud');
      if (cl && !st.cloud) { st.cloud = cl; st.impact = tk; }
      if (cl) st.radii.push(cl.radius);
    }
  } finally { Sv.hurt = osv; }
  return { st, trace, fb, P };
}
function check(salt, opt) {
  const { st, trace, fb } = lane(salt);
  const bad = [];
  if (!st.cloud) return ['no cloud'];
  if (!fb.removed) bad.push('fireball not discarded');
  const c = st.cloud;
  if (c.duration !== 600) bad.push('duration ' + c.duration);
  if (c.waitTime !== 20) bad.push('wait ' + c.waitTime);
  if (c.reapplicationDelay !== 20) bad.push('reapply ' + c.reapplicationDelay);
  // independent radius reference: float accumulation after the wait
  let rad = fr(3.0); const g = fr(fr(fr(7.0) - rad) / fr(600)); const want = [];
  for (let i = 0; i < st.radii.length; i++) { if (i + 1 > 20) rad = fr(rad + g); want.push(rad); }
  const first = st.radii[0];
  if (Math.abs(st.radii[0] - 3.0) > 1e-6) bad.push('start radius ' + first);
  for (let i = 0; i < Math.min(st.radii.length, 560); i++) if (Math.abs(st.radii[i] - want[i]) > 1e-5 && Math.abs(st.radii[i] - want[i + 1] || 1) > 1e-5 && Math.abs(st.radii[i] - (want[i - 1] ?? 3)) > 1e-5) { bad.push(`radius tick ${i} ${st.radii[i]} vs ${want[i]}`); break; }
  if (!trace.length) bad.push('player never hurt');
  for (const [, a] of trace) if (a !== 6) { bad.push('damage ' + a); break; }
  for (let i = 1; i < trace.length; i++) if (trace[i][0] - trace[i - 1][0] !== 20) { bad.push('reapply spacing ' + (trace[i][0] - trace[i - 1][0])); break; }
  // lifetime: waiting 20 + 600 duration -> hits at 20-tick spacing while alive
  const life = 620, hits = Math.floor((life - 20) / 20) + 1;
  if (Math.abs(trace.length - hits) > 1) bad.push(`hits ${trace.length} vs ~${hits}`);
  if (trace.length && trace[0][0] - st.impact < 19) bad.push('hit before wait elapsed');
  return bad;
}
for (let s = 0; s < 20; s++) { const b = check(s); ok(!b.length, `dragonbreath salt ${s}: ${b.join('; ')}`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = ED.tickDragonFireball; ED.tickDragonFireball = function (e) { const L = EL.list.length; o(e); const c = EL.list.find((x) => x.type === 'area_effect_cloud'); if (c && !c.__m) { c.__m = 1; c.radius = 3.5; } };
  brk(check(3).length > 0, 'radius 3 -> 3.5'); ED.tickDragonFireball = o; }
{ const o = ED.tickDragonFireball; ED.tickDragonFireball = function (e) { o(e); const c = EL.list.find((x) => x.type === 'area_effect_cloud'); if (c && !c.__m) { c.__m = 1; c.reapplicationDelay = 10; } };
  brk(check(4).length > 0, 'reapplication 20 -> 10'); ED.tickDragonFireball = o; }
{ const o = ED.tickDragonFireball; ED.tickDragonFireball = function (e) { o(e); const c = EL.list.find((x) => x.type === 'area_effect_cloud'); if (c && !c.__m) { c.__m = 1; c.custom = [{ effect: 'instant_damage', duration: 1, amplifier: 0 }]; } };
  brk(check(5).length > 0, 'amplifier 1 -> 0 (3 damage)'); ED.tickDragonFireball = o; }
console.log(`lockstep-dragonbreath: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
