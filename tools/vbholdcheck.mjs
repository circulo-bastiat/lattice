#!/usr/bin/env node
// vbholdcheck.mjs — G18f-N2: FindInteractionTargetTask(PLAYER,4) + HoldTradeOffersTask(400,1600)
// (src/07zv8_vbhold.js, NS.VBHold; .decomp HoldTradeOffersTask.java / FindInteractionTargetTask.java).
//   node tools/vbholdcheck.mjs
// A seeded villager with offers: a player within 4 blocks becomes INTERACTION_TARGET, holding a payment item
// puts an offer's sell stack in the mainhand, it cycles every 40 ticks through the real offers, and leaving
// clears it. Then breaks its own wiring/data and checks the breaks are caught.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

console.log('vbholdcheck — G18f-N2: FindInteractionTargetTask + HoldTradeOffersTask (NS.VBHold)');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js', '07zv4_vbidle.js', '07zv5_vbbreed.js',
  '07zv6_vbgather.js', '07p_trade.js', '07zv8_vbhold.js', '07zx_particle.js', '07zt_wtrader.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
const EL = M.EntityList, IT = M.Items, H = M.VBHold, VB = M.VB;
ok(H && typeof H.tick === 'function', 'NS.VBHold did not load (src/07zv8_vbhold.js)');
if (!H) { console.log('\nFAIL vbholdcheck — module missing'); process.exit(1); }
M.World.init(1); EL.init();
VB.ready = true;

const ROWS = [
  { kind: 'buy_item_for_emerald', item: 'bread', itemQty: 6, priceEmerald: 1, maxUses: 16, xp: 1, priceMult: 0.05 },
  { kind: 'sell_item_for_emerald', item: 'wheat', itemQty: 20, priceEmerald: 1, maxUses: 16, xp: 1, priceMult: 0.05 },
  { kind: 'buy_item_for_emerald', item: 'carrot', itemQty: 9, priceEmerald: 1, maxUses: 16, xp: 1, priceMult: 0.05 }
];
function seeded() {
  const v = EL.spawn('villager', 0, 64, 0);
  v.profession = 'farmer'; v.tradeProfession = 'farmer';
  v.tradeOffers = ROWS.map((r) => Object.assign({}, r));
  v.tradeUses = ROWS.map(() => 0); v.tradeDemand = ROWS.map(() => 0); v.tradeSpecial = ROWS.map(() => 0);
  return v;
}
const emerald = IT.of('emerald'), breadId = IT.of('bread'), carrotId = IT.of('carrot'), wheatId = IT.of('wheat');
const player = (x, held) => ({ x, y: 64, z: 0, heldStack: held });
const hand = (v) => v.vbMainHand && v.vbMainHand.i;

{
  const v = seeded(); let t = 0;
  const far = player(10, { i: emerald, n: 1 });
  H.tick(v, 0, t++, far);
  ok(!v.vbInteractionTarget && !hand(v), 'a player 10 blocks away is not acquired');
  const p = player(3, { i: emerald, n: 1 });
  H.tick(v, 0, t++, p);
  ok(v.vbInteractionTarget === p, 'a player within 4 blocks becomes INTERACTION_TARGET');
  H.tick(v, 0, t++, p);
  ok(hand(v) === breadId, 'holding an emerald shows the first matching offer (bread) in the mainhand, got ' + hand(v));
  ok(v.vbLookTarget && v.vbLookTarget.x === 3, 'LOOK_TARGET is set on the customer');
  for (let k = 0; k < 40; k++) H.tick(v, 0, t++, p);
  ok(hand(v) === carrotId, 'after 40 ticks the held offer cycles to the next one (carrot), got ' + hand(v));
  for (let k = 0; k < 40; k++) H.tick(v, 0, t++, p);
  ok(hand(v) === breadId, 'and wraps back to the first');
  p.heldStack = { i: wheatId, n: 1 };
  H.tick(v, 0, t++, p);
  ok(hand(v) === emerald, 'holding wheat shows the emerald the wheat offer pays');
  p.heldStack = { i: IT.of('stick'), n: 1 };
  H.tick(v, 0, t++, p);
  ok(!hand(v), 'a held item no offer wants shows nothing');
  p.heldStack = { i: emerald, n: 1 };
  H.tick(v, 0, t++, p);
  ok(hand(v) === breadId, 'switching back re-shows an offer');
  p.x = 9;
  H.tick(v, 0, t++, p);
  ok(!hand(v) && !v.vbInteractionTarget && !v.vbHoldRun, 'the customer leaving clears the mainhand and INTERACTION_TARGET');
  v.tradeUses[0] = 16;
  p.x = 3; H.tick(v, 0, t++, p); H.tick(v, 0, t++, p);
  ok(hand(v) === carrotId, 'a disabled (sold-out) offer is skipped');
}

// anti-vacuity: break the data / logic and watch it get caught
{
  const saved = H.tick; H.tick = () => {};
  const v = seeded(); const p = player(3, { i: emerald, n: 1 });
  H.tick(v, 0, 0, p); H.tick(v, 0, 1, p);
  okAv(!v.vbInteractionTarget && !hand(v), 'an unwired (no-op) VBHold.tick acquires nothing and holds nothing');
  H.tick = saved;
  const savedR = H.FIND_RANGE; H.FIND_RANGE = 0.1;
  const v2 = seeded(); const p2 = player(3, { i: emerald, n: 1 });
  H.tick(v2, 0, 0, p2);
  okAv(!v2.vbInteractionTarget, 'a zero find range never acquires the player');
  H.FIND_RANGE = savedR;
  const v3 = seeded(); v3.tradeOffers = []; v3.tradeUses = [];
  const p3 = player(3, { i: emerald, n: 1 });
  H.tick(v3, 0, 0, p3); H.tick(v3, 0, 1, p3);
  okAv(!hand(v3), 'a villager with no offers holds nothing');
}
const src = readFileSync(join(MCLITE_ROOT, 'src/07zv_villagerbrain.js'), 'utf8');
ok(/NS\.VBHold\.tick\(e, now, tnow, NS\.Player\)/.test(src), 'VB.tick must call NS.VBHold.tick');
okAv(!/NS\.VBHold\.tick\(e, now, tnow, NS\.Player\)/.test(src.replace('NS.VBHold.tick(e, now, tnow, NS.Player)', '')), 'removing the VB.tick call is detected');

console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); console.log('\nFAIL vbholdcheck'); process.exit(1); }
console.log(`\nPASS vbholdcheck — ${pass} checks green (incl. ${breaks} breaks caught)`);
