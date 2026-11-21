#!/usr/bin/env node
// wtradercheck.mjs — loop/wtrader-s103 (QUEUE 0.2 G18e/Breed remainder): the WANDERING TRADER +
// TRADER LLAMA + WanderingTraderManager, whole. Drives the REAL modules (07zt_wtrader.js's
// NS.WT, 07ze_llama.js's Ll.DefendTraderGoal/tickTraderLlamaDespawn, the {kind:'entity'} leash
// holder in 07u_leash.js, and the llama/trader_llama cross-mate exception in 07m_breed.js)
// against `.decomp/net/minecraft/entity/passive/WanderingTraderEntity.java`,
// `.decomp/net/minecraft/world/WanderingTraderManager.java` and
// `.decomp/net/minecraft/entity/passive/TraderLlamaEntity.java` (all read whole).
//
//   node tools/wtradercheck.mjs [--verbose]
//
// Sections:
//   1. TRADES_POOL1/POOL2 -- shape (62/6 rows, every row a real registered item)
//   2. WT.rollTrades -- 5 distinct-index draw from pool1 + 1 from pool2, via Trade.pickFromPool
//   3. WT.attempt -- the trade itself: affordable trades, unaffordable/sold-out refuses, both
//      directions, inventory unchanged on refusal
//   4. WT.tickEntity -- despawnDelay counts to zero and removes the trader
//   5. DrinkInvisibilityGoal/DrinkMilkGoal -- the night/day + invisible-state gate, one-shot
//   6. WanderToTargetGoal -- engages while far from the target, stops once close, walks toward it
//   7. WT.fleeGoals -- the seven FleeEntityGoal rows; the zombie row engages and walks away
//   8. WT.tickManager -- the countdown/spawnChance-step/1-in-10 math, a full spawn (trader + 2
//      leashed trader llamas), the {kind:'entity'} leash holder and its render anchor
//   9. Ll.DefendTraderGoal / Ll.tickTraderLlamaDespawn -- targets the nearest thing near a
//      just-hurt trader; despawn ties to the holding trader's own countdown
//  10. Breed cross-mate -- llama x trader_llama mates, Breed.SPECIAL.trader_llama is gone
//  11. anti-vacuity -- break the module's own data/state and watch each check catch it

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   done ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('wtradercheck -- loop/wtrader-s103, wandering trader + trader llama + manager, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '07m_breed.js', '07n_tame.js', '07o_profession.js', '07ox_enchhelper.js', '07p_trade.js', '07q_effects.js',
               '09b_sky.js', '07r_mount.js', '07u_leash.js', '07ze_llama.js', '07zt_wtrader.js', '07zu_poi.js', '07zz_xporb.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const WT = MCL.WT, Ll = MCL.Llama, Breed = MCL.Breed, Trade = MCL.Trade, ES = MCL.Effects;
const Ls = MCL.Leash, Sky = MCL.Sky, Inv = MCL.Inventory, W = MCL.World, S = MCL.States, CH = MCL.CH;
const PH = MCL.Physics;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();
ES.ready = true;
Trade.ready = true;
MCL.Xp.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

function fresh(type, x, y, z) {
  const e = EL.spawn(type, x === undefined ? 0.5 : x, y === undefined ? 5 : y, z === undefined ? 0.5 : z);
  ES.initEntity(e);
  return e;
}

// ── 1. THE TWO TRADE POOLS ───────────────────────────────────────────────────────────────────
ok(WT.TRADES_POOL1.length === 62, '§1 TRADES_POOL1 has 62 rows, got ' + WT.TRADES_POOL1.length);
ok(WT.TRADES_POOL2.length === 6, '§1 TRADES_POOL2 has 6 rows, got ' + WT.TRADES_POOL2.length);
{
  let allReal = true, allKind = true;
  for (const r of WT.TRADES_POOL1.concat(WT.TRADES_POOL2)) {
    if (MCL.Items.of(r.item) < 0) allReal = false;
    if (r.kind !== 'buy_item_for_emerald') allKind = false;
  }
  ok(allReal, '§1 every pool row names a real registered item');
  ok(allKind, '§1 every pool row is the buy_item_for_emerald kind (SellItemFactory\'s real shape)');
}

// ── 1b. #5909: pools diffed row by row against the extracted .decomp golden ──────────────────
{
  const { extract } = await import('./extract-wtrader-trades.mjs');
  const G = extract();   // re-extracted live from .decomp, so a stale golden cannot hide drift
  const diff = (pools) => {
    const out = [];
    for (const pool of [1, 2]) {
      const g = G.rows.filter((r) => r.pool === pool), w = pools[pool - 1];
      if (g.length !== w.length) out.push('pool' + pool + ' length ' + w.length + ' != ' + g.length);
      g.forEach((r, i) => {
        const x = w[i]; if (!x) return;
        if (x.item !== r.id || x.priceEmerald !== r.price || x.itemQty !== r.count ||
            x.maxUses !== r.maxUses || x.xp !== r.xp || x.priceMult !== r.mult) out.push('pool' + pool + ' row ' + i + ' (' + r.id + ')');
      });
    }
    return out;
  };
  const d0 = diff([WT.TRADES_POOL1, WT.TRADES_POOL2]);
  ok(d0.length === 0, '#5909 WT pools differ from .decomp: ' + d0.join('; '));
  ok(G.from1 === WT.OFFERS_FROM_POOL1 && G.from1 === 5 && G.from2 === 1, '#5909 pool selection counts 5 + 1 match WanderingTraderEntity.fillRecipes');
  for (const f of ['item', 'priceEmerald', 'itemQty', 'maxUses', 'xp', 'priceMult']) {
    const p1 = WT.TRADES_POOL1.map((r) => Object.assign({}, r));
    p1[7][f] = typeof p1[7][f] === 'string' ? 'stone' : p1[7][f] + 1;
    okAv(diff([p1, WT.TRADES_POOL2]).length === 1, '#5909 a mutated ' + f + ' in one pool row must be reported');
  }
  okAv(diff([WT.TRADES_POOL1, WT.TRADES_POOL2.slice(1)]).length > 0, '#5909 a dropped pool-2 row must be reported');
}

// ── 2. WT.rollTrades ─────────────────────────────────────────────────────────────────────────
{
  let seq = 0;
  const seeded = () => { seq = (seq * 1103515245 + 12345) & 0x7fffffff; return seq / 0x7fffffff; };
  const offers = WT.rollTrades({ type: 'wandering_trader' }, seeded);
  ok(offers.length === 6, '§2 rollTrades returns 6 offers (5 + 1), got ' + offers.length);
  const items1 = offers.slice(0, 5).map((o) => o.item);
  ok(new Set(items1).size === 5, '§2 the first 5 offers are distinct items (pickFromPool\'s own HashSet draw)');
  ok(WT.TRADES_POOL2.some((r) => r.item === offers[5].item), '§2 the 6th offer comes from pool 2');
  for (const o of offers) ok(o.kind === 'buy_item_for_emerald', '§2 every resolved offer keeps its kind');
}

// ── 3. WT.attempt ────────────────────────────────────────────────────────────────────────────
{
  const trader = fresh('wandering_trader');
  let seq3 = 1;
  const rng3 = () => { seq3 = (seq3 * 1103515245 + 12345) & 0x7fffffff; return seq3 / 0x7fffffff; };
  WT.ensureTrades(trader, rng3);   // a real varying RNG -- a constant one loops forever in Trade.pickFromPool's own HashSet draw
  const off = trader.tradeOffers[0];
  const P = { inventory: Inv.create(), instabuild: false };
  const before = Inv.toJSON(P.inventory);

  // not enough emerald -> refuse, inventory untouched
  let res = WT.attempt(trader, 0, P);
  ok(res.ok === false, '§3 no emerald -> refused');
  ok(JSON.stringify(Inv.toJSON(P.inventory)) === JSON.stringify(before), '§3 refused trade leaves inventory unchanged');

  // give enough emerald, trade succeeds
  const emeraldId = MCL.Items.of('emerald');
  Inv.setItem(P.inventory, 0, { i: emeraldId, n: off.priceEmerald, d: 0 });
  const orbsBefore = (EL.list || []).filter(o => o.type === 'experience_orb').length;
  res = WT.attempt(trader, 0, P);
  ok(res.ok === true, '§3 with enough emerald -> succeeds');
  const orbs = (EL.list || []).filter(o => o.type === 'experience_orb' && !o.removed);
  ok(orbs.length > orbsBefore, '§3 a completed trade spawns an xp orb');
  ok(orbs.reduce((a, o) => a + o.value * (o.pickingCount || 1), 0) === res.orb, '§3 orbs total the reported 3..6');
  ok(Inv.countOf(P.inventory, emeraldId) === 0, '§3 the emerald is spent');
  ok(Inv.countOf(P.inventory, MCL.Items.of(off.item)) === off.itemQty, '§3 the bought item lands in the inventory');
  ok(trader.tradeUses[0] === 1, '§3 tradeUses[0] bumped to 1');
  ok(res.orb >= 3 && res.orb <= 6, '§3 afterUsing orb value 3..6');

  // sold out once maxUses is reached
  trader.tradeUses[0] = off.maxUses;
  Inv.setItem(P.inventory, 0, { i: emeraldId, n: off.priceEmerald, d: 0 });
  res = WT.attempt(trader, 0, P);
  ok(res.ok === false && res.reason === 'sold out', '§3 an offer at maxUses refuses as sold out');
}

// ── 4. WT.tickEntity — despawn ───────────────────────────────────────────────────────────────
{
  // #2404: a trader without a manager spawn has despawnDelay 0 (vanilla field default) and never despawns
  const eg = fresh('wandering_trader');
  for (let t = 0; t < 100; t++) WT.tickEntity(eg);
  ok(eg.despawnDelay === 0 && !eg.removed, '#2404 summoned trader keeps despawnDelay 0 and survives');
  const eg2 = fresh('wandering_trader'); eg2.despawnDelay = 48000;
  WT.tickEntity(eg2);
  okAv(eg2.despawnDelay !== 0, '#2404 a trader with a delay does count down (check can fail)');
  const trader = fresh('wandering_trader');
  trader.despawnDelay = 3;
  WT.tickEntity(trader); ok(trader.despawnDelay === 2 && !trader.removed, '§4 despawnDelay counts down (3->2)');
  WT.tickEntity(trader); WT.tickEntity(trader);
  ok(trader.removed === true, '§4 the trader discards once despawnDelay reaches 0');
}

// ── 5. DrinkInvisibilityGoal / DrinkMilkGoal ────────────────────────────────────────────────
{
  const trader = fresh('wandering_trader');
  const realIsDay = Sky.isDay, realIsNight = Sky.isNight;
  Sky.isDay = () => false; Sky.isNight = () => true;   // night
  const invisGoal = new WT.DrinkInvisibilityGoal(trader);
  ok(invisGoal.canUse() === true, '§5 DrinkInvisibilityGoal engages at night while not invisible');
  invisGoal.start();
  // D-567: HoldInHandsGoal is a 32-tick USE now, not a one-shot (PotionItem.getMaxUseTime 32)
  const IT = MCL.Items, Eq = MCL.Equip;
  const held = () => { const st = Eq && Eq.getEquipped(trader, IT.MAINHAND); return st ? IT.nameOf(st.i) : null; };
  ok(held() === 'potion', `§5 start() puts the potion in the MAIN hand (got ${held()})`);
  ok(!ES.hasStatusEffect(trader, 'invisibility'), '§5 no invisibility at start -- the effect waits for finishUsing');
  ok(invisGoal.canContinueToUse() === true, '§5 the goal continues while the item is in use (isUsingItem)');
  for (let t = 0; t < 31; t++) WT.tickEntity(trader);
  ok(!ES.hasStatusEffect(trader, 'invisibility'), '§5 still not invisible after 31 ticks');
  WT.tickEntity(trader);
  ok(ES.hasStatusEffect(trader, 'invisibility'), '§5 invisible on tick 32 exactly');
  ok(ES.getStatusEffect(trader, 'invisibility').duration === WT.INVIS_DURATION, '§5 for Potions.INVISIBILITY\'s 3600 ticks');
  ok(invisGoal.canContinueToUse() === false, '§5 the use is over -> the goal stops');
  invisGoal.stop();
  ok(held() === null, '§5 stop() empties the main hand');
  ok(invisGoal.canUse() === false, '§5 it no longer engages once already invisible');

  Sky.isDay = () => true; Sky.isNight = () => false;    // day, still invisible from the night before
  ES.addStatusEffect(trader, 'speed', 600, 0, false, true);
  const milkGoal = new WT.DrinkMilkGoal(trader);
  ok(milkGoal.canUse() === true, '§5 DrinkMilkGoal engages by day while invisible');
  milkGoal.start();
  ok(held() === 'milk_bucket', `§5 the milk bucket goes in the main hand (got ${held()})`);
  for (let t = 0; t < 32; t++) WT.tickEntity(trader);
  ok(!ES.hasStatusEffect(trader, 'invisibility'), '§5 the milk clears invisibility after 32 ticks');
  ok(!ES.hasStatusEffect(trader, 'speed'), '§5 and EVERY other effect too -- clearStatusEffects (MilkBucketItem.java:32)');
  milkGoal.stop();
  ok(milkGoal.canUse() === false, '§5 it no longer engages once no longer invisible');
  // anti-vacuity: a zero-length use would land the effect at start -- the tick-32 assertion must see it
  const savedUse = WT.USE_TIME; WT.USE_TIME = 1;
  const t2 = fresh('wandering_trader'); Sky.isDay = () => false; Sky.isNight = () => true;
  const g2 = new WT.DrinkInvisibilityGoal(t2); g2.start(); WT.tickEntity(t2);
  WT.USE_TIME = savedUse;
  okAv(ES.hasStatusEffect(t2, 'invisibility'), '§5 a 1-tick use lands after one tick -- the 31-tick "still visible" assertion is live');
  Sky.isDay = realIsDay; Sky.isNight = realIsNight;
  // fixed-time dimension (Nether): World.isNight()/isDay() are both false whatever the overworld clock says
  const realCur = MCL.Dim.cur, realDt = Sky.dayTime;
  MCL.Dim.cur = 'the_nether'; Sky.dayTime = 18000;
  const nt = fresh('wandering_trader');
  ok(new WT.DrinkInvisibilityGoal(nt).canUse() === false, '§5 no invisibility drink in a fixed-time dimension at overworld night');
  ES.addStatusEffect(nt, 'invisibility', 600, 0, false, true);
  ok(new WT.DrinkMilkGoal(nt).canUse() === false, '§5 no milk drink in a fixed-time dimension either');
  MCL.Dim.cur = 'overworld';
  okAv(new WT.DrinkInvisibilityGoal(fresh('wandering_trader')).canUse() === true, '§5 same clock in the overworld drinks -- the fixed-time assertion is live');
  MCL.Dim.cur = realCur; Sky.dayTime = realDt;
}

// ── 5b. sounds ──────────────────────────────────────────────────────────────────────────────
{
  const heard = [];
  const realMs = MCL.Sound && MCL.Sound.mobSound;
  MCL.Sound = MCL.Sound || {};
  MCL.Sound.mobSound = (e, ev) => { heard.push(ev); return true; };
  const realIsDay = Sky.isDay, realIsNight = Sky.isNight;
  const run = (day, G) => {
    Sky.isDay = () => day; Sky.isNight = () => !day; heard.length = 0;
    const t = fresh('wandering_trader'); if (day) ES.addStatusEffect(t, 'invisibility', 600, 0, false, true);
    const g = new G(t); g.start(); for (let i = 0; i < 32; i++) WT.tickEntity(t); g.stop();
    return heard.slice();
  };
  const a = run(false, WT.DrinkInvisibilityGoal), b = run(true, WT.DrinkMilkGoal);
  ok(a.filter(x => x === 'entity.wandering_trader.drink_potion').length === 6, '§5b potion use plays drink_potion 6 times (left 24,20..4) got ' + a.length);
  ok(a[a.length - 1] === 'entity.wandering_trader.disappeared', '§5b potion goal stop plays disappeared (field_18315)');
  ok(b.filter(x => x === 'entity.wandering_trader.drink_milk').length === a.length - 1, '§5b milk use plays drink_milk');
  ok(b[b.length - 1] === 'entity.wandering_trader.reappeared', '§5b milk goal stop plays reappeared (field_18314)');
  const savedS = WT.sound; WT.sound = () => {};
  okAv(run(false, WT.DrinkInvisibilityGoal).length === 0, '§5b muting WT.sound silences the goal -- the sound assertions are live');
  WT.sound = savedS; Sky.isDay = realIsDay; Sky.isNight = realIsNight; MCL.Sound.mobSound = realMs;
}

// ── 6. WanderToTargetGoal ────────────────────────────────────────────────────────────────────
{
  Ai.__testAllWalkable = true;   // this check's synthetic world has no real terrain -- the same anti-vacuity hook goalcheck.mjs uses for a floor-free path test
  const trader = fresh('wandering_trader', 0.5, 5, 0.5);
  const g = new WT.WanderToTargetGoal(trader, 2.0, 0.35);
  trader.wanderTarget = null;
  ok(g.canUse() === false, '§6 no wander target -> does not engage');
  trader.wanderTarget = { x: trader.x + 20, y: trader.y, z: trader.z };
  ok(g.canUse() === true, '§6 a far wander target -> engages');
  g.start();
  const startDist = Math.hypot(trader.wanderTarget.x - trader.x, trader.wanderTarget.z - trader.z);
  for (let i = 0; i < 200 && g.canContinueToUse(); i++) { trader.zza = 0; g.tick(); PH.travelMob(trader); }
  const endDist = Math.hypot(trader.wanderTarget.x - trader.x, trader.wanderTarget.z - trader.z);
  ok(endDist < startDist, '§6 ticking the goal walks the trader toward its wander target (' + startDist.toFixed(1) + ' -> ' + endDist.toFixed(1) + ')');

  const trader2 = fresh('wandering_trader', 0.5, 5, 0.5);
  trader2.wanderTarget = { x: trader2.x + 1, y: trader2.y, z: trader2.z };   // inside proximityDistance
  const g2 = new WT.WanderToTargetGoal(trader2, 2.0, 0.35);
  ok(g2.canUse() === false, '§6 a wander target already within proximityDistance -> does not engage');
  {
    const t3 = fresh('wandering_trader', 0.5, 5, 0.5);
    t3.wanderTarget = { x: Math.floor(t3.x) + 30, y: Math.floor(t3.y) + 40, z: Math.floor(t3.z) };
    const g3 = new WT.WanderToTargetGoal(t3, 2.0, 0.35);
    g3.start(); g3.tick();
    const o = g3.lastOrder, dx = 30 - 0.5 + Math.floor(t3.x) - Math.floor(t3.x), dy = t3.wanderTarget.y - t3.y, len = Math.hypot(30 - (t3.x - Math.floor(t3.x)), dy);
    ok(o && Math.abs(Math.hypot(o.x - t3.x, o.y - t3.y, o.z - t3.z) - 10) < 1e-6 && o.y > t3.y + 5, '§6 far target with dy: intermediate waypoint is the 3D-normalised 10-block step (' + (o && o.y.toFixed(2)) + ')');
  }
  Ai.__testAllWalkable = false;
}

// ── 7. FleeHostilesGoal ──────────────────────────────────────────────────────────────────────
{
  Ai.__testAllWalkable = true;
  const solidWas = PH.solidAt;
  PH.solidAt = (x, y, z) => y < 5 || solidWas(x, y, z);   // a floor under y=5: findFrom's isValidPosition needs one
  const trader = fresh('wandering_trader', 0.5, 5, 0.5);
  const zombie = fresh('zombie', trader.x + 3, trader.y, trader.z);
  const gs7 = WT.fleeGoals(trader);
  ok(gs7.length === 7, '§7 seven FleeEntityGoal rows (WanderingTraderEntity.java:73-79)');
  const g = gs7[Object.keys(WT.FLEE_TYPES).indexOf('zombie')];
  let engaged = false;
  for (let i = 0; i < 60 && !engaged; i++) engaged = g.canUse();   // the escape pick is random: most draws miss the floor
  ok(engaged === true, '§7 a zombie within 8 blocks -> the zombie row engages');
  g.start();
  const startDist = Math.hypot(zombie.x - trader.x, zombie.z - trader.z);
  for (let i = 0; i < 40 && g.canContinueToUse(); i++) { trader.zza = 0; g.tick(); PH.travelMob(trader) }
  const endDist = Math.hypot(zombie.x - trader.x, zombie.z - trader.z);
  ok(endDist > startDist, '§7 ticking it walks the trader AWAY from the zombie (' + startDist.toFixed(1) + ' -> ' + endDist.toFixed(1) + ')');

  const far = fresh('wandering_trader', 100, 5, 100);
  ok(WT.fleeGoals(far).every((x) => x.canUse() === false), '§7 no hostile within range -> no row engages');
  PH.solidAt = solidWas;
  Ai.__testAllWalkable = false;
}

// ── 8. WT.tickManager ────────────────────────────────────────────────────────────────────────
{
  WT.resetManager();
  ok(WT.Manager.spawnTimer === 1200 && WT.Manager.spawnDelay === 24000 && WT.Manager.spawnChance === 25,
    '§8 resetManager restores the constructor defaults (1200/24000/25)');

  { const base = { players: () => [{ x: 8.5, y: 5, z: 8.5 }], heightAt: () => 5, spawnFn: () => ({}) };
    const p0 = { x: 3, y: 5, z: 3 };
    ok(WT.doesNotSuffocateAt(Object.assign({ collisionEmpty: () => true }, base), p0), '§14 empty 2x3x2 volume passes');
    let n = 0;
    for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 2; dy++) for (let dz = 0; dz <= 1; dz++) {
      const c = Object.assign({ collisionEmpty: (x, y, z) => !(x === 3 + dx && y === 5 + dy && z === 3 + dz) }, base);
      okAv(!WT.doesNotSuffocateAt(c, p0), '§14 blocked cell ' + [dx, dy, dz] + ' rejects'); n++;
    }
    ok(n === 12, '§14 all 12 cells probed'); }
  const player = { x: 8.5, y: 5, z: 8.5 };
  let calls = 0;
  const spawnedThisPass = [];
  const spawnFn = (type, x, y, z) => { calls++; const e = fresh(type, x, y, z); spawnedThisPass.push(e); return e; };
  const baseCtx = {
    players: () => [player],
    heightAt: () => 5,
    isSpawnable: () => true,
    collisionEmpty: () => true,
    spawnFn
  };

  // trySpawn sets the trader's 16-block home at the wander target (.decomp:110)
  const homeMade = [];
  WT.trySpawn(Object.assign({}, baseCtx, { spawnFn: (type, x, y, z) => { const e = fresh(type, x, y, z); homeMade.push(e); return e; } }), () => 0);
  const tsp = homeMade[0];
  ok(!!tsp && tsp.positionTargetRange === 16 && tsp.positionTarget && tsp.wanderTarget &&
    tsp.positionTarget.x === tsp.wanderTarget.x && tsp.positionTarget.z === tsp.wanderTarget.z,
    '§8 trySpawn gives the trader a home of radius 16 at the wander target');
  if (tsp) { const sv = tsp.positionTargetRange; tsp.positionTargetRange = undefined;
    okAv(!(tsp.positionTargetRange === 16), 'a trader with its home removed fails the radius-16 assertion'); tsp.positionTargetRange = sv; }

  // #3843: a bell (MEETING POI) within 48 re-centres the spawn search, wanderTarget and home
  {
    const P = MCL.Poi, real = P.getPosition, bell = { x: 38, y: 5, z: 8 };
    const run = () => { const out = []; WT.trySpawn(Object.assign({}, baseCtx, { spawnFn: (t, x, y, z) => { const e = fresh(t, x, y, z); out.push(e); return e; } }), () => 0); return out[0]; };
    P.getPosition = () => bell;
    const t = run();
    ok(!!t && t.wanderTarget.x === 38 && t.wanderTarget.z === 8 && t.positionTarget.x === 38, '§14 trySpawn centres wanderTarget/home on the bell');
    P.getPosition = () => null;
    const t2 = run();
    okAv(!!t2 && t2.wanderTarget.x === 8, '§14 with no bell the player block is the origin');
    P.getPosition = real;
    okAv(!(t && t.wanderTarget.x === 8), '§14 a trader centred on the player fails the bell assertion');
  }

  // roster priorities + customer state (#1306)
  const rg = WT.rosterGoals(fresh('wandering_trader', 0, 64, 0), { random: () => 0.5, players: () => [], entities: () => [] });
  const pr = rg.entries.map(x => x.priority).sort((p, q) => p - q).join(',');
  ok(pr === '0,0,0,1,1,1,1,1,1,1,1,1,1,2,4,8,9,10', '§8 roster priorities 0x3,1x10,2,4,8,9,10 (got ' + pr + ')');
  okAv(!(rg.entries.slice(1).map(x => x.priority).sort((p, q) => p - q).join(',') === '0,0,0,1,1,1,1,1,1,1,1,1,1,2,4,8,9,10'), 'a roster missing a goal fails the priority list');
  const wg = (rg.entries.find(x => x.priority === 8) || {}).goal;
  ok(!!wg && wg.probability === 0.001 && wg.dryRadius === 10 && wg.waterRadius === 15, '#2981 priority-8 goal is Ai.WanderAroundFarGoal (probability 0.001, 10/7 + 15/7 finders)');
  okAv(!(wg && { probability: 0.5, dryRadius: 10, waterRadius: 15 }.probability === 0.001), 'a plain stroll goal / wrong probability fails the priority-8 assertion');
  // #4345: StopAndLookAtEntityGoal(Player,3,1) has chance 1.0, so a player 2 blocks away is looked at on the first tick
  const lookCanUse = (r) => { const e = fresh('wandering_trader', 0, 64, 0); const g = WT.rosterGoals(e, { random: r, players: () => [{ x: 2, y: 64, z: 0 }], entities: () => [] }).entries.find(x => x.priority === 9).goal; return g.canUse(); };
  ok(lookCanUse(() => 0.5) === true, '#4345 trader priority-9 look goal starts on a roll of 0.5 (chance 1.0)');
  okAv(new Ai.LookAtPlayerGoal(fresh('wandering_trader', 0, 64, 0), () => [{ x: 2, y: 64, z: 0 }], 3.0, () => 0.5).canUse() === false, 'the default 0.02 chance rejects a 0.5 roll (what the trader did before)');
  const tc = fresh('wandering_trader', 0, 64, 0); tc.despawnDelay = 48000; WT.tickEntity(tc); const d0 = tc.despawnDelay;
  WT.setCustomer(tc, { x: 1, y: 64, z: 0 }); WT.tickEntity(tc);
  ok(tc.despawnDelay === d0, '§8 despawn timer pauses while a customer is trading');
  WT.setCustomer(tc, null); WT.tickEntity(tc);
  okAv(tc.despawnDelay === d0 - 1, 'without a customer the timer counts');

  { // #5327: StopFollowingCustomerGoal needs the customer's currentScreenHandler
    const sg = (cust) => { const e = fresh('wandering_trader', 0, 64, 0); e.onGround = true; WT.setCustomer(e, cust); return new WT.StopFollowingCustomerGoal(e).canUse(); };
    ok(sg({ x: 1, y: 64, z: 0, currentScreenHandler: {} }) === true, '#5327 customer with a screen handler stops the trader');
    okAv(sg({ x: 1, y: 64, z: 0, currentScreenHandler: null }) === false, '#5327 customer who closed the screen (no handler) does not stop the trader');
  }

  // spawnTimer above 0 -> no-op, just counts down (WanderingTraderManager.spawn's own `if
  // (--spawnTimer > 0) return 0`)
  WT.Manager.spawnTimer = 5; WT.Manager.spawnDelay = 24000;
  let r = WT.tickManager(Object.assign({}, baseCtx, { rand: () => 0.99 }));
  ok(r === 0 && WT.Manager.spawnTimer === 4 && calls === 0, '§8 spawnTimer > 0 -> just counts down, no spawn attempt');

  // spawnTimer reaches 0 but spawnDelay is still > 0 -> resets spawnTimer, no spawn
  WT.Manager.spawnTimer = 1; WT.Manager.spawnDelay = 5000;
  r = WT.tickManager(Object.assign({}, baseCtx, { rand: () => 0.99 }));
  ok(r === 0 && WT.Manager.spawnTimer === 1200 && WT.Manager.spawnDelay === 3800 && calls === 0,
    '§8 spawnTimer elapsing resets it to 1200 and drops spawnDelay by 1200, still no spawn while spawnDelay > 0');

  // spawnDelay ALSO reaches 0: spawnChance steps by 25 (clamped), TESTED at the PREVIOUS value --
  // a roll over that previous value still refuses
  WT.Manager.spawnTimer = 1; WT.Manager.spawnDelay = 1200; WT.Manager.spawnChance = 25;
  r = WT.tickManager(Object.assign({}, baseCtx, { rand: () => 0.30 }));   // 30 > 25 (the PREVIOUS chance)
  ok(r === 0 && WT.Manager.spawnDelay === 24000 && WT.Manager.spawnChance === 50 && calls === 0,
    '§8 spawnDelay reaching 0 resets it to 24000, steps spawnChance 25->50, and a roll over the PREVIOUS chance still refuses');

  // a clamp check: spawnChance never exceeds MAX_SPAWN_CHANCE (75) no matter how many gate ticks
  WT.Manager.spawnChance = 74;
  WT.Manager.spawnTimer = 1; WT.Manager.spawnDelay = 1200;
  WT.tickManager(Object.assign({}, baseCtx, { rand: () => 0.99 }));   // refuse again (99 > 74)
  ok(WT.Manager.spawnChance === 75, '§8 spawnChance clamps at MAX_SPAWN_CHANCE (75), never past it');

  // force the next gate tick's 100-roll under spawnChance AND a guaranteed 1-in-10/placement pass
  WT.Manager.spawnTimer = 1; WT.Manager.spawnDelay = 1200;
  let rolls = [0.0, 0.0];   // 100-roll (0 <= any positive chance), then the 1-in-10 gate (0 -> passes)
  const rand = () => (rolls.length > 1 ? rolls.shift() : 0);
  const spawned = WT.tickManager(Object.assign({}, baseCtx, { rand }));
  ok(spawned === 1 && calls === 3, '§8 a real spawn makes exactly 3 EntityList.spawn calls (1 trader + 2 llamas)');
  ok(WT.Manager.spawnChance === 25, '§8 spawnChance resets to 25 (MIN) after a real spawn');

  const trader = spawnedThisPass.find((e) => e && e.type === 'wandering_trader');
  const llamas = spawnedThisPass.filter((e) => e && e.type === 'trader_llama');
  ok(!!trader, '§8 a wandering_trader is now in EntityList.list');
  ok(llamas.length === 2, '§8 exactly 2 trader_llama entities spawned with it, got ' + llamas.length);
  ok(llamas.every((l) => l.leashHolder && l.leashHolder.kind === 'entity' && l.leashHolder.entity === trader),
    '§8 both llamas are leashed to the SAME trader entity object (e.leashHolder = {kind:"entity"})');
  ok(trader.despawnDelay === WT.DESPAWN_DELAY, '§8 the spawned trader carries the real 48000-tick despawnDelay');

  const anchor = Ls.holderAnchor(llamas[0].leashHolder);
  ok(Array.isArray(anchor) && anchor.length === 3, '§8 Ls.holderAnchor resolves the {kind:"entity"} holder to a real point');
  // #1302: Tm.tickLeash must NOT detach the trader's llamas (holder kind 'entity') or drop a lead
  const leadsBefore = EL.list.filter((e) => e && e.type === 'item').length;
  MCL.Tame.tickLeash();
  ok(llamas.every((l) => l.leashHolder && l.leashHolder.entity === trader),
    '§8 after Tame.tickLeash both llamas are STILL leashed to the trader');
  ok(EL.list.filter((e) => e && e.type === 'item').length === leadsBefore, '§8 Tame.tickLeash dropped no lead');
  WT.resetManager();
}

