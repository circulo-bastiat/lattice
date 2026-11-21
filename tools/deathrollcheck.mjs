import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07k_goals.js',
  '07zv_villagerbrain.js',
  // loop/vsleep -- section 8's own renderer/bed-occupied/death-release assertions need the
  // real posed-mob pipeline (`ER.emitMobLayer`/`ER.build`, 07j_entityrender.js), the SAME
  // module set `mobboxcheck.mjs` loads it with (`10_gfx.js`/`15h_bemodel.js`), not a stand-in.
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;
{
  const mm = rdj('models.meta.json');
  M.BEModel.init({ models: b64('models.bin'), modelsBytes: mm.rawBytes });
}
M.EntityRender.init();

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States, Tags = M.Tags;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, Village = M.Village, EL = M.EntityList, ER = M.EntityRender;

ok(VB, 'NS.VB did not load');
if (!VB) { console.log('\nFAIL sleepcheck — module missing'); process.exit(1); }
ok(ER && ER.ready, 'NS.EntityRender did not load (section 8 needs it)');

M.EntityRender.init();

ok(ER && ER.ready, 'NS.EntityRender did not load');
const mk = (type, dt) => ({ type, deathTime: dt, yaw: 0.7, yawO: 0.7, yRot: 0.7, yRotO: 0.7, height: 0.3, age: 5, maxHealth: 10 });
const pt = 0.5;
const ang = (type, dt) => {
  const p = ER.animOf(mk(type, dt), pt).sleepPose;
  if (!p) return null;
  // undo Ry(yaw): recover Rz angle from R = Ry*Rz -> element [4] = cos(angle)... use R[3],R[4] (y row)
  return Math.atan2(p.R[3], p.R[4]) * 180 / Math.PI;
};
const want = (type, dt) => Math.min(Math.sqrt((dt + pt - 1) / 20 * 1.6), 1) * ((type === 'silverfish' || type === 'spider' || type === 'cave_spider' || type === 'endermite') ? 180 : 90);
for (const [t, dt] of [['zombie', 10], ['zombie', 1], ['silverfish', 10], ['spider', 4], ['cow', 20]]) {
  const a = ang(t, dt), w = want(t, dt);
  // 180 deg wraps to +-180
  ok(a !== null && Math.abs(Math.cos((a - w) * Math.PI / 180) - 1) < 1e-6, `${t} deathTime=${dt}: roll ${a}, want ${w}`);
}
ok(ER.animOf(mk('zombie', 0), pt).sleepPose === null, 'deathTime 0: no roll pose');
// #4004: a corpse keeps LivingEntity.travel's air friction (0.91/tick horizontally), it does not glide on a flat drag
const drift = (frictionOk) => {
  if (!EL.ready) EL.init();
  W.init(1);
  const c = W.makeChunk(0, 0); c.state = M.CH.GENERATED; W.chunks.set(W.key(0, 0), c);
  const e = EL.spawn('zombie', 0.5, 200, 0.5);
  e.dead = true; e.health = 0; e.lootDropped = true; e.vx = 0.3; e.vz = 0; e.onGround = false;
  if (!frictionOk) e.__break = true;
  EL.tickMob(e);
  return e.vx;
};
{
  const vx = drift(true);
  ok(Math.abs(vx - 0.3 * 0.91) < 1e-6, `dead mob midair vx after 1 tick ${vx}, want ${0.3 * 0.91}`);
  okAv(!(Math.abs(0.3 * 0.98 - 0.3 * 0.91) < 1e-6), 'a flat 0.98 drag would be rejected by the vx comparison');
}
// anti-vacuity: break the data, the comparison must reject it
{
  const a = ang('silverfish', 10);
  okAv(!(Math.abs(Math.cos((a - 90) * Math.PI / 180) - 1) < 1e-6), 'silverfish rolls 180-scaled, not the default 90 (comparison rejects the wrong lying angle)');
  const b = ang('zombie', 10);
  okAv(!(Math.abs(Math.cos((b - want('zombie', 20)) * Math.PI / 180) - 1) < 1e-6), 'roll at deathTime 10 differs from the clamped end-roll (comparison rejects a wrong time)');
}
console.log(`\n${pass} ok, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); console.log('FAIL deathrollcheck'); process.exit(1); }
console.log(`PASS deathrollcheck - ${pass} checks green (${breaks} breaks caught)`);
process.exit(0);
