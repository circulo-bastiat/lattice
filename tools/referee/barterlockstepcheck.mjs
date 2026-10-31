// barterlockstepcheck.mjs -- #6667 (G17-L96): lockstep scenario 'barter', 20 salts: a piglin picks up a dropped gold ingot, admires it 120 ticks, then rolls piglin_bartering.
// Reference = PiglinBrain (.decomp): loot -> swapItemWithOffHand + setAdmiringItem(120), RemoveOffHandItemTask -> consumeOffHandItem(true) -> doBarter -> getBarterResponseItems
// (loot table piglin_bartering, ONE weighted draw + count range, jar weights copied below, independent of Pg.BARTER_TABLE). Per tick: admiring flag, offhand item, gold left on the
// ground, thrown stack (item,count) and its tick go through lockstep/trace.mjs compareTraces. The two entity-Random draws behind the roll are read off the salted stream.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
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
const { EntityList: EL, States: S } = M;
const Pg = M.Piglin;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
// piglin_bartering.json (jar): [item, weight, min, max]
const JAR = [['enchanted_book', 5], ['iron_boots', 8], ['potion', 8], ['splash_potion', 8], ['potion', 10], ['iron_nugget', 10, 10, 36], ['ender_pearl', 10, 2, 4],
  ['string', 20, 3, 9], ['quartz', 20, 5, 12], ['obsidian', 40], ['crying_obsidian', 40, 1, 3], ['fire_charge', 40], ['leather', 40, 2, 4], ['soul_sand', 40, 2, 8],
  ['nether_brick', 40, 2, 8], ['spectral_arrow', 40, 6, 12], ['gravel', 40, 8, 16], ['blackstone', 40, 8, 16]];
const JAR_W = JAR.reduce((a, r) => a + r[1], 0);
const ADMIRE = 120;
function refRoll(u1, u2) {
  let roll = u1 * JAR_W, i;
  for (i = 0; i < JAR.length; i++) { roll -= JAR[i][1]; if (roll < 0) break; }
  const p = JAR[i] || JAR[JAR.length - 1];
  return { item: p[0], count: p[2] !== undefined ? p[2] + Math.floor(u2 * (p[3] - p[2] + 1)) : 1 };
}
// fields carried in the shared schema: held = offhand item, goals = [[0,'admiring']] while the memory is set, drops = thrown stack, entities = gold left on the ground
const FL = { fields: ['held', 'goals', 'drops', 'entities'] };
const row = (r) => ({ tick: r.t, held: r.offhand ? 'minecraft:' + r.offhand : null, goals: r.admiring ? [[0, 'admiring']] : [], drops: r.thrown ? [[r.thrown, r.count]] : [], entities: r.gold ? [['gold_ingot', r.gold]] : [] });
function lane(salt, ticks) {
  cells.clear(); EL.list.length = 0;
  w.set(0, -1, 0, S.stateOf('stone'));
  const log = []; const base = stream(salt); const r = () => { const v = base(); log.push(v); return v; };
  EL.random = r; Math.random = r;
  const e = EL.spawn('piglin', 0.5, 0, 0.5); e.persistent = true; e.vx = e.vy = e.vz = 0;
  const I = M.Items, gi = I.of('gold_ingot');
  const it = EL.dropStack(0.5, 0.2, 0.5, gi, 1, { pickupDelay: 0 }); it.vx = it.vy = it.vz = 0;
  let mark = -1; const orig = Pg.rollBarter;
  Pg.rollBarter = (rr) => { mark = log.length; return orig(rr); };
  const E = [], R = [];
  
  try {
    for (let t = 1; t <= ticks; t++) {
      e.x = 0.5; e.z = 0.5; e.y = 0; e.vy = 0; e.onGround = true;
      EL.tick();
      const oh = Pg.offhand(e), items = EL.list.filter((o) => o.type === 'item' && !o.removed);
      const gold = items.filter((o) => o.item === gi).reduce((a, o) => a + o.count, 0);
      const thr = items.find((o) => o.item !== gi);
      E.push({ t, admiring: Pg.isAdmiring(e) ? 1 : 0, offhand: oh ? I.nameOf(oh.i) : '', gold, thrown: thr ? I.nameOf(thr.item) : '', count: thr ? thr.count : 0 });
    }
  } finally { Pg.rollBarter = orig; }
  // vanilla: the ingot is looted on tick 1 (PiglinBrain.loot -> swapItemWithOffHand), held + remembered 120 ticks, consumeOffHandItem(true) on tick 121 throws the barter stack
  const roll = mark >= 0 ? refRoll(log[mark], log[mark + 1]) : { item: '', count: 0 };
  for (let t = 1; t <= ticks; t++) {
    const hold = t <= ADMIRE;
    R.push({ t, admiring: hold ? 1 : 0, offhand: hold ? 'gold_ingot' : '', gold: 0, thrown: t > ADMIRE ? roll.item : '', count: t > ADMIRE ? roll.count : 0 });
  }
  const rr = R.map(row), ee = E.map(row);
  return { d: compareTraces(rr, ee, FL), roll, mark, E };
}
// window ends at the throw's 10-tick pickup delay (#6667): what the piglin does with its own thrown stack afterwards is the canEquipStack/prefersNew question, not this lane
const run = (n = 20) => Array.from({ length: n }, (_, salt) => ({ salt, ...lane(salt, 130) }));
const report = (res) => res.filter((r) => r.d).map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3);
const res = run();
ok(res.every((r) => !r.d), 'barter lane: ' + report(res));
ok(res.every((r) => r.mark >= 0), 'every salt barters');
ok(new Set(res.map((r) => r.roll.item)).size > 3, 'salts reach several different loot entries');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const oa = Pg.ADMIRE_TICKS; Pg.ADMIRE_TICKS = 100;
brk(run().some((r) => r.d), 'admire time 100 instead of 120 is reported'); Pg.ADMIRE_TICKS = oa;
const ot = Pg.BARTER_TABLE, ow = Pg.BARTER_WEIGHT;
Pg.BARTER_TABLE = ot.map((p, i) => i === 0 ? Object.assign({}, p, { weight: 4 }) : p); Pg.BARTER_WEIGHT = ow - 1;
brk(run(600).some((r) => r.d), 'first loot weight 5 -> 4 is reported over 600 salts (a one-in-~250 boundary shift)'); Pg.BARTER_TABLE = ot; Pg.BARTER_WEIGHT = ow;
console.log(`barterlockstepcheck: ${3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
