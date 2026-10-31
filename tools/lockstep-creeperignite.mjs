// lockstep-creeperignite (tools/) -- #8655 G18b-L40: creeper swell lane, 20 salts x {player at 2, 4, 8 blocks, flint_and_steel} x {uncharged, charged}.
// Reference = .decomp CreeperEntity.tick (lastFuseTime = currentFuseTime; ignited -> setFuseSpeed(1); currentFuseTime += fuseSpeed, floor 0, explode at fuseTime 30),
// CreeperIgniteGoal (canStart: fuseSpeed > 0 || target within sq 9; tick: target gone or sq > 49 -> -1 else +1), interactMob (flint: ignited, no re-ignite), explode (3 * (charged ? 2 : 1)).
// Per tick: currentFuseTime, lastFuseTime, fuseSpeed, ignited, then the blast power and the dirt destroyed at 7..9 blocks.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
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

let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const { EntityList: EL, Items: IT, Use: U } = M;
const mk = (type, x, z) => { const e = EL.spawn(type, x, 0, z); e.persistent = true; return e; };
const stone = M.States.stateOf('stone'), dirt = M.States.stateOf('dirt');
const realExplode = M.Explosion.explode; let blast = null;
M.Explosion.explode = function (src, x, y, z, power, ...rest) { blast = power; return realExplode.call(this, src, x, y, z, power, ...rest); };
const flintId = (() => { for (let i = 0; i < 2000; i++) if (IT.nameOf(i) === 'flint_and_steel') return i; return 0; })();
function lane(salt, dist, charged, flint) {
  cells.clear(); EL.list.length = 0; blast = null;
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) w.set(x, -1, z, stone);
  for (let x = 7; x <= 9; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y <= 1; y++) w.set(x, y, z, dirt);
  const r = stream(salt); EL.random = r; Math.random = r; M.wrand = r;
  M.Player = { x: 18, y: 0, z: 18, health: 20, inventory: { slots: Array(46).fill(M.Inventory.EMPTY) }, slot: 0 };
  const cr = mk('creeper', 0.5, 0.5); cr.noGravity = true; cr.charged = charged;
  const tg = mk('cow', 0.5 + dist, 0.5); tg.aiDisabled = true; tg.health = tg.maxHealth = 1000;
  const stack = { i: flintId, n: 1, d: 0 };
  const lit = flint ? 3 + (salt % 5) : -1, move = 8 + (salt % 4);   // flint tick; tick the player steps back out to 8 blocks
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  let cur = 0, speed = -1, ign = false, done = false;
  for (let t = 1; t <= 60 && !bad; t++) {
    if (t === lit) { U.entityUse(M.Player, cr, stack); ign = true; U.entityUse(M.Player, cr, stack); if (stack.d !== 2 && stack.d !== 1) note('flint durability ' + stack.d); }
    const d = (!flint && dist === 2 && salt % 2 === 1 && t >= move) ? 8 : dist;   // 2 -> 8: the sq > 49 cancel
    cr.x = 0.5; cr.z = 0.5; tg.x = 0.5 + d; tg.z = 0.5; cr.target = tg;
    // reference: CreeperEntity.tick runs the fuse BEFORE the goals (a speed the goal writes in tick N is consumed in N+1, #4382)
    if (ign) speed = 1;
    const last = cur; cur = Math.max(0, cur + speed);
    if (cur >= 30) { done = true; }
    else if (speed > 0 || d * d < 9) speed = d * d > 49 ? -1 : 1;
    EL.tick();
    if (done) {
      const want = 3 * (charged ? 2 : 1);
      if (blast !== want) note(`tick ${t} blast power ${blast} vs ${want}`);
      let gone = 0; for (let x = 7; x <= 9; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y <= 1; y++) if (!w.get(x, y, z)) gone++;
      if (!charged && gone) note(`uncharged destroyed ${gone} blocks at 7..9`);
      if (charged && !gone) note('charged destroyed nothing at 7..9');
      return { bad, t };
    }
    if (cr.currentFuseTime !== cur) note(`tick ${t} fuse ${cr.currentFuseTime} vs ${cur}`);
    if (cr.lastFuseTime !== last) note(`tick ${t} lastFuseTime ${cr.lastFuseTime} vs ${last}`);
    if ((cr.fuseSpeed || 0) !== speed) note(`tick ${t} fuseSpeed ${cr.fuseSpeed} vs ${speed}`);
    if (!!cr.ignited !== ign) note(`tick ${t} ignited ${cr.ignited} vs ${ign}`);
  }
  if (!bad && !done && (flint || (dist === 2 && salt % 2 === 0))) note('creeper never exploded');
  return { bad, t: 0 };
}
const cases = [[2, false], [4, false], [8, false], [2, true], [4, true], [0, false, true], [0, true, true]];
for (const s of salts) for (const c of cases) {
  const r = lane(s, c[0] || 6, c[1], !!c[2]);
  ok(!r.bad, `creeperignite salt ${s} dist ${c[0]} charged ${c[1]} flint ${!!c[2]}: ${r.bad}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const f = M.Creeper.ignite; M.Creeper.ignite = () => {}; brk(lane(2, 6, false, true).bad !== null, 'flint no longer ignites'); M.Creeper.ignite = f; }
{ const f = M.Explosion.explode; M.Explosion.explode = function (s, x, y, z, p, ...r) { return f.call(this, s, x, y, z, 3, ...r); }; brk(lane(2, 2, true, false).bad !== null, 'charged power 6 changed to 3'); M.Explosion.explode = f; }
{ const f = M.Creeper.tick; M.Creeper.tick = function (e) { e.fuseTime = 20; return f.call(this, e); }; brk(lane(4, 2, false, false).bad !== null, 'fuse 30 changed to 20'); M.Creeper.tick = f; }
{ const f = M.Ai.CreeperIgniteGoal; M.Ai.CreeperIgniteGoal = function (e) { const g = new f(e); const t = g.tick; g.tick = function () { t(); e.fuseSpeed = 1; }; return g; };
  brk(lane(5, 2, false, false).bad !== null, 'swell cancel at 7 removed'); M.Ai.CreeperIgniteGoal = f; }
console.log(`lockstep-creeperignite: ${salts.length * cases.length + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