// ── 9. Ll.DefendTraderGoal / Ll.tickTraderLlamaDespawn ──────────────────────────────────────
{
  const trader = fresh('wandering_trader', 20, 5, 20);
  const llama = fresh('trader_llama', 21, 5, 20);
  const bystander = fresh('zombie', 22, 5, 20);
  llama.leashHolder = { kind: 'entity', entity: trader };

  const goal = new Ll.DefendTraderGoal(llama);
  ok(goal.canUse() === false, '§9 DefendTraderGoal does not engage while the trader has not just been hurt');
  const attacker = fresh('zombie', 30, 5, 20);
  trader.lastAttacker = attacker; trader.lastAttackedTime = 1;
  ok(goal.canUse() === true, '§9 it engages once the held trader has been attacked');
  goal.start();
  ok(llama.target === attacker, '§9 it targets the trader\'s attacker, not the nearer ' + bystander.type);
  goal.stop();
  ok(goal.canUse() === false, '§9 no re-fire for the same hit');
  trader.lastAttackedTime = 2;
  ok(goal.canUse() === true, '§9 re-arms on a new hit');
  goal.stop();
  trader.lastAttacker = bystander; trader.lastAttackedTime = 2.5;
  goal.canUse(); goal.start();
  okAv(llama.target === bystander && llama.target !== attacker, '§9 DefendTraderGoal follows lastAttacker (breaking it to the bystander changes the target)');
  goal.stop(); trader.lastAttacker = attacker; trader.lastAttackedTime = 2;
  const saved = llama.leashHolder; llama.leashHolder = null; trader.lastAttackedTime = 3;
  ok(goal.canUse() === false, '§9 an unleashed llama does not defend');
  llama.leashHolder = saved;

  // #1120: TrackTargetGoal canTrack/shouldContinue/stop
  {
    const g2 = new Ll.DefendTraderGoal(llama);
    llama.target = null;
    const far = fresh('zombie', 30, 5, 20);
    trader.lastAttacker = far; trader.lastAttackedTime = 10;
    far.x = llama.x + 60;
    ok(g2.canUse() === false, '§9 an offender beyond 40 blocks is not tracked');
    far.x = llama.x + 5;
    ok(g2.canUse() === true, '§9 an in-range offender is tracked');
    g2.start();
    ok(g2.canContinueToUse() === true, '§9 goal continues in range');
    far.x = llama.x + 60;
    ok(g2.canContinueToUse() === false, '§9 goal stops once the offender is beyond 40 blocks');
    g2.stop();
    ok(llama.target === null, '§9 stop() clears llama.target');
    const cr = fresh('zombie', 31, 5, 20);
    cr.type = 'player'; cr.invulnerableGamemode = true;
    trader.lastAttacker = cr; trader.lastAttackedTime = 11;
    ok(g2.canUse() === false && llama.target === null, '§9 a creative attacker is never targeted');
    const old = fresh('zombie', 32, 5, 20);
    trader.lastAttacker = old; trader.lastAttackedTime = 12; trader.lastAttackedAge = trader.age | 0;
    trader.age = (trader.age | 0) + 101;
    ok(g2.canUse() === false, '§9 offender forgotten 101 ticks after the hit (baseTick :429)');
    trader.age -= 2;
    ok(g2.canUse() === true, '§9 offender still remembered within 100 ticks');
    g2.stop();
  }

  // despawn: tied to the trader's own live despawnDelay while held, independent once unleashed
  llama.despawnDelay = undefined;
  trader.despawnDelay = 10;
  Ll.tickTraderLlamaDespawn(llama);
  ok(llama.despawnDelay === 9, '§9 a leashed, untamed llama\'s despawnDelay mirrors (holder.despawnDelay - 1)');
  llama.tamed = true;
  Ll.tickTraderLlamaDespawn(llama);
  ok(llama.despawnDelay === 9, '§9 a TAMED llama never despawns (canDespawn refuses)');
  llama.tamed = false;
  llama.leashHolder = null;
  Ll.tickTraderLlamaDespawn(llama);
  ok(llama.despawnDelay === 8, '§9 once unleashed, the despawnDelay counts down on its own');
}

