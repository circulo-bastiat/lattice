#!/usr/bin/env node
// fishlootcheck.mjs — #324 G24: Loot.fish(ctx) over the packed gameplay/fishing tables. Seeded draws: the
// fish/junk/treasure split follows weights 85/10/5 with quality -1/-2/+2 (LotS 0 vs 3); treasure is never drawn
// when is_open_water is false. Faults (quality zeroed, open-water ignored, luck dropped) must be caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
console.log('fishlootcheck — #324 G24: fishing loot');
const A = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07e_loot.js', '07ox_enchhelper.js'], dom: false });
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
MCL.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Loot.init({ loot: readFileSync(join(A, 'loot.bin')).toString('base64'), lootBytes: rdj('loot.meta.json').jsonBytes });
const L = MCL.Loot, JR = MCL.JRandom;
const FISH = new Set(['cod', 'salmon', 'tropical_fish', 'pufferfish']);
const TREAS = new Set(['name_tag', 'saddle', 'bow', 'enchanted_book', 'nautilus_shell']);
const N = 6000;
function split(lots, openWater, fish = L.fish) {
  const c = { fish: 0, junk: 0, treas: 0 };
  for (let s = 1; s <= N; s++) {
    const r = fish.call(L, { luckOfTheSea: lots, playerLuck: 0, openWater, rng: new JR(s * 7919 + lots), item: 'fishing_rod' });
    const n = r[0] && r[0].item;
    if (FISH.has(n)) c.fish++; else if (TREAS.has(n) || (n === 'fishing_rod' && r[0].ench && r[0].ench.length)) c.treas++; else c.junk++;
  }
  return c;
}
// expected shares: weights 85/10/5 (quality -1/-2/+2) -> w = floor(weight + quality*luck); treasure gated on open water
function expect(luck, open) {
  const f = Math.max(85 - luck, 0), j = Math.max(10 - 2 * luck, 0), t = open ? Math.max(5 + 2 * luck, 0) : 0, T = f + j + t;
  return { fish: f / T, junk: j / T, treas: t / T };
}
function suite(fish) {
  const bad = [];
  for (const [lots, open] of [[0, true], [3, true], [0, false], [3, false]]) {
    const c = split(lots, open, fish), e = expect(lots, open);
    for (const k of ['fish', 'junk', 'treas']) {
      const p = c[k] / N, sd = Math.sqrt(e[k] * (1 - e[k]) / N);
      if (Math.abs(p - e[k]) > 4 * sd + 0.002) bad.push(`LotS ${lots} open ${open} ${k}: ${p.toFixed(4)} vs ${e[k].toFixed(4)}`);
    }
    if (!open && c.treas) bad.push('treasure drawn in closed water');
  }
  return bad;
}
const fails = suite(L.fish);
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
const faults = {
  'quality zeroed': (o) => function (c) { return o.call(this, Object.assign({}, c, { luckOfTheSea: 0, playerLuck: 0 })); },
  'open water ignored': (o) => function (c) { return o.call(this, Object.assign({}, c, { openWater: true })); },
  'luck of the sea dropped': (o) => function (c) { return o.call(this, Object.assign({}, c, { luckOfTheSea: 0 })); },
};
let caught = 0;
for (const [nm, mk] of Object.entries(faults)) {
  const b = suite(mk(L.fish));
  if (b.length) { caught++; console.log('  ✓ fault caught: ' + nm); } else fails.push('fault not caught: ' + nm);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `OK  ${4 * 3 + caught} checks passed, 0 failures; split inside 4σ for LotS 0/3 x open/closed, ${N} draws each; ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
