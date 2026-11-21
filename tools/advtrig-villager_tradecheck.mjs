#!/usr/bin/env node
// advtrig-villager_tradecheck.mjs — G17-AT13. minecraft:villager_trade through the real call site
// (Trade.triggerAdv, what Trade.attempt / wandering-trader trade call) on the real advancement data.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(join(ROOT, f), 'utf8');
const SRC = rd('src/02l_advancements.js'), TRADE = rd('src/07p_trade.js');
const meta = JSON.parse(rd('assets/advancements.meta.json'));
const data = readFileSync(join(ROOT, 'assets/advancements.bin')).toString('base64');
function load(src, trade) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '01b_inflate']) new Function('MCL', rd(`src/${f}.js`))(NS);
  new Function('MCL', src)(NS);
  NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  NS.Items = { nameOf: () => 'bread' };
  new Function('MCL', trade)(NS);
  return NS;
}
let asserted = 0;
function verify(NS) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const A = NS.Adv, done = (P, id) => P.advancements.getProgress(A.manager.get(id)).isDone();
  const mk = () => ({ x: 0, y: 64, z: 0, advancements: new A.Tracker({}) });
  const vil = { type: 'villager', x: 1, y: 64, z: 1 };
  let P = mk();
  NS.Trade.triggerAdv(P, vil, { i: 1, n: 1 });
  no(done(P, 'minecraft:adventure/trade'), 'adventure/trade not completed');
  no(!done(P, 'minecraft:adventure/trade_at_world_height'), 'world height completed at y=64');
  P = mk(); P.y = 319;
  NS.Trade.triggerAdv(P, vil, { i: 1, n: 1 });
  no(done(P, 'minecraft:adventure/trade_at_world_height'), 'trade_at_world_height not completed at y=319');
  P = mk(); P.y = 318.9;
  NS.Trade.triggerAdv(P, vil, { i: 1, n: 1 });
  no(!done(P, 'minecraft:adventure/trade_at_world_height'), 'world height completed at y=318.9');
  return f;
}
const base = verify(load(SRC, TRADE));
if (base.length) { console.log('FAIL', base.join('; ')); process.exit(1); }
const breaks = [
  ['matcher always true', SRC.replace("return P.extended(c.player, ctx, { this: ctx.player }) && P.extended(c.villager", "return true || P.extended(c.player, ctx, { this: ctx.player }) && P.extended(c.villager"), TRADE],
  ['player condition dropped', SRC.replace("P.extended(c.player, ctx, { this: ctx.player }) && ", ""), TRADE],
  ['no trigger call', SRC, TRADE.replace("NS.Adv.trigger(P, 'minecraft:villager_trade'", "(function(){})(P, 'minecraft:villager_trade'")],
];
let caught = 0;
for (const [name, s, t] of breaks) {
  if ((s === SRC && t === TRADE)) { console.log('FAIL: break did not apply:', name); process.exit(1); }
  let r; try { r = verify(load(s, t)); } catch (e) { r = [String(e)]; }
  if (!r.length) { console.log('FAIL: break not caught:', name); process.exit(1); }
  caught++;
}
console.log(`${asserted} assertions, 0 failures, ${caught} breaks caught`);