// ── 10. Breed cross-mate ─────────────────────────────────────────────────────────────────────
{
  ok(Breed.SPECIAL.trader_llama === undefined, '§10 Breed.SPECIAL.trader_llama is gone (no longer refused)');
  ok(typeof Breed.CHILD.trader_llama === 'function', '§10 Breed.CHILD.trader_llama exists (aliased to Breed.CHILD.llama)');
  const llama = fresh('llama', 0, 5, 0);
  const trader_llama = fresh('trader_llama', 1, 5, 0);
  llama.tamed = true; trader_llama.tamed = true;   // #3933: HorseBaseEntity.canBreed needs tame
  Breed.setInLove(llama); Breed.setInLove(trader_llama);
  ok(Breed.canMate(llama, trader_llama) === true, '§10 a llama x trader_llama pair, both in love, mates');
  ok(Breed.CHILD_SPECIES(llama.type, trader_llama.type) === 'llama', '§10 CHILD_SPECIES echoes the first parent (llama x trader_llama)');
  ok(Breed.CHILD_SPECIES(trader_llama.type, llama.type) === 'trader_llama', '§10 CHILD_SPECIES echoes the first parent (trader_llama x llama)');
}

// ── 11. anti-vacuity ─────────────────────────────────────────────────────────────────────────
{
  const saved = WT.TRADES_POOL1;
  WT.TRADES_POOL1 = saved.slice(0, 3);   // fewer distinct items than OFFERS_FROM_POOL1 (5)
  const offers = WT.rollTrades({ type: 'wandering_trader' }, Math.random);
  okAv(new Set(offers.slice(0, 3).map((o) => o.item)).size <= 3,
    'shrinking TRADES_POOL1 below the 5-item draw must show up as fewer distinct offers, not silently pad itself back to 5');
  WT.TRADES_POOL1 = saved;
}
{
  const trader = fresh('wandering_trader');
  let seq11 = 7;
  const rng11 = () => { seq11 = (seq11 * 1103515245 + 12345) & 0x7fffffff; return seq11 / 0x7fffffff; };
  WT.ensureTrades(trader, rng11);
  const savedUses = trader.tradeUses[0];
  trader.tradeUses[0] = 999999;   // force "sold out" no matter maxUses
  const P = { inventory: Inv.create(), instabuild: true };
  const res = WT.attempt(trader, 0, P);
  okAv(res.ok === false && res.reason === 'sold out', 'corrupting tradeUses past maxUses must be caught as sold-out by WT.attempt, not silently traded');
  trader.tradeUses[0] = savedUses;
}
{
  const t = fresh('wandering_trader');
  const P = { inventory: Inv.create(), instabuild: true };
  WT.ensureTrades(t, Math.random);
  const n0 = (EL.list || []).filter(o => o.type === 'experience_orb').length;
  const saved = MCL.Xp.spawn; MCL.Xp.spawn = () => [];   // break the spawn
  WT.attempt(t, 0, P);
  MCL.Xp.spawn = saved;
  okAv((EL.list || []).filter(o => o.type === 'experience_orb').length === n0, 'a broken Xp.spawn must leave no orb (the orb assertion is not vacuous)');
}
{
  WT.resetManager();
  WT.Manager.spawnChance = 999;   // break the clamp
  const clamped = Math.min(Math.max(WT.Manager.spawnChance + WT.SPAWN_CHANCE_STEP, WT.MIN_SPAWN_CHANCE), WT.MAX_SPAWN_CHANCE);
  okAv(clamped === WT.MAX_SPAWN_CHANCE, 'an out-of-range spawnChance must still clamp to MAX_SPAWN_CHANCE (75), not the corrupted value');
  WT.resetManager();
}

