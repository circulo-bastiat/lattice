#!/usr/bin/env node
// extract-wtrader-trades.mjs (#5909) -- TradeOffers.WANDERING_TRADER_TRADES -> tools/golden/wtrader-trades-1.18.2.tsv
//   node tools/extract-wtrader-trades.mjs          rewrite the golden
// Reads .decomp TradeOffers.java (the pools) + Items.java (field_NNNN -> register("id")) +
// WanderingTraderEntity.fillRecipes (the 5-from-pool-1 / 1-from-pool-2 counts).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';

export const GOLDEN = join(MCLITE_ROOT, 'tools', 'golden', 'wtrader-trades-1.18.2.tsv');

export function extract() {
  const D = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft');
  const src = readFileSync(join(D, 'village', 'TradeOffers.java'), 'utf8');
  const items = readFileSync(join(D, 'item', 'Items.java'), 'utf8');
  const wte = readFileSync(join(D, 'entity', 'passive', 'WanderingTraderEntity.java'), 'utf8');
  const idOf = {};
  for (const m of items.matchAll(/Item (\w+) = register\(\s*"(\w+)"/g)) idOf[m[1]] = m[2];
  const at = src.indexOf('WANDERING_TRADER_TRADES = ');
  const body = src.slice(at, src.indexOf('\n    );', at));
  const p2 = body.indexOf('\n            2,');
  const rows = [];
  const re = /new TradeOffers\.SellItemFactory\(Items\.(\w+),\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+))?\)/g;
  for (const m of body.matchAll(re)) {
    const id = /^field_/.test(m[1]) ? idOf[m[1]] : m[1].toLowerCase();
    if (!id) throw new Error('unmapped ' + m[1]);
    const pool = m.index < p2 ? 1 : 2;
    // 4-arg ctor: maxUses 12, xp = last arg (TradeOffers.java:896)
    const [price, count] = [+m[2], +m[3]];
    const maxUses = m[5] === undefined ? 12 : +m[4], xp = m[5] === undefined ? +m[4] : +m[5];
    rows.push({ pool, id, price, count, maxUses, xp, mult: 0.05 });
  }
  const fr = wte.slice(wte.indexOf('void fillRecipes()'));
  const from1 = +/fillRecipesFromPool\(\$\$2, \$\$0, (\d+)\)/.exec(fr)[1];
  const from2 = /\$\$1\.length\)/.test(fr) ? 1 : 0;   // one nextInt(pool2.length) index
  return { rows, from1, from2 };
}

if (process.argv[1] && process.argv[1].endsWith('extract-wtrader-trades.mjs')) {
  const { rows, from1, from2 } = extract();
  const out = ['# pool\titem\tprice\tcount\tmaxUses\txp\tmult  (from1=' + from1 + ' from2=' + from2 + ')'];
  for (const r of rows) out.push([r.pool, r.id, r.price, r.count, r.maxUses, r.xp, r.mult].join('\t'));
  mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
  writeFileSync(GOLDEN, out.join('\n') + '\n');
  console.log('wrote ' + rows.length + ' rows -> ' + GOLDEN);
}
