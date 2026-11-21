#!/usr/bin/env node
// wolfsitcheck.mjs — #1699: WolfEntity.interactMob tamed branch: the OWNER's right-click with any non-dye non-food item (or on a fed
// baby) toggles sitting, and clears jumping / navigation / target; a non-owner's click does not. Anti-vacuity: the toggle no-op'd,
// the owner gate removed, the reset removed -- each scenario must then FAIL ("<n> breaks caught").
// 1 + nextInt(3) per shear, mean compared at |z| > 4.5). Anti-vacuity (D-30/D-305): the golden cow_bucket held item swapped to a
// plain bucket, the engine's Use.entityUse no-op'd for sheep_shears, the golden mooshroom_shears drops halved.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x1a7e2ac7;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// The engine as the game builds it (the fallrefcheck loader): every 07*.js mob module.
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
// the weapon attribute table from the SAME golden file gen-data.mjs inlines into DATA.itemAttrs (the mobpickupcheck recipe, D-335)
{
  const tsv = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8');
  const table = {};
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  if (!(M.Hand.bindAttrs(table) > 0)) { console.log('interactrefcheck: empty item attribute table'); process.exit(1); }
}
if (M.Combat.init) M.Combat.init();
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, Items: IT, Equip: Eq, States: S } = M;
const { Survival: Sv, Inventory: Iv } = M;
if (!Sv || !Iv) { console.log('interactrefcheck: engine has no Survival/Inventory module loaded'); process.exit(1); }
const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, width: 0.6, height: 1.8, type: 'player',
  slot: 0, instabuild: false, inventory: { slots: new Array(46).fill(null), selected: 0 } };
Sv.init(P); M.Player = P;
function click(item, setup) {
  cells.clear(); EL.list.length = 0;
  const e = EL.spawn('wolf', 0.5, 1, 4.5);
  e.persistent = true; e.noAI = true; M.Breed.setAge(e, 0);
  e.tamed = true; e.owner = 'player'; e.sitting = false; e.navigating = true; e.target = { type: 'zombie' };
  if (setup) setup(e);
  P.inventory.slots.fill(null);
  const stack = item ? { i: IT.of(item), n: 1 } : null;
  P.inventory.slots[0] = stack;
  M.Use.entityUse(P, e, stack);
  return e;
}
const SCENS = [
  ['wolf_stick_sit', () => { const e = click('stick'); return e.sitting === true; }],
  ['wolf_sit_clears_target', () => { const e = click('stick'); return e.sitting === true && e.target === null && !e.navigating; }],
  ['wolf_baby_sit', () => { const e = click('beef', (w) => M.Breed.setAge(w, -24000)); return e.sitting === true; }],
  ['wolf_empty_hand_sit', () => click(null).sitting === true],
  ['wolf_non_owner_no_sit', () => click('stick', (w) => { w.owner = 'other'; }).sitting === false],
  ['wolf_same_dye_no_sit', () => click('red_dye').sitting === false],
];
let fails = 0;
for (const [id, f] of SCENS) { if (!f()) { console.log('wolfsitcheck: FAIL ' + id); fails++; } }
if (fails) process.exit(1);
let caught = 0;
const realToggle = M.Tame.toggleSit;
M.Tame.toggleSit = () => false;   // break 1: toggle no-op'd
for (const [id, f] of SCENS) if (['wolf_stick_sit', 'wolf_sit_clears_target', 'wolf_baby_sit', 'wolf_empty_hand_sit'].includes(id) && !f()) caught++;
M.Tame.toggleSit = (e) => { e.sitting = !e.sitting; return true; };   // break 2: no owner gate, no reset
for (const [id, f] of SCENS) if (['wolf_sit_clears_target', 'wolf_non_owner_no_sit'].includes(id) && !f()) caught++;
M.Tame.toggleSit = realToggle;
if (caught < 6) { console.log('wolfsitcheck: only ' + caught + ' breaks caught'); process.exit(1); }
console.log('wolfsitcheck: OK - ' + SCENS.length + ' scenarios, ' + caught + ' breaks caught');
