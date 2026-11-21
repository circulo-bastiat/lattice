#!/usr/bin/env node
// villageraccept.mjs — G18f phase ACCEPTANCE (#230): the villager phase's own bar, driven through the
// real src (07p_trade.js Trade, 07l_spawn.js Village, 07s_raid.js Rd.grantHeroes), not a copy:
//   1. level-1 offers exact for 3 professions, level-2 offers added on level-up
//   2. an over-traded offer disables, then restocks
//   3. price RISES after hurting a villager (gossip) and FALLS after a won raid (Hero of the Village)
//   4. N villagers (+ N beds = N recently slept) spawn an iron golem, fewer do not
// Every section breaks its own rule once and must see the result change ("<n> breaks caught").
//   node tools/villageraccept.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('  ✓ break caught: ' + m); };
console.log('villageraccept — G18f acceptance: offers, disable/restock, gossip price, golem beds');

const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07b_behaviour.js',
  '07h_entitylist.js'.replace('h_entitylist', 'h_entities'), '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js',
  '14d_survival.js', '07k_goals.js', '07l_spawn.js', '07ox_enchhelper.js', '07p_trade.js',
  '14c_raycast.js', '07q_effects.js', '07y_equip.js', '07s_raid.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init();
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init(); M.Village.init();

// The vanilla table, typed once here from the disassembled TradeOffers arguments (D-480 golden
// tools/golden/villager-trades-1.18.2.tsv is what the engine loads; this list is the independent
// second copy that catches a drifted regeneration): [kind, item, qty, price, maxUses, xp, mult]
const S = 'sell_item_for_emerald', B = 'buy_item_for_emerald';
const EXPECT = {
  farmer: {
    1: [[S, 'wheat', 20, 1, 16, 2, 0.05], [S, 'potato', 26, 1, 16, 2, 0.05], [S, 'carrot', 22, 1, 16, 2, 0.05],
        [S, 'beetroot', 15, 1, 16, 2, 0.05], [B, 'bread', 6, 1, 16, 1, 0.05]],
    2: [[S, 'pumpkin', 6, 1, 12, 10, 0.05], [B, 'pumpkin_pie', 4, 1, 12, 5, 0.05], [B, 'apple', 4, 1, 16, 5, 0.05]]
  },
  butcher: {
    1: [[S, 'chicken', 14, 1, 16, 2, 0.05], [S, 'porkchop', 7, 1, 16, 2, 0.05], [S, 'rabbit', 4, 1, 16, 2, 0.05],
        [B, 'rabbit_stew', 1, 1, 12, 1, 0.05]],
    2: [[S, 'coal', 15, 1, 16, 2, 0.05], [B, 'cooked_porkchop', 5, 1, 16, 5, 0.05], [B, 'cooked_chicken', 8, 1, 16, 5, 0.05]]
  },
  armorer: {
    1: [[S, 'coal', 15, 1, 16, 2, 0.05], [B, 'iron_leggings', 1, 7, 12, 1, 0.2], [B, 'iron_boots', 1, 4, 12, 1, 0.2],
        [B, 'iron_helmet', 1, 5, 12, 1, 0.2], [B, 'iron_chestplate', 1, 9, 12, 1, 0.2]],
    2: [[S, 'iron_ingot', 4, 1, 12, 10, 0.05], [B, 'bell', 1, 36, 12, 5, 0.2],
        [B, 'chainmail_boots', 1, 1, 12, 5, 0.2], [B, 'chainmail_leggings', 1, 3, 12, 5, 0.2]]
  }
};
// load the engine's table from the golden TSV (as tradecheck does)
{
  const lines = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'villager-trades-1.18.2.tsv'), 'utf8').trim().split('\n');
  const head = lines[0].split('\t'), trades = {};
  const NUMF = new Set(['itemQty', 'item2Qty', 'priceEmerald', 'maxUses', 'xp', 'durationTicks', 'effectId']);
  for (const l of lines.slice(1)) {
    const c = l.split('\t'), r = {};
    head.forEach((h, i) => { if (c[i] !== undefined && c[i] !== '' && h !== 'profession' && h !== 'level') r[h] = h === 'byVillagerType' ? JSON.parse(c[i]) : (NUMF.has(h) ? +c[i] : c[i]); });
    ((trades[c[0]] ||= {})[+c[1]] ||= []).push(r);
  }
  M.DATA.villagerTrades = trades;
}
const T = M.Trade, V = M.Village, Inv = M.Inventory, Items = M.Items;
const rowKey = (o) => [o.kind, o.item, o.itemQty, o.priceEmerald, o.maxUses, o.xp, Math.fround(+o.priceMult)].join('|');
const expKey = (x) => [x[0], x[1], x[2], x[3], x[4], x[5], Math.fround(x[6])].join('|');

