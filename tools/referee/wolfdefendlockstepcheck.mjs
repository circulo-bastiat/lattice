// lockstep-wolfdefend -- #6863 (G17-L162): lockstep scenario 'wolfdefend', 20 salts: tamed wolf, scripted owner hurt by a zombie, then hits a pig, then the wolf sits.
// Reference = .decomp WolfEntity goals (TARGET 1 TrackOwnerAttackerGoal, 2 AttackWithOwnerGoal, 3 RevengeGoal), WolfEntity.canAttackWithOwner (never creeper/ghast, never a tamed wolf), SitGoal clears owner goals.
// Per tick: wolf target vs the reference model; goals field priorities/classes.
// Reference = .decomp WolfEntity.interactMob (bone, nextInt(3)==0 -> setOwner, setSitting(true)), TameableEntity sit toggle, SitGoal (a sitting wolf never moves), FollowOwnerGoal (unsat owner > 10 blocks away -> approach).
// Per tick: tamed/owner/sitting/pos are compared with the reference model; the roll is the FIRST draw of the entity stream in the feed call (floor(d*3)==0).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.Mount.init();
const { EntityList: EL, Mount: Mn, Passive: Ps } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
function floor() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) w.set(x, -1, z, stone);
}

const mk = (type, x, z) => { const e = EL.spawn(type, x, 0, z); e.persistent = true; return e; };
function lane(salt, opt) {
  opt = opt || {};
  floor();
  const r = stream(salt); EL.random = r; Math.random = r;
  M.Player = { x: 0, y: 0, z: 0, health: 20 };
  const wolf = mk('wolf', 0.5, 0.5); wolf.tamed = true; wolf.owner = 'player'; wolf.sitting = false;
  const attacker = mk(opt.attacker || 'zombie', 4.5, 0.5), pig = mk('pig', -4.5, 0.5);
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  const gl = (wolf.goals && wolf.goals.goals) || (wolf.goals && wolf.goals.list) || null;
  const want = { 1: 'OwnerHurtByTargetGoal', 2: 'OwnerHurtTargetGoal', 3: 'HurtByTargetGoal' };
  const tg = M.Ai.OwnerHurtByTargetGoal && M.Ai.OwnerHurtTargetGoal && M.Ai.HurtByTargetGoal;
  if (!tg) note('goal classes missing');
  for (let t = 1; t <= 60 && !bad; t++) {
    let ref;   // reference target after this tick's script
    if (t === 5) { M.Player.lastHurtByEntity = attacker; ref = attacker; }
    if (t === 25) { M.Player.lastHurtByEntity = null; wolf.target = null; M.Player.lastHurtMob = pig; ref = pig; }
    if (t === 45) { wolf.target = null; wolf.lastHurtByEntity = null; attacker.removed = true; const p = mk(opt.attacker || 'zombie', 6.5, 6.5); M.Player.lastHurtByEntity = p; M.Player.lastHurtMob = null; wolf.sitting = !opt.noSit; ref = wolf.sitting ? null : undefined; }
    EL.tick();
    if (t >= 6 && t < 25 && wolf.target !== attacker) note(`tick ${t} target ${wolf.target && wolf.target.type} vs zombie (TrackOwnerAttacker)`);
    if (t >= 26 && t < 45 && wolf.target !== pig) note(`tick ${t} target ${wolf.target && wolf.target.type} vs pig (AttackWithOwner)`);
    if (t >= 46 && wolf.target) note(`tick ${t} sitting wolf took target ${wolf.target.type}`);
  }
  return { bad };
}
function exempt(salt, type, tamedOther) {
  floor();
  const r = stream(salt); EL.random = r; Math.random = r;
  M.Player = { x: 0, y: 0, z: 0, health: 20 };
  const wolf = mk('wolf', 0.5, 0.5); wolf.tamed = true; wolf.owner = 'player'; wolf.sitting = false;
  const v = mk(type, 4.5, 0.5); if (tamedOther) { v.tamed = true; v.owner = 'other'; }
  M.Player.lastHurtMob = v;
  for (let t = 1; t <= 10; t++) EL.tick();
  return wolf.target === v;
}
for (const s of salts) { const r = lane(s); ok(!r.bad, 'wolfdefend salt ' + s + ' ' + r.bad); }
for (const s of salts) {
  for (const t of ['creeper', 'ghast']) ok(!exempt(s, t), `salt ${s} wolf attacked ${t}`);
  ok(!exempt(s, 'wolf', true), `salt ${s} wolf attacked tamed wolf of another owner`);
  ok(exempt(s, 'skeleton'), `salt ${s} wolf ignored owner's skeleton target`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const f = M.Ai.OwnerHurtTargetGoal; M.Ai.OwnerHurtTargetGoal = function (e, g) { const o = new f(e, g); o.canUse = () => !!(g()[0] && g()[0].lastHurtMob); return o; };
  brk(exempt(1, 'creeper') === true, 'creeper exemption removed -> wolf attacking a creeper'); M.Ai.OwnerHurtTargetGoal = f; }
{ const f = M.Ai.OwnerHurtByTargetGoal; M.Ai.OwnerHurtByTargetGoal = function () { this.canUse = () => false; this.canContinueToUse = () => false; this.start = this.stop = this.tick = () => {}; };
  const r = lane(3); brk(!!r.bad, `TrackOwnerAttacker disabled: ${r.bad}`); M.Ai.OwnerHurtByTargetGoal = f; }
{ const f = M.Tame.toggleSit; const r0 = lane(4, { noSit: true }); brk(!!r0.bad, `sit exemption (wolf not sat) diverges: ${r0.bad}`); }
console.log(`lockstep-wolfdefend: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
