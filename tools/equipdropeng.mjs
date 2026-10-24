// equipdropeng.mjs (#7865): the ENGINE side of the spawn-time equipment drop pack (referee/equipdropscen.mjs): EL.spawn(mob)
// (its own initialize -> Equip.initMob / initDrowned), then the real player kill join (Combat.attack, Combat.tickEntity ->
// Equip.dropEquipment -> EL.dropStack), the dropped EQUIPMENT item entities tallied by id. Same loader as geardroprefcheck.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { isGear } from './referee/equipdropscen.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js'];
let ctx = null;
function setup() {
  if (ctx) return ctx;
  let seed = 0x7865a11;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
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
  M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
  if (M.Goat && M.Goat.init) M.Goat.init();
  M.EntityList.random = rng;
  Math.random = rng;
  const { Inventory: Iv, Survival: Sv, States: S } = M;
  const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, yaw: 0, pitch: 0, type: 'player', slot: 0, inventory: { slots: new Array(Iv.SIZE || 46).fill(null), selected: 0 } };
  Sv.init(P);
  M.Player = P;
  for (let x = -3; x <= 6; x++) for (let z = -3; z <= 3; z++) w.set(x, 0, z, S.stateOf('stone'));
  P.inventory.slots[0] = { i: M.Items.of('netherite_sword'), n: 1 };
  if (M.Effects && M.Effects.addStatusEffect) M.Effects.addStatusEffect(P, 'strength', 1e9, 100, false, false);
  return (ctx = { M, P });
}

/** n player kills of a freshly spawned `mob`: { kills, errs, items: { id: count } } (equipment ids only). `mut(M)` may break the engine. */
export function engineGear(mob, n, mut) {
  const { M, P } = setup(), { EntityList: EL, Items: IT, Combat: Cb } = M;
  const restore = mut ? mut(M) : null;
  const rec = { kills: 0, errs: 0, items: {} };
  try {
    for (let k = 0; k < n; k++) {
      EL.list.length = 0;
      const e = EL.spawn(mob, 2.5, 1, 0.5);
      if (!e) { rec.errs++; continue; }
      e.health = 0.001;
      M.Hand.attackStrengthTicker = 1000;
      Cb.attack(P, e);
      if (!e.dead) { rec.errs++; continue; }
      Cb.tickEntity(e);
      rec.kills++;
      for (const o of EL.list) {
        if (o.type !== 'item' || o.item === undefined) continue;
        const id = IT.nameOf(o.item);
        if (isGear(id)) rec.items[id] = (rec.items[id] || 0) + (o.count | 0 || 1);
      }
    }
  } finally { if (restore) restore(); }
  return rec;
}