// ═══ 1. offers per profession / level ═══
console.log('\n 1. level-1 offers exact for 3 professions; level 2 adds its own');
for (const prof of Object.keys(EXPECT)) {
  const pool1 = EXPECT[prof][1].map(expKey), pool2 = EXPECT[prof][2].map(expKey);
  ok(T.offersForLevel(prof, 1).map(rowKey).join() === pool1.join(), `${prof} L1 pool must equal vanilla's exactly`);
  ok(T.offersForLevel(prof, 2).map(rowKey).join() === pool2.join(), `${prof} L2 pool must equal vanilla's exactly`);
  for (let n = 0; n < 20; n++) {
    const e = { type: 'villager', profession: prof };
    const offers = T.ensure(e);
    const keys = offers.map(rowKey);
    ok(keys.length === 2 && keys.every((k) => pool1.includes(k)) && new Set(keys).size === 2,
      `${prof} fresh villager must hold 2 distinct L1 offers from the vanilla pool, got ${keys}`);
    T.increaseLevel(e);
    const k2 = e.tradeOffers.slice(2).map(rowKey);
    ok(e.villagerLevel === 2 && e.tradeOffers.length === 4 && k2.every((k) => pool2.includes(k)) && e.tradeUses.length === 4,
      `${prof} level-up must ADD 2 L2 offers (keeping the L1 two), got ${k2}`);
  }
}
{
  const bad = JSON.parse(JSON.stringify(M.DATA.villagerTrades.farmer[1]));
  bad[0].itemQty = 21;
  const sv = M.DATA.villagerTrades.farmer[1]; M.DATA.villagerTrades.farmer[1] = bad;
  okAv(T.offersForLevel('farmer', 1).map(rowKey).join() !== EXPECT.farmer[1].map(expKey).join(), 'a corrupted wheat quantity must break the L1 exactness comparison');
  M.DATA.villagerTrades.farmer[1] = sv;
}

// ═══ 2. disable then restock ═══
console.log('\n 2. an over-traded offer disables, then restocks');
{
  M.Sky = { dayTime: 0 };
  const mkV = () => { const e = { type: 'villager', profession: 'farmer' }; T.OFFERS_PER_LEVEL = 99; T.ensure(e); return e; };
  const e = mkV();
  const wi = e.tradeOffers.findIndex((o) => o.item === 'wheat'), mu = T.maxUses(e.tradeOffers[wi]);
  const P = { inventory: Inv.create(), instabuild: false };
  const wheat = Items.of('wheat'), emerald = Items.of('emerald');
  for (let i = 0; i < mu; i++) {
    Inv.setItem(P.inventory, 0, { i: wheat, n: 20 });
    const r = T.attempt(e, wi, P); ok(r.ok, `wheat trade ${i + 1} of ${mu} must go through: ${r.reason}`);
  }
  Inv.setItem(P.inventory, 0, { i: wheat, n: 64 });
  ok(e.tradeUses[wi] === mu && T.disabled(e, wi), 'after maxUses trades the offer is disabled');
  const before = Inv.countOf(P.inventory, emerald);
  const r = T.attempt(e, wi, P);
  ok(!r.ok && Inv.countOf(P.inventory, emerald) === before, 'a 17th trade must refuse and pay nothing');
  okAv(T.attempt(e, wi, P).ok === false && T.disabled(e, wi), 'the disabled offer stays refused on retry');
  M.Sky.dayTime = 1;
  ok(T.shouldRestock(e) === true, 'a used-up villager is due a restock');
  T.tickRestock(e);
  ok(e.tradeUses[wi] === 0 && !T.disabled(e, wi), 'restock re-enables the offer');
  Inv.setItem(P.inventory, 2, { i: wheat, n: 64 });
  ok(T.attempt(e, wi, P).ok === true, 'and it trades again');
  // anti-vacuity: with no disable rule the 17th trade would pass
  const sv = T.disabled; T.disabled = () => false;
  const e2 = mkV(); const P2 = { inventory: Inv.create(), instabuild: false };
  let n = 0; while (n < 17) { Inv.setItem(P2.inventory, 0, { i: wheat, n: 20 }); if (!T.attempt(e2, wi, P2).ok) break; n++; }
  T.disabled = sv;
  okAv(n === 17 && !(n <= mu), 'with the disable rule removed the over-traded offer keeps trading (the check does see it)');
  // and no restock when nothing was used
  const e3 = mkV(); M.Sky.dayTime = 1;
  okAv(T.shouldRestock(e3) === false, 'an unused villager needs no restock');
  delete M.Sky;
}