// ── 12. #1304 RIGHT-CLICK OPENS TRADES (Use.entityUse -> Trade.ensure -> Hud.openTrading), no villager logic
{
  const Use = MCL.Use;
  const opened = [];
  MCL.Hud = MCL.Hud || {};
  const prevOpen = MCL.Hud.openTrading;
  MCL.Hud.openTrading = (e) => { opened.push(e); return true; };
  const t = fresh('wandering_trader');
  const inv = Inv.create();
  const P = { x: 0, y: 5, z: 0, inventory: inv, slot: 0, instabuild: false };
  const r = Use.entityUse(P, t, null);
  okAv(r === true && opened[0] === t, '#1304 right-click on a wandering_trader must open the trading screen');
  okAv(Array.isArray(t.tradeOffers) && t.tradeOffers.length === 6, '#1304 the trader has 6 offers, got ' + (t.tradeOffers && t.tradeOffers.length));
  const em = MCL.Items.of('emerald');
  Inv.add(inv, { i: em, n: 64, d: 0 });
  const before = Inv.countOf(inv, em);
  const res = Trade.attempt(t, 0, P);
  okAv(res.ok === true && Inv.countOf(inv, em) < before, '#1304 a purchase deducts emeralds: ' + JSON.stringify(res));
  // #4284 MerchantEntity.onSellingItem + trade(): one yes sound, ambientSoundChance = -80
  {
    const heard = [], realMs = MCL.Sound.mobSound; MCL.Sound.mobSound = (e, ev) => { heard.push(ev); return true; };
    const t2 = fresh('wandering_trader'); t2.ambientSoundChance = 0; Inv.add(inv, { i: em, n: 64, d: 0 });
    Trade.attempt(t2, 0, P); MCL.Sound.mobSound = realMs;
    okAv(heard.length === 1 && heard[0] === 'entity.wandering_trader.yes', '#4284 trade plays wandering_trader.yes once: ' + heard);
    okAv(t2.ambientSoundChance === -80, '#4284 trade resets ambientSoundChance to -80, got ' + t2.ambientSoundChance);
  }
  okAv(t.tradeXp === undefined && t.villagerLevel === undefined && !t.tradePendingLevelUp, '#1304 no villager xp/level state on a wandering trader');
  const baby = fresh('wandering_trader'); baby.baby = true; opened.length = 0;
  okAv(Use.entityUse(P, baby, null) !== true || opened.length === 0, '#1304 a baby trader does not open trades');
  // #4281: WanderingTraderEntity.interactMob trade branch is guarded by !stack.isOf(villager_spawn_egg)
  const egg = fresh('wandering_trader'); opened.length = 0;
  Use.entityUse(P, egg, { i: MCL.Items.of('villager_spawn_egg'), n: 1, d: 0 });
  okAv(opened.length === 0 && !egg.customer, '#4281 holding a villager_spawn_egg must not open the trade screen');
  MCL.Hud.openTrading = prevOpen;
}

