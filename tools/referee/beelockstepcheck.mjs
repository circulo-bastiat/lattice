// lockstep-bee -- #6665 (G17-L94): lockstep scenario bee, 20 salts: a nest-less angry bee 6 blocks from a standing cow dummy.
// Reference = BeeEntity.tryAttack (damage 2.0, Poison amp 0 for 10 s Normal / 18 s Hard), StingGoal reach ((w*2)^2 + target w), hasStung, tickMovement stinger death
// (ticksSinceSting%5==0 && nextInt(clamp(1200-t,1,1200))==0, so death within 1200 ticks of the sting), chooseAngerTime 20..39 s from the entity Random. Per tick: bee pos, hasStung, anger.
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
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) w.set(x, -1, z, stone);
  for (let i = -5; i <= 5; i++) for (const [x, z] of [[i, -5], [i, 5], [-5, i], [5, i]]) for (let y = 0; y < 2; y++) w.set(x, y, z, stone);
}
function lane(salt, diff) {
  floor(); M.Diff.value = diff;
  const st = M.States.stateOf('stone');   // roof and tall walls: the stung bee keeps flying until its death roll
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) { w.set(x, 12, z, st); if (Math.abs(x) === 5 || Math.abs(z) === 5) for (let y = 2; y < 12; y++) w.set(x, y, z, st); }
  const r = stream(salt); EL.random = r; Math.random = r;
  const yaw = salt * 0.31, c = Math.cos(yaw), s = Math.sin(yaw);
  const d = EL.spawn('cow', 0.5 + 3 * c, 0, 0.5 + 3 * s), b = EL.spawn('bee', 0.5 - 3 * c, 0.5, 0.5 - 3 * s);   // 6 blocks apart
  d.persistent = b.persistent = true; d.noAi = true;
  b.target = d; M.Bee.startAnger(b, d, stream(salt));
  const roll = 400 + Math.floor(stream(salt)() * 381);
  let stings = 0, deathSrc = null;
  const sting0 = M.Bee.sting, hurt0 = M.Combat.hurt;
  M.Bee.sting = function () { const h = sting0.apply(this, arguments); if (h) stings++; return h; };
  M.Combat.hurt = function (tg, dmg, a, bb, o) { if (tg === b && !deathSrc && dmg >= b.health) deathSrc = (o && o.source) || 'other'; return hurt0.apply(this, arguments); };
  let bad = null, stingT = 0, deadT = 0, prev = { x: b.x, y: b.y, z: b.z }, hp0 = d.health, sinceAtDeath = 0;
  const note = (m) => { if (!bad) bad = m; };
  if (b.angerTime !== roll) note(`anger roll ${b.angerTime} != ${roll}`);
  const reach = (b.width * 2) ** 2 + d.width;
  for (let t = 1; t <= 2500 && !bad && !deadT; t++) {
    const had = b.hasStung, ds = (prev.x - d.x) ** 2 + (prev.y - d.y) ** 2 + (prev.z - d.z) ** 2;
    EL.tick();
    if (!had && b.hasStung) {
      stingT = t;
      if (d.health !== hp0 - 2 && Math.abs(hp0 - d.health - 2) > 1e-9) note(`tick ${t} sting damage ${hp0 - d.health} != 2`);
      const p = d.effects && d.effects.poison, want = diff === 'hard' ? 360 : 200;
      if (!p || p.amplifier !== 0 || p.duration < want - 1 || p.duration > want) note(`tick ${t} poison ${p && p.amplifier + '/' + p.duration} != 0/${want}`);
      if (b.angerTime !== 0 || stings !== 1) note(`tick ${t} anger ${b.angerTime} stings ${stings}`);
      if (ds > reach + 1e-6 && Math.hypot(b.x - d.x, b.z - d.z) ** 2 > reach + 1e-6) note(`tick ${t} stung from ${ds.toFixed(2)} > reach ${reach.toFixed(2)}`);
    } else if (!had && Math.hypot(prev.x - d.x, prev.z - d.z) ** 2 + (prev.y - d.y) ** 2 <= reach - 0.5) note(`tick ${t} in reach (${ds.toFixed(2)}) but no sting`);
    if (had && stings !== 1) note(`tick ${t} second sting`);
    if (had && b.angerTime > 0) note(`tick ${t} re-angered after the sting`);
    if (b.dead || b.removed || b.health <= 0) { deadT = t; sinceAtDeath = b.ticksSinceSting; }
    prev = { x: b.x, y: b.y, z: b.z };
    d.health = Math.max(d.health, 5);
  }
  M.Bee.sting = sting0; M.Combat.hurt = hurt0;
  if (!bad && deadT && deathSrc !== 'generic') note(`bee died of ${deathSrc}, not the sting-death roll`);
  if (!bad && !stingT) note('never stung');
  else if (!bad && !deadT) note('bee outlived the sting by 2500 ticks');
  else if (!bad) {
    if (sinceAtDeath % 5 !== 0) note(`bee died at ticksSinceSting ${sinceAtDeath}, not a multiple of 5`);
    if (sinceAtDeath > 1200) note(`bee died ${sinceAtDeath} after the sting`);
  }
  return { bad, stingT, deadT };
}
const res = salts.map((s) => lane(s, 'normal'));
res.forEach((r, i) => ok(!r.bad, `bee salt ${i} ${r.bad}`));
const hard = salts.map((s) => lane(s, 'hard'));
hard.forEach((r, i) => ok(!r.bad, `bee hard salt ${i} ${r.bad}`));
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = M.Bee.HARD_POISON_TICKS; M.Bee.HARD_POISON_TICKS = 200; brk(lane(2, 'hard').bad, 'Hard poison 18 s -> 10 s'); M.Bee.HARD_POISON_TICKS = o; }
{ const at = M.Entities.attrsOf('bee'), o = at.dmg; at.dmg = 1; const r = lane(5, 'normal'); brk(r.bad, 'sting damage 2 -> 1 at tick ' + r.stingT); at.dmg = o; }
{ const o = M.Bee.NORMAL_POISON_TICKS; M.Bee.NORMAL_POISON_TICKS = 100; brk(lane(7, 'normal').bad, 'Normal poison 10 s -> 5 s'); M.Bee.NORMAL_POISON_TICKS = o; }
{ const o = M.Bee.ANGER_TIME_MAX_TICKS; M.Bee.ANGER_TIME_MAX_TICKS = 500; brk(lane(9, 'normal').bad, 'anger roll range 20..39 s -> 20..25 s'); M.Bee.ANGER_TIME_MAX_TICKS = o; }
console.log(`lockstep-bee: ${n_()} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
function n_() { return 40 + breaks; }
