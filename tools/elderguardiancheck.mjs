#!/usr/bin/env node
// elderguardiancheck.mjs — #1009: ElderGuardianEntity.mobTick curse (src/07zzq_elderguardian.js).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07q_effects.js', '07zzq_elderguardian.js', '07zzr_guardian.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07zx_particle.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const W = MCL.World, CH = MCL.CH, EL = MCL.EntityList, Eg = MCL.ElderGuardian, ES = MCL.Effects;
MCL.Behave.init(W); MCL.Entities.init(); EL.init(); MCL.Ai.init(); MCL.Combat.init();
let breaks0 = 0; let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
W.init(1);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
EL.init();
const g = EL.spawn('elder_guardian', 0.5, 70, 0.5, {});
ok(!!g, 'elder_guardian spawns');
function player(x, mode) { return { x, y: 70, z: 0.5, mode, effects: {}, vx: 0, vy: 0, vz: 0 }; }
function run(p, age, eg) {
  eg = eg || Eg;
  EL.pushPlayer = () => p;
  g.age = age; g.id = 0; g.removed = false; g.dead = false;
  eg.mobTick(g);
}
const cases = [];
let p = player(10, 0); run(p, 1199); ok(!ES.hasStatusEffect(p, 'mining_fatigue'), 'off-interval: nothing');
p = player(10, 0); run(p, 1200);
ok(ES.amplifierOf(p, 'mining_fatigue') === 2, 'survival in range: mining_fatigue amp 2 (level III)');
ok(ES.getStatusEffect(p, 'mining_fatigue').duration === 6000, 'duration 6000');
ok(p.elderGuardianFx && p.elderGuardianFx.ticks > 0, 'apparition recorded');
p = player(10, 1); run(p, 1200); ok(!ES.hasStatusEffect(p, 'mining_fatigue'), 'creative: not applied');
p = player(10, 3); run(p, 1200); ok(!ES.hasStatusEffect(p, 'mining_fatigue'), 'spectator: not applied');
p = player(10, 2); run(p, 1200); ok(ES.amplifierOf(p, 'mining_fatigue') === 2, 'adventure is survival-like: applied');
p = player(51, 0); run(p, 1200); ok(!ES.hasStatusEffect(p, 'mining_fatigue'), '>50 blocks: not applied');
p = player(49, 0); run(p, 2400); ok(ES.amplifierOf(p, 'mining_fatigue') === 2, '49 blocks: applied');
p = player(10, 0); ES.addStatusEffect(p, 'mining_fatigue', 3000, 2); p.elderGuardianFx = null; run(p, 1200);
ok(!p.elderGuardianFx, 'already amp>=2 dur>=1200: no re-apply/packet');
p = player(10, 0); ES.addStatusEffect(p, 'mining_fatigue', 1000, 2); run(p, 1200);
ok(ES.getStatusEffect(p, 'mining_fatigue').duration === 6000, 'dur<1200 refreshed to 6000');
const real = EL.tickOne ? true : true;
// integration: the real tick loop reaches mobTick
p = player(10, 0); EL.pushPlayer = () => p; g.age = 1199; g.id = 0;
EL.tickMob ? EL.tickMob(g) : EL.tickOne(g);
ok(ES.amplifierOf(p, 'mining_fatigue') === 2, 'EntityList tick dispatches ElderGuardian.mobTick');
// #1010: persistent + position target (radius 16 around spawn) + wander chance 400
ok(g.persistent === true, 'elder guardian is persistent (never despawns)');
g.positionTargetRange = -1; g.x = 5.5; g.y = 70; g.z = 7.5; Eg.mobTick(g);
ok(MCL.Ai.hasPositionTarget(g) && g.positionTargetRange === 16 && g.positionTarget.x === 5 && g.positionTarget.z === 7, 'mobTick sets position target (blockPos, 16)');
g.x = 300.5; Eg.mobTick(g); ok(g.positionTarget.x === 5, 'existing position target is not moved'); g.x = 0.5; g.z = 0.5;
ok(!MCL.Ai.isInWalkTargetRange(g, { x: 5 + 16, y: 70, z: 7 }) && MCL.Ai.isInWalkTargetRange(g, { x: 5 + 15, y: 70, z: 7 }), 'restriction radius 16');
ok(MCL.Guardian.ELDER_WANDER_CHANCE === 400 && MCL.Guardian.WANDER_CHANCE === 80, 'wander chances 400 (elder) / 80 (guardian)');
// #8078: the packet also adds the ELDER_GUARDIAN particle (at the player), exactly when the curse applies
{ const Px = MCL.Particle; Px.clear();
  let q = player(10, 0); run(q, 1200);
  ok(Px.list.filter((x) => x.type === 'elder_guardian').length === 1, 'curse spawns one elder_guardian particle');
  const pp = Px.list[0]; ok(pp && pp.x === q.x && pp.y === q.y && pp.maxAge === 30, 'particle at the player, maxAge 30');
  Px.clear(); q = player(10, 1); run(q, 1200); ok(!Px.list.length, 'creative: no particle');
  Px.clear(); q = player(51, 0); run(q, 1200); ok(!Px.list.length, 'out of range: no particle');
  Px.clear(); const o = Px.spawnElderGuardian; Px.spawnElderGuardian = () => {}; q = player(10, 0); run(q, 1200); Px.spawnElderGuardian = o;
  breaks0 = 1; ok(!Px.list.length, 'anti-vacuity: no spawn leaves no particle'); Px.clear(); }
// anti-vacuity: break the module, each scenario must then fail
let breaks = breaks0;
const brk = (name, patch, scen) => {
  const o = {}; for (const k of Object.keys(patch)) o[k] = Eg[k];
  Object.assign(Eg, patch); const r = scen(); Object.assign(Eg, o);
  breaks++; ok(r, 'anti-vacuity: ' + name);
};
brk('range 10000 applies at 51', { RANGE_SQ: 1e6 }, () => { const q = player(51, 0); run(q, 1200); return ES.hasStatusEffect(q, 'mining_fatigue'); });
brk('amplifier 1 is caught', { AMPLIFIER: 1 }, () => { const q = player(10, 0); run(q, 1200); return ES.amplifierOf(q, 'mining_fatigue') !== 2; });
brk('interval 1 fires off-interval', { INTERVAL: 1 }, () => { const q = player(10, 0); run(q, 1199); return ES.hasStatusEffect(q, 'mining_fatigue'); });
{ const o = MCL.Ai.setPositionTarget; MCL.Ai.setPositionTarget = () => {}; g.positionTargetRange = -1; Eg.mobTick(g); MCL.Ai.setPositionTarget = o; breaks++; ok(!MCL.Ai.hasPositionTarget(g), 'anti-vacuity: no setPositionTarget leaves no target'); }
const gm = g.id; g.id = 0; const orig = Eg.mobTick; Eg.mobTick = function (e) { const s = e.type; e.type = 'x'; orig(e); e.type = s; };
{ const q = player(10, 0); run(q, 1200); breaks++; ok(!ES.hasStatusEffect(q, 'mining_fatigue'), 'anti-vacuity: disabled mobTick applies nothing'); }
Eg.mobTick = orig;
console.log(`${pass} assertions, ${fails.length} failures, ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