// ── 10. THE LIVE CALLER (s103) — `Main.worldTick` must actually call `WT.tickManager`, gated on
// `Spawn.ready` (doMobSpawning). A manager nobody ticks is the "built, not live" shape D-139 forbids.
{
  const mainSrc = readFileSync(new URL('../src/17_main.js', import.meta.url), 'utf8');
  const wt = mainSrc.slice(mainSrc.indexOf('Main.worldTick = function'));
  const live = (src) => /NS\.WT\.tickManager\(\{[\s\S]*?doMobSpawning:/.test(src);
  ok(live(wt), 'Main.worldTick does not call NS.WT.tickManager with a doMobSpawning gate');
  okAv(!live(wt.replace('NS.WT.tickManager({', 'NS.WT.tickManagerX({')), 'a worldTick with the call renamed away must read as NOT live');
}

// ── 10b. #1798 doTraderSpawning: Main.worldTick must hand the gamerule to tickManager.
{
  const mainSrc = readFileSync(new URL('../src/17_main.js', import.meta.url), 'utf8');
  const wt = mainSrc.slice(mainSrc.indexOf('Main.worldTick = function'));
  const passes = (src) => /NS\.WT\.tickManager\(\{[\s\S]*?doTraderSpawning:[^\n]*ruleGet\('doTraderSpawning'\)/.test(src);
  ok(passes(wt), 'Main.worldTick must pass doTraderSpawning (Commands.ruleGet) to WT.tickManager');
  okAv(!passes(wt.replace('doTraderSpawning:', 'doTraderSpawningX:')), 'a worldTick without the doTraderSpawning key must read as NOT passing it');
  const ctx = { doTraderSpawning: false, doMobSpawning: true, players: () => [{ x: 0, y: 70, z: 0 }], heightAt: () => 70,
    collisionEmpty: () => true, spawnFn: () => { spawned++; return {}; } };
  let spawned = 0;
  for (let i = 0; i < 20 * 1300; i++) WT.tickManager(ctx);
  ok(spawned === 0, 'tickManager with doTraderSpawning:false must never spawn');
}

// ── 11. #679 TraderLlamaEntity.putPlayerOnBack: trader-held llama takes no rider.
{
  const Mnt = MCL.Mount;
  Mnt.init();
  const savedM = Mnt.MOUNTABLE.trader_llama;
  Mnt.MOUNTABLE.trader_llama = true;   // exercise the gate itself, not the type filter
  const tr = fresh('wandering_trader', 0.5, 5, 0.5);
  const ll = fresh('trader_llama', 1.5, 5, 0.5);
  ll.leashHolder = { kind: 'entity', entity: tr };
  const r = Mnt.interact(ll, '', {});
  ok(!ll.rider && !(r && r.mounted), 'Mount.interact on a trader-held trader_llama must give no passenger');
  ok(Mnt.mount(ll) === false && !ll.rider, 'Mount.mount on a trader-held trader_llama must refuse');
  ll.leashHolder = null;
  const r2 = Mnt.interact(ll, '', {});
  ok(!!(r2 && r2.mounted) && ll.rider, 'a released trader_llama mounts as before');
  ll.rider = null; ll.leashHolder = { kind: 'entity', entity: tr };
  const gate = Mnt.isTraderHeld;
  Mnt.isTraderHeld = () => false;   // break the gate
  Mnt.interact(ll, '', {});
  okAv(!!ll.rider, 'with the trader-held gate removed the llama must be mountable (check can fail)');
  Mnt.isTraderHeld = gate;
  if (savedM === undefined) delete Mnt.MOUNTABLE.trader_llama;
}

// #1801: the trade screen sets/clears e.customer; interactMob refuses a trader that has one
{
  const fs = await import('node:fs');
  const hud = fs.readFileSync(new URL('../src/15_hud.js', import.meta.url), 'utf8');
  const use = fs.readFileSync(new URL('../src/14l_use.js', import.meta.url), 'utf8');
  ok(/openTrading[\s\S]{0,600}WT\.setCustomer\(e, NS\.Player\)/.test(hud), '#1801 openTrading sets the customer');
  ok(/WT\.setCustomer\(H\.tradingEntity, null\)/.test(hud), '#1801 close clears the customer');
  ok(/wandering_trader' && !e\.removed && !e\.baby && !e\.customer/.test(use), '#1801 interact requires !hasCustomer');
  okAv(!/WT\.setCustomer\(e, NS\.Player\)/.test(hud.replace('WT.setCustomer(e, NS.Player)', '')), 'broken hud source is detected');
}

// ── 12. #1799 the trader/llama spawn position goes through SpawnHelper.canSpawn(ON_GROUND)
{
  const R = MCL.Reg, stId = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
  const X = 5, Z = 5, Y = 70;
  const put = (n, y) => W.setBlock(X, y, Z, stId(n));
  const origin = { x: X, y: Y, z: Z };
  const probe = () => WT.getNearbySpawnPos({ heightAt: () => Y, isSpawnable: Spawn.canSpawnOnGround },
    origin, 1, () => 0.9999);   // always (X+0, Z+0): floor(0.9999*2)-1 = 0
  for (const y of [Y - 1, Y, Y + 1]) put('air', y);
  put('stone', Y - 1);
  ok(!!probe(), '§12 a stone floor with two clear cells is a legal trader spawn');
  put('water', Y - 1); okAv(!probe(), '§12 a water "floor" must be rejected');
  put('oak_leaves', Y - 1); okAv(!probe(), '§12 a leaves floor must be rejected');
  put('stone', Y - 1); put('water', Y); okAv(!probe(), '§12 a water-filled spawn cell must be rejected');
  put('air', Y); put('stone', Y + 1); okAv(!probe(), '§12 a blocked head cell must be rejected');
  put('air', Y + 1);
  const main = readFileSync(new URL('../src/17_main.js', import.meta.url), 'utf8');
  const wired = (src) => /NS\.WT\.tickManager\(\{[\s\S]*?isSpawnable:[\s\S]*?canSpawnOnGround/.test(src);
  ok(wired(main), '§12 Main.worldTick must supply ctx.isSpawnable = Spawn.canSpawnOnGround');
  okAv(!wired(main.replace('isSpawnable:', 'isSpawnableX:')), '§12 a worldTick without isSpawnable must read as unwired');
  // #4193: vanilla trySpawn excludes BiomeKeys.THE_VOID (never generated), so mushroom_fields must NOT be refused
  const oceanWired = (src) => /NS\.WT\.tickManager\(\{[\s\S]*?isOceanBiome:/.test(src);
  ok(!oceanWired(main), '§13 Main.worldTick must not supply ctx.isOceanBiome (vanilla only excludes the_void, #4193)');
  okAv(oceanWired(main.replace('isSpawnable:', 'isOceanBiome: () => true, isSpawnable:')), '§13 a worldTick supplying isOceanBiome must read as wired');
}

// #4460: only VillagerEntity.beginTradeWith calls prepareOffersFor (rep + Hero of the Village); a trader never does
{
  const hud = readFileSync(new URL('../src/15_hud.js', import.meta.url), 'utf8');
  const gated = (src) => /e\.type === 'villager' && NS\.Trade\.prepareOffersFor\) NS\.Trade\.prepareOffersFor\(e/.test(src);
  ok(gated(hud), '#4460 openTrading calls prepareOffersFor for villagers only');
  okAv(!gated(hud.replace("e.type === 'villager' && ", '')), '#4460 an ungated prepareOffersFor call is detected');
}

console.log('================ wtradercheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   x ' + f);
console.log(` breaks caught ...... ${breaks} ✓`);
console.log('==================================================');
process.exit(fails.length ? 1 : 0);
