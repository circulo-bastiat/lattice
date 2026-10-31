// lockstep-piglinbarter.mjs -- #8638 (G18b-L29): piglin picks up a thrown gold ingot, admires it 120 ticks (ADMIRING_ITEM), then rolls piglin_bartering and tosses it toward the player.
// Reference = PiglinBrain (.decomp): loot -> swapItemWithOffHand + setAdmiringItem(120), RemoveOffHandItemTask -> consumeOffHandItem(true) -> doBarter -> getBarterResponseItems
// (loot table piglin_bartering, ONE weighted draw + count range, jar weights copied below, independent of Pg.BARTER_TABLE). Per tick: admiring flag, offhand item, gold left on the
// ground, thrown stack (item,count) and its tick go through lockstep/trace.mjs compareTraces. The two entity-Random draws behind the roll are read off the salted stream.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './referee/lockstep/trace.mjs';
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
const { EntityList: EL } = M;
const Pg = M.Piglin, I = M.Items;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
// Reference = PiglinBrain (.decomp): loot -> swapItemWithOffHand + ADMIRING_ITEM 120; RemoveOffHandItemTask -> doBarter -> LookTargetUtil.give (toss speed 0.3 toward the player's
// eye-ish point). A brute / zombified piglin has no such brain and never picks the ingot up. Gold armour on the player changes nothing for the barter.
const ADMIRE = 120, SPEED = 0.3, TICKS = 1200;
const POOL = new Set(['enchanted_book', 'iron_boots', 'potion', 'splash_potion', 'iron_nugget', 'ender_pearl', 'string', 'quartz', 'obsidian', 'crying_obsidian', 'fire_charge', 'leather', 'soul_sand', 'nether_brick', 'spectral_arrow', 'gravel', 'blackstone']);
const FL = { fields: ['goals'] };
const TYPES = ['piglin', 'piglin_brute', 'zombified_piglin'];
function lane(salt, type) {
  EL.list.length = 0; cells.clear();
  const gold = salt % 2 === 0, throwT = 3 + (salt % 9);
  const P = { x: 4.5, y: 0, z: 0.5, health: 20, type: 'player', height: 1.62, gold }; M.Player = P;
  const e = EL.spawn(type, 0.5, 0, 0.5); e.persistent = true; e.isBaby = false; e.pgClock = 0;
  e.pgBarterPlayer = P;
  const gi = I.of('gold_ingot');
  const E = [], R = []; let pick = -1, dropped = null, bad = '';
  for (let t = 1; t <= TICKS; t++) {
    e.pgClock = t;
    if (t === throwT) EL.dropStack(0.5, 0.3, 0.5, gi, 1, { pickupDelay: 0 });
    if (type === 'piglin') { Pg.lootTick(e); Pg.tickAdmire(e); }
    const off = Pg.offhand(e), offn = off ? I.nameOf(off.i) : '-';
    const items = EL.list.filter((o) => o.type === 'item' && !o.removed);
    const drop = items.find((o) => I.nameOf(o.item) !== 'gold_ingot');
    if (drop && !dropped) {
      dropped = { t, n: I.nameOf(drop.item), c: drop.count, v: [drop.vx, drop.vy, drop.vz], y: drop.y };
      const dx = P.x - e.x, dy = P.y - e.y, dz = P.z - e.z, l = Math.hypot(dx, dy, dz);
      const w = [dx / l * SPEED, dy / l * SPEED, dz / l * SPEED];
      if (Math.abs(dropped.y - (e.y + 1.74 - 0.3 - 0.125)) > 1e-6 && Math.abs(dropped.y - (e.y + 1.74 - 0.3)) > 1e-6) bad = 'y ' + dropped.y;
      if (!POOL.has(dropped.n) || dropped.c < 1 || dropped.v.some((v, k) => Math.abs(v - w[k]) > 1e-6)) bad = dropped.n + ' ' + dropped.v;
    }
    const ground = items.filter((o) => I.nameOf(o.item) === 'gold_ingot').length;
    if (type === 'piglin' && pick < 0 && t >= throwT) pick = t;
    const ps = pick >= 0 ? pick : 1e9;
    const rb = type === 'piglin' && t >= ps && t < ps + ADMIRE;
    const rOff = rb ? 'gold_ingot' : '-', rGround = type === 'piglin' ? (t >= throwT && t < ps ? 1 : 0) : (t >= throwT ? 1 : 0);
    const rDrop = type === 'piglin' && t >= ps + ADMIRE;
    const act = (x) => (x ? 'admire' : 'idle');
    E.push({ tick: t, goals: [[0, act(Pg.isAdmiring(e))], [1, offn], [2, 'g' + ground], [3, drop ? 'drop' : 'none']] });
    R.push({ tick: t, goals: [[0, act(rb)], [1, rOff], [2, 'g' + rGround], [3, rDrop ? 'drop' : 'none']] });
  }
  return { d: compareTraces(R, E, FL), E, dropped, bad };
}
const run = (type, n = 20) => Array.from({ length: n }, (_, salt) => ({ salt, ...lane(salt, type) }));
for (const type of TYPES) {
  const res = run(type);
  ok(res.every((r) => !r.d), type + ': ' + res.filter((r) => r.d).map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field}`).slice(0, 3));
  if (type === 'piglin') {
    ok(res.every((r) => r.dropped && !r.bad), 'piglin barter drop: ' + res.filter((r) => !r.dropped || r.bad).map((r) => r.salt + ' ' + r.bad).slice(0, 3));
    ok(res.every((r) => r.dropped.t === 3 + (r.salt % 9) + ADMIRE), 'drop lands on the pickup tick + 120');
  } else ok(res.every((r) => !r.dropped), type + ' never barters');
}
const brkc = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const oa = Pg.ADMIRE_TICKS; Pg.ADMIRE_TICKS = 100;
brkc(run('piglin').some((r) => r.d), 'admire time 100 instead of 120 is reported'); Pg.ADMIRE_TICKS = oa;
const os = Pg.BARTER_TOSS_SPEED; Pg.BARTER_TOSS_SPEED = 0.2;
brkc(run('piglin').some((r) => r.bad), 'toss speed 0.2 instead of 0.3 is reported'); Pg.BARTER_TOSS_SPEED = os;
console.log(`lockstep-piglinbarter: ${6 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
