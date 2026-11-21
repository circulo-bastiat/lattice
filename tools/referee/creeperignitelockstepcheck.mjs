// lockstep-creeperignite -- #6891 (G17-L174): lockstep scenario 'creeperignite', 20 salts: creeper lit with flint and steel, creeper struck by lightning (powered), creeper beside a cat and an ocelot.
// Reference = .decomp CreeperEntity.interactMob (flint_and_steel: ignited, stack damage 1) / tick (fuse +1, explode at 30) / onStruckByLightning (powered) / explode (power explosionRadius 3 * (powered ? 2 : 1)),
// Explosion.damage (s*s+s)/2*7*power*2+1 for an unobstructed dummy, FleeEntityGoal cat/ocelot (6 blocks, 1.0/1.2). Per tick: fuse timer, ignited, powered, blast power, dummy health, flee distance.
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
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
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
M.Mount.init(); M.Particle.spawn = () => {}; M.Explosion.init(); if (M.Tnt && M.Tnt.init) M.Tnt.init(); if (M.Creeper.init) M.Creeper.init();
const { EntityList: EL, Items: IT, Use: U } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const mk = (type, x, z) => { const e = EL.spawn(type, x, 0, z); e.persistent = true; return e; };
function floor() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) w.set(x, -1, z, stone);
}
const realExplode = M.Explosion.explode; let powerHook = null;
let blast = null;
M.Explosion.explode = function (src, x, y, z, power, ...rest) { blast = power; return realExplode.call(this, src, x, y, z, powerHook ? powerHook(power) : power, ...rest); };
// reference: unobstructed dummy at 'd' blocks, power p -> damage
const refDamage = (d, p) => { const dia = p * 2, dist = d / dia; if (dist > 1) return 0; const s = 1 - dist; return Math.floor((s * s + s) / 2 * 7 * dia + 1); };
function lane(salt, mode) {
  floor(); blast = null;
  const r = stream(salt); EL.random = r; Math.random = r; M.wrand = r;
  M.Player = { x: 18, y: 0, z: 18, health: 20, inventory: { slots: Array(46).fill(M.Inventory.EMPTY) }, slot: 0 };
  const cr = mk('creeper', 0.5, 0.5); cr.aiDisabled = true; cr.noGravity = true;
  const dummy = mk('cow', 4.5, 0.5); dummy.aiDisabled = true; dummy.health = dummy.maxHealth = 100;
  const stack = { i: IT.idOf ? IT.idOf('flint_and_steel') : 0, n: 1, d: 0 };
  if (!IT.idOf) for (let i = 0; i < 2000; i++) if (IT.nameOf(i) === 'flint_and_steel') { stack.i = i; break; }
  const lit = 3 + (salt % 5);   // tick of the scripted use / strike
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  let fuse = 0, ign = false, pow = false, done = false, expPow = null;
  for (let t = 1; t <= 50 && !bad; t++) {
    if (t === lit && mode === 'flint') { U.entityUse(M.Player, cr, stack); ign = true; if (stack.d !== 1) note('flint durability ' + stack.d + ' vs 1'); }
    if (t === lit && mode === 'bolt') { M.Lightning.onStruckByLightning(cr, { id: 1 }); pow = true; ign = true; cr.ignited = true; }
    const hp0 = dummy.health;
    dummy.x = 4.5; dummy.z = 0.5; cr.x = 0.5; cr.z = 0.5;
    EL.tick();
    if (ign && !done) { fuse++; if (fuse >= 30) { done = true; expPow = 3 * (pow ? 2 : 1); } }
    if (!done && cr.currentFuseTime !== fuse) note(`tick ${t} fuse ${cr.currentFuseTime} vs ${fuse}`);
    if (!done && !!cr.ignited !== ign) note(`tick ${t} ignited ${cr.ignited} vs ${ign}`);
    if (!done && !!cr.charged !== pow) note(`tick ${t} powered ${cr.charged} vs ${pow}`);
    if (done) {
      if (blast !== expPow) note(`tick ${t} blast power ${blast} vs ${expPow}`);
      const want = hp0 - refDamage(4, expPow);
      if (Math.abs(dummy.health - want) > 1e-3) note(`dummy health ${dummy.health} vs ${want}`);
      return { bad };
    }
  }
  if (!bad && !done) note('creeper never exploded');
  return { bad };
}
function cat(salt, type) {
  floor();
  const r = stream(salt); EL.random = r; Math.random = r; M.wrand = r;
  M.Player = { x: 200, y: 0, z: 200, health: 20 };   // out of the creeper's 16-block follow range: a near player makes it target and ignite, and the ignite goal (MOVE, priority 2) then holds off the flee
  const cr = mk('creeper', 0.5, 0.5), c = mk(type, 3.5, 0.5);
  c.aiDisabled = true; const d0 = Math.hypot(cr.x - c.x, cr.z - c.z);
  for (let t = 1; t <= 30; t++) EL.tick();
  return Math.hypot(cr.x - c.x, cr.z - c.z) - d0;
}
for (const s of salts) for (const m of ['flint', 'bolt']) { const r = lane(s, m); ok(!r.bad, `creeperignite ${m} salt ${s} ${r.bad}`); }
for (const s of salts) for (const t of ['cat', 'ocelot']) { const d = cat(s, t); ok(d > 2, `salt ${s} creeper did not flee ${t} (delta ${d.toFixed(2)})`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
powerHook = (p) => (p === 6 ? 5 : p);
brk(lane(1, 'bolt').bad !== null, 'powered radius 6 changed to 5');
powerHook = null;
{ const f = M.Creeper.ignite; M.Creeper.ignite = () => {}; brk(lane(2, 'flint').bad !== null, 'flint no longer ignites'); M.Creeper.ignite = f; }
{ const f = M.Use.damage; M.Use.damage = () => false; brk(lane(3, 'flint').bad !== null, 'flint durability use removed'); M.Use.damage = f; }
{ const f = M.Lightning.onStruckByLightning; M.Lightning.onStruckByLightning = () => {}; brk(lane(4, 'bolt').bad !== null, 'lightning no longer charges'); M.Lightning.onStruckByLightning = f; }
console.log(`lockstep-creeperignite: ${80 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
