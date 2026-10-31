#!/usr/bin/env node
// wtradersavecheck.mjs — #1307: wandering-trader offers/despawnDelay/wanderTarget (MobNbt) and the
// WanderingTraderManager counters (16b_save.js `wtm`) survive a save -> fresh engine -> load.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07n_tame.js', '07o_profession.js', '07p_trade.js',
  '07r_mount.js', '07ze_llama.js', '07t_fly.js', '07q_effects.js', '07zt_wtrader.js', '09b_sky.js',
  '16b_save.js', '07zw_mobnbt.js'];
const store = {};
function fresh() {
  const MCL = loadEngine({ extra: EXTRA, dom: false });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
  MCL.World.init(1); MCL.Behave.init(MCL.World);
  if (MCL.BlockEntities && MCL.BlockEntities.init) MCL.BlockEntities.init();
  MCL.EntityList.init();
  globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
  globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  MCL.Player = { toJSON: () => ({ x: 0, y: 64, z: 0 }), fromJSON: () => false };
  MCL.Save.init();
  return MCL;
}
console.log('wtradersavecheck — #1307, wandering trader + manager persistence');
function run(breakIt) {
  for (const k of Object.keys(store)) delete store[k];
  const A1 = fresh(); const WT = A1.WT;
  const t = A1.EntityList.spawn('wandering_trader', 4.5, 64, 4.5, {});
  if (!ok(!!t, 'trader spawned')) return;
  WT.ensureOffers ? WT.ensureOffers(t, Math.random) : WT.tickEntity(t);
  t.despawnDelay = 31337; t.wanderTarget = [10, 64, 12];
  if (t.tradeUses) t.tradeUses[0] = 2;
  WT.Manager.spawnTimer = 777; WT.Manager.spawnDelay = 12345; WT.Manager.spawnChance = 60;
  const offers = JSON.stringify(t.tradeOffers), uses = JSON.stringify(t.tradeUses);
  ok(!!t.tradeOffers && t.tradeOffers.length === 6, 'trader has 6 rolled offers');
  A1.Save.save(false);
  if (breakIt) { const o = JSON.parse(store[A1.Save.KEY]); delete o.wtm; o.mobs.forEach((m) => { delete m.tradeOffers; }); store[A1.Save.KEY] = JSON.stringify(o); }
  const B = fresh();
  ok(B.Save.load(), 'load');
  B.WT.managerFromJSON && 0;
  B.MobNbt.restoreAll(B.Save.mobRecords || []);
  const r = B.EntityList.list.find((e) => e.type === 'wandering_trader');
  const M = B.WT.Manager;
  const res = [
    !!r, r && r.despawnDelay === 31337, r && JSON.stringify(r.wanderTarget) === '[10,64,12]',
    r && JSON.stringify(r.tradeOffers) === offers, r && JSON.stringify(r.tradeUses) === uses,
    M.spawnTimer === 777, M.spawnDelay === 12345, M.spawnChance === 60];
  return res;
}
const good = run(false);
['trader restored', 'despawnDelay', 'wanderTarget', 'offers', 'uses', 'manager timer', 'manager delay', 'manager chance']
  .forEach((n, i) => ok(good && good[i], n + ' round-trips'));
const bad = run(true);
breaks++; ok(bad && bad.some((x) => !x), 'anti-vacuity: stripping wtm/offers from the save is caught');
console.log(fails.length ? fails.join('\n') : 'ok') ;
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks + ' ✓');
process.exit(fails.length ? 1 : 0);