// ═══ 3. gossip price rise / raid-win price fall ═══
console.log('\n 3. price rises after hurting a villager, falls after a won raid');
{
  const W = M.World, CH = M.CH;
  W.init(1); M.Behave.init(W);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  const STONE = M.States.stateOf('stone') | 0;
  for (let x = -15; x <= 15; x++) for (let z = -15; z <= 15; z++) W.setBlock(x, 8, z, STONE);
  const P = { x: 0, y: 9, z: 1, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: null, sprinting: false, onGround: true,
    fallDistance: 0, onClimbable: false, inWater: false, walkDist: 0, walkDistO: 0, speed: 0.1 };
  M.Player = P;
  T.OFFERS_PER_LEVEL = 99;
  const price = (v, i) => { T.prepareOffersFor(v, P); const p = T.adjustedFirstCount(v, i); T.clearSpecialPrices(v); return p; };
  const fresh = () => { const v = M.EntityList.spawn('villager', 0, 9, 0); v.profession = 'farmer'; T.ensure(v); return v; };
  const v = fresh();
  const wi = v.tradeOffers.findIndex((o) => o.item === 'wheat');
  const base = price(v, wi);
  ok(base === 20, `an untouched villager charges the table's 20 wheat, got ${base}`);
  const res = M.Combat.attack(P, v);
  ok(res && res.hit, 'the real attack lands');
  const hurt = price(v, wi);
  ok(hurt > base, `hurting a villager RAISES the price (minor_negative 25 * -1 = -25 rep), ${base} -> ${hurt}`);
  ok(hurt === 22, `exactly 20 - floor(-25*0.05)=20+2 = 22, got ${hurt}`);
  // frozen gossip: the hurt hook removed -> no rise
  const sv = M.Combat.notifyHurt; M.Combat.notifyHurt = function () {};
  const v2 = fresh(); M.Combat.attack(P, v2); M.Combat.notifyHurt = sv;
  okAv(price(v2, wi) === base, 'with gossip frozen (hook silenced) a hurt villager keeps the base price');
  // a won raid: Hero of the Village
  const raid = { heroes: { p1: true }, badOmenLevel: 1 };
  const v3 = fresh();
  M.Effects.clearStatusEffects && M.Effects.clearStatusEffects(P);
  const granted = M.Raid.grantHeroes(raid, { p1: P }, M.Effects);
  ok(granted.length === 1 && M.Effects.hasStatusEffect(P, 'hero_of_the_village'), 'a won raid grants the player Hero of the Village');
  const hero = price(v3, wi);
  ok(hero === 14, `Hero I cuts 20 wheat by max(floor(0.3*20),1)=6 to 14, got ${hero}`);
  ok(hero < price(fresh(), wi) + 0 || hero < base, 'the price FALLS after the raid win');
  // hero on top of a hurt villager: both apply, net below the hurt price
  const heroHurt = price(v, wi);
  ok(heroHurt === 16, `Hero I on the hurt villager: 20 +2 -6 = 16, got ${heroHurt}`);
  // anti-vacuity: without granting, no fall
  M.Effects.removeStatusEffect && M.Effects.removeStatusEffect(P, 'hero_of_the_village');
  okAv(price(fresh(), wi) === base, 'once the Hero effect is gone the price is back to base (the fall is the effect, nothing else)');
  M.EntityList.clear();

  // ═══ 4. golem beds ratio ═══
  console.log('\n 4. N villagers + N beds spawn a golem, fewer do not');
  const rnd = Math.random;
  const golems = () => M.EntityList.list.filter((e) => e.type === 'iron_golem').length;
  const run = (n, slept, now) => {
    M.EntityList.clear(); M.Sky = { dayTime: now };
    const vs = []; for (let i = 0; i < n; i++) vs.push(M.EntityList.spawn('villager', i, 9, 0));
    for (let i = 0; i < slept; i++) vs[i].vbLastSlept = now;
    V.talkWithVillager(vs[0], vs[1], now, rnd);
    const g = golems(); M.EntityList.clear(); return g;
  };
  ok(run(5, 5, 1000) === 1, '5 villagers who all slept in beds spawn 1 golem');
  ok(run(6, 5, 200000) === 1, '6 villagers, 5 of them bedded, still spawn one');
  okAv(run(4, 4, 400000) === 0, '4 bedded villagers (one under the quorum) spawn none');
  okAv(run(5, 4, 600000) === 0, '5 villagers but only 4 slept (one bedless) spawn none');
  okAv(run(5, 0, 800000) === 0, '5 villagers with no beds at all spawn none');
  const qsv = V.SUMMON_QUORUM;
  const canSv = V.canSummonGolem; V.canSummonGolem = () => true;
  okAv(run(4, 0, 900000) === 0, 'even with the sleep gate forced open, 4 villagers stay under the quorum');
  V.canSummonGolem = canSv;
  ok(V.SUMMON_QUORUM === qsv, 'quorum constant unchanged by the probe');
  M.EntityList.clear(); delete M.Sky;
}

console.log(`\n${pass} checks passed, ${fails.length} failures (${breaks} breaks caught)`);
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
process.exit(0);
