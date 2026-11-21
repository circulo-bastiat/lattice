#!/usr/bin/env node
// statsites1check.mjs -- #11042 stat call sites: interact_with_beacon / smithing_table / campfire (Use.blockUse), traded_with_villager (Trade.attempt), talked_to_villager (Use.entityUse).
// A failed open / failed trade bumps nothing. Anti-vacuity: patches drop each call site; "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const A = MCLITE_ROOT + 'assets/';
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
  '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
  '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js',
  '07ox_enchhelper.js', '07p_trade.js', '07zzo_stats.js', '14_player.js'];
function run(patch) {
  const E = loadEngine({ extra: EXTRA, dom: false, patch });
  E.Items.init({ items: readFileSync(A + 'items.bin').toString('base64'), itemsBytes: JSON.parse(readFileSync(A + 'items.meta.json', 'utf8')).rawBytes });
  E.DATA = Object.assign({}, E.DATA, { entities: JSON.parse(readFileSync(A + 'entities.json', 'utf8')) });
  E.Entities.init(); E.Entities.attrs = E.DATA.entities.attrs;
  E.World.init(1); E.Behave.init(E.World); E.BlockEntities.init(); E.Use.init(E.World);
  E.EntityList.init(); E.Ai.init(); if (E.Spawn && E.Spawn.init) E.Spawn.init();
  if (E.Recipes && E.Recipes.init && !E.Recipes.ready) { try { E.Recipes.init({ recipes: readFileSync(A + 'recipes.bin').toString('base64'), recipesBytes: JSON.parse(readFileSync(A + "recipes.meta.json", "utf8")).jsonBytes }); } catch (e) { /* reported by the campfire assertion */ } }
  const c = E.World.makeChunk(0, 0); c.state = E.CH.GENERATED; E.World.chunks.set(E.World.key(0, 0), c);
  E.Sound = { entitySound() {}, blockBreak() {}, play() {} }; E.Particle.addBlockBreakParticles = () => {}; E.Particle.spawn = () => {};
  const P = E.Player; P.inventory = E.Inventory.create(); P.slot = 0; P.mayBuild = true; P.x = 0.5; P.y = 64; P.z = 0.5;
  if (!E.Recipes.ready) fails.push('Recipes not ready');
  const out = {}, Iv = E.Inventory, g = (s) => E.Stats.get(E.Stats.custom(s));
  const place = (name, yy) => { E.World.setBlock(3, yy, 5, E.States.stateOf(name)); return E.World.getBlock(3, yy, 5); };
  const useBlock = (st, yy, held) => E.Use.blockUse(P, 3, yy, 5, st, held || Iv.EMPTY);
  // beacon / smithing: opener succeeds -> +1 ; opener fails -> 0
  for (const [blk, opener, stat] of [['beacon', 'openBeacon', 'interact_with_beacon'], ['smithing_table', 'openSmithing', 'interact_with_smithing_table']]) {
    E.Stats.reset(); E.Hud = { [opener]: () => true }; useBlock(place(blk, 70));
    out[stat] = g(stat);
    E.Stats.reset(); E.Hud = { [opener]: () => false }; useBlock(place(blk, 71));
    out[stat + '_fail'] = g(stat);
  }
  // campfire: raw beef in -> +1 ; empty hand / non-cookable -> 0
  E.Stats.reset(); let st = place('campfire', 72); E.BlockEntities.create(3, 72, 5, 'campfire');
  useBlock(st, 72, Iv.EMPTY); out.cf_empty = g('interact_with_campfire');
  const beef = { i: E.Items.of('beef'), n: 2 }; Iv.setItem(P.inventory, 0, beef); useBlock(st, 72, beef);
  out.interact_with_campfire = g('interact_with_campfire');
  const stick = { i: E.Items.of('stick'), n: 1 }; useBlock(st, 72, stick); out.cf_stick = g('interact_with_campfire');
  // villager trade
  const emerald = E.Items.of('emerald'), wheat = E.Items.of('wheat');
  const oi = 0;
  const v = { type: 'villager', profession: 'farmer', tradeOffers: [{ kind: 'sell_item_for_emerald', item: 'wheat', itemQty: 20, priceEmerald: 1, maxUses: 16, xp: 2 }], tradeUses: [0], tradeDemand: [0], tradeSpecial: [0], tradeProfession: 'farmer', villagerLevel: 1, tradeXp: 0 }, TP = { inventory: Iv.create(), instabuild: false };
  E.Stats.reset(); E.Trade.attempt(v, oi, TP); out.trade_fail = g('traded_with_villager');
  Iv.setItem(TP.inventory, 0, { i: wheat, n: 20 }); const r = E.Trade.attempt(v, oi, TP);
  out.trade_ok = r.ok; if (!r.ok) fails.push('trade: ' + r.reason); out.traded_with_villager = g('traded_with_villager');
  // villager talk: Use.entityUse on a free villager -> +1 ; one with a customer (no screen) -> 0
  E.Trade.ready = true; E.Trade.ensure = () => [{}]; E.Hud = { openTrading: () => true };
  E.Stats.reset(); E.Use.entityUse(P, Object.assign(E.EntityList.spawn('villager', 0, 70, 0), { customer: {} }), null); out.talk_gated = g('talked_to_villager');
  E.Stats.reset(); E.Use.entityUse(P, E.EntityList.spawn('villager', 2, 70, 2), null); out.talked_to_villager = g('talked_to_villager');
  return out;
}
const good = run(null);
ok(good.interact_with_beacon === 1, 'beacon open == 1, got ' + good.interact_with_beacon);
ok(good.interact_with_smithing_table === 1, 'smithing open == 1, got ' + good.interact_with_smithing_table);
ok(good.interact_with_beacon_fail === 0 && good.interact_with_smithing_table_fail === 0, 'failed open bumped a stat');
ok(good.cf_empty === 0, 'empty-hand campfire bumped');
ok(good.interact_with_campfire === 1, 'campfire cook == 1, got ' + good.interact_with_campfire);
ok(good.cf_stick === 1, 'non-cookable campfire use bumped');
ok(good.trade_fail === 0, 'failed trade bumped');
ok(good.trade_ok === true && good.traded_with_villager === 1, 'trade == 1, got ' + good.traded_with_villager);
ok(good.talk_gated === 0, 'villager with a customer bumped talked_to_villager');
ok(good.talked_to_villager === 1, 'talk == 1, got ' + good.talked_to_villager);
const brk = (name, f, from, to, key, want) => {
  let bad; try { bad = run((file, s) => { if (!file.endsWith(f)) return s; if (!s.includes(from)) throw new Error('not found: ' + from); return s.replace(from, to); }); } catch (e) { bad = {}; }
  if (bad[key] !== want) { breaks++; console.log('  ✓ break caught: ' + name); } else fails.push('anti-vacuity: ' + name + ' did not break the check');
};
brk('beacon site dropped', '14l_use.js', "'interact_with_beacon'", "'x_beacon'", 'interact_with_beacon', 1);
brk('smithing site dropped', '14l_use.js', "'interact_with_smithing_table'", "'x_smith'", 'interact_with_smithing_table', 1);
brk('campfire site dropped', '14l_use.js', "Use.openStat('interact_with_campfire')", "0", 'interact_with_campfire', 1);
brk('trade site dropped', '07p_trade.js', "NS.Stats.inc('traded_with_villager')", "0", 'traded_with_villager', 1);
brk('talk site dropped', '14l_use.js', "if (NS.Stats && NS.Stats.inc) NS.Stats.inc('talked_to_villager');\n      if (NS.Trade && NS.Trade.ready)", "if (NS.Trade && NS.Trade.ready)", 'talked_to_villager', 1);
console.log(fails.length ? 'FAIL ' + fails.join('; ') : `${pass} checks passed, 0 failures (${breaks} breaks caught)`);
process.exit(fails.length || breaks < 5 ? 1 : 0);
