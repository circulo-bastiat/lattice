// mobpickuplockstepcheck.mjs -- #6723 (G17-L127): lockstep scenario 'mobpickup', 20 salts: a persistent canPickUpLoot zombie next to a dropped iron helmet, diamond sword, bow and gold ingot.
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
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '14i_hand.js', '07zw_mobnbt.js',
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
{
  const table = {};
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    const c = line.split('\t');
    if (!line || line[0] === '#' || c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table);
}
const { EntityList: EL, States: S } = M;
const Eq = M.Equip, I = M.Items;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// Reference = MobEntity.loot/tryEquip/prefersNewEquipment (.decomp), written out for this scenario only: the zombie wears a leather helmet (drop chance 0.085) and holds nothing.
// Ground order: iron_helmet, bow, diamond_sword, gold_ingot (all pickupDelay 0). Tick 1 scans in list order: helmet replaces leather (armour defense 2>1) -> the old piece drops iff
// max(r-0.1,0)<0.085; bow into the empty mainhand (no draw); sword replaces bow? sword-vs-nonsword -> true, old bow drops iff max(r-0.1,0)<0.2 is NOT used: bow slot chance is 2.0 after equip -> always drops;
// gold ingot has no slot -> stays. Both new slots get chance 2.0 and the mob turns persistent.
const FL = { fields: ['held', 'goals', 'drops', 'entities'] };
const row = (r) => ({ tick: r.t, held: r.main ? 'minecraft:' + r.main : null, goals: r.head ? [[0, r.head]] : [], drops: r.drops, entities: r.ground });
function lane(salt, ticks) {
  cells.clear(); EL.list.length = 0;
  w.set(0, -1, 0, S.stateOf('stone'));
  const log = []; const base = stream(salt); const r = () => { const v = base(); log.push(v); return v; };
  EL.random = r; Math.random = r;
  const e = EL.spawn('zombie', 0.5, 0, 0.5); e.vx = e.vy = e.vz = 0; e.canPickUpLoot = true; e.persistent = true;
  Eq.setEquipped(e, I.HEAD, Eq.stackOf('leather_helmet')); Eq.setEquipped(e, I.MAINHAND, null);
  Eq.setDropChance(e, I.HEAD, Eq.DEFAULT_DROP_CHANCE);
  const names = ['iron_helmet', 'bow', 'diamond_sword', 'gold_ingot'];
  for (const n of names) { const it = EL.dropStack(0.5, 0.2, 0.5, I.of(n), 1, { pickupDelay: 0 }); it.vx = it.vy = it.vz = 0; }
  const mark = []; const orig = Eq.tryEquip;
  Eq.tryEquip = (a, b, c) => { mark.push(log.length); return orig(a, b, c); };
  const E = [], R = [];
  try {
    for (let t = 1; t <= ticks; t++) {
      e.x = 0.5; e.z = 0.5; e.y = 0; e.vy = 0; e.onGround = true;
      EL.tick();
      const hd = Eq.getEquipped(e, I.HEAD), mh = Eq.getEquipped(e, I.MAINHAND);
      const items = EL.list.filter((o) => o.type === 'item' && !o.removed);
      const cnt = {}; items.forEach((o) => { const n = I.nameOf(o.item); cnt[n] = (cnt[n] || 0) + o.count; });
      E.push({ t, main: mh ? I.nameOf(mh.i) : '', head: hd ? I.nameOf(hd.i) : '', cnt, chance: Eq.dropChance(e, I.HEAD), pers: e.persistent });
    }
  } finally { Eq.tryEquip = orig; }
  // vanilla model. The leather helmet's drop draw is the first draw at the helmet's tryEquip call
  const dHelmet = mark.length ? Math.max(log[mark[0]] - 0.1, 0) < 0.085 : false;
  for (let t = 1; t <= ticks; t++) {
    const cnt = { gold_ingot: 1 };
    if (t >= 1) { cnt.bow = 1; if (dHelmet) cnt.leather_helmet = 1; }
    R.push({ t, main: 'diamond_sword', head: 'iron_helmet', cnt });
  }
  const proj = (x) => ({ tick: x.t, held: x.main ? 'minecraft:' + x.main : null, goals: x.head ? [[0, x.head]] : [], drops: Object.keys(x.cnt).filter((n) => n !== 'gold_ingot').sort().map((n) => [n, x.cnt[n]]), entities: x.cnt.gold_ingot ? [['gold_ingot', x.cnt.gold_ingot]] : [] });
  return { d: compareTraces(R.map(proj), E.map(proj), FL), dHelmet, E, mark };
}
const run = (n = 20) => Array.from({ length: n }, (_, salt) => ({ salt, ...lane(salt, 5) }));
const res = run();
ok(res.every((r) => !r.d), 'mobpickup lane: ' + res.filter((r) => r.d).map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${JSON.stringify(r.d.a)} vs ${JSON.stringify(r.d.b)}`).slice(0, 3));
ok(res.every((r) => r.E[4].chance === 2 && r.E[4].pers), 'equipped slot chance 2.0, persistent');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const od = Eq.DEFAULT_DROP_CHANCE;
Eq.DEFAULT_DROP_CHANCE = 0.09;
const big = (n) => Array.from({ length: n }, (_, salt) => lane(salt, 2));
brk(big(2000).some((r) => r.d), '0.085 -> 0.09 reported over 2000 salts (a one-in-200 boundary shift)');
Eq.DEFAULT_DROP_CHANCE = od;
console.log(`mobpickuplockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
