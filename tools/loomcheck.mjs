#!/usr/bin/env node
// loomcheck.mjs — G19e-loom: LoomScreenHandler (.decomp) as NS.Loom + Menu.loomMenu. Banner + dye +
// pattern gives a banner whose BlockEntityTag.Patterns equals vanilla's BannerPattern ids for EVERY
// pattern; the 7th layer is refused. The expected ids are read from the .decomp enum, not retyped.
// Each rule is re-run against deliberately broken data ("<n> breaks caught", D-30).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0, caught = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const brk = (c, m) => { breaks++; if (!c) caught++; else fails.push('break not caught: ' + m); };
console.log('loomcheck — G19e loom banner patterns');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '14g_menu.js', '07zzq_loom.js'] });
const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
const L = M.Loom, I = (n) => M.Items.of(n);
const st = (n, o = {}) => ({ i: I(n), n: 1, d: 0, ...o });

// vanilla's enum, parsed from the decompiled source
const dec = join(MCLITE_ROOT, '.decomp/net/minecraft/block/entity/BannerPattern.java');
let want = null, wantItems = {};
if (existsSync(dec)) {
  const src = readFileSync(dec, 'utf8');
  want = [...src.matchAll(/field_\d+\("([a-z_]+)", "([a-z]+)"(?:, (true|false))?\)/g)].map((m) => [m[1], m[2], m[3] === 'true']);
  const its = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/item/Items.java'), 'utf8');
  for (const m of its.matchAll(/"([a-z]+_banner_pattern)",\s*new BannerPatternItem\(BannerPattern\.(field_\d+)/g)) wantItems[m[1]] = m[2];
}
ok(want && want.length === 41, 'parsed 41 enum rows from .decomp, got ' + (want && want.length));
if (want) {
  ok(want.length === L.COUNT, 'COUNT');
  ok(want.filter((w) => w[2]).length === L.HAS_PATTERN_ITEM_COUNT, 'HAS_PATTERN_ITEM_COUNT');
  want.forEach((w, k) => ok(L.PATTERNS[k][0] === w[0] && L.PATTERNS[k][1] === w[1], 'pattern ' + k + ' ' + w[0] + '/' + w[1]));
  ok(Object.keys(wantItems).length === 6, '6 pattern items in Items.java');
}
ok(L.LOOM_APPLICABLE_COUNT === 34, 'LOOM_APPLICABLE_COUNT 34');

const dyes = L.DYES;
// 1. every dye-pattern button: banner + dye -> the vanilla layer
for (let b = 1; b <= L.LOOM_APPLICABLE_COUNT; b++) {
  const r = L.result(st('white_banner'), st('red_dye'), b);
  const pat = r && r.t.BlockEntityTag.Patterns;
  ok(pat && pat.length === 1 && pat[0].Pattern === (want ? want[b][1] : '?') && pat[0].Color === 14, 'button ' + b + ' layer');
  ok(r && r.n === 1 && r.i === I('white_banner'), 'button ' + b + ' output is one banner');
}
ok(L.result(st('white_banner'), st('red_dye'), 0) === null, 'selection 0 -> no output');
ok(!L.validButton(0) && !L.validButton(35) && L.validButton(34) && L.validButton(1), 'button range 1..34');
// 2. dye colours are DyeColor ids
dyes.forEach((d, k) => ok(L.dyeId(st(d + '_dye')) === k, 'dye ' + d));
ok(L.dyeId(st('stone')) === -1 && !L.isBanner(st('stone')) && L.isBanner(st('cyan_banner')), 'filters');
// 3. pattern items
for (const [nm, f] of Object.entries(wantItems)) {
  const ord = L.patternOrdinal(st(nm));
  ok(ord > 0 && want[ord][2] && L.PATTERN_ITEMS[nm] === want[ord][1] && L.PATTERNS[ord][0] === nm.replace('_banner_pattern', ''), nm + ' -> ' + ord);
}
// 4. layer limit: 6 layers OK to hold, 7th refused (selection forced to 0)
{
  const layers = (n) => Array.from({ length: n }, () => ({ Pattern: 'ts', Color: 1 }));
  const b6 = st('white_banner', { t: { BlockEntityTag: { Patterns: layers(6) } } });
  const b5 = st('white_banner', { t: { BlockEntityTag: { Patterns: layers(5) } } });
  const flo = st('flower_banner_pattern');
  ok(L.reselect(b6, flo, 5) === 0, '6 layers: pattern item selection refused');
  ok(L.reselect(b5, flo, 0) === L.patternOrdinal(flo), '5 layers: allowed');
  ok(L.selectable(b6, null).length === 0 && L.selectable(b5, null).length === 34 && L.selectable(b5, flo).length === 0, 'selectable list');
  const r6 = L.result(b5, st('red_dye'), 3);
  ok(L.layers(r6) === 6 && L.layers(b5) === 5, 'result is a copy, 6th layer added');

  // the menu end to end
  const inv = M.Inventory.create ? M.Inventory.create() : null;
  const m = M.Menu.loomMenu(inv);
  m.input.set(0, st('white_banner', { t: { BlockEntityTag: { Patterns: layers(6) } } }));
  m.input.set(1, st('red_dye')); m.input.set(2, st('creeper_banner_pattern'));
  M.Menu.slotSet(m.slots[2], st('creeper_banner_pattern'));
  ok(m.selected === 0 && !m.output.get(0), 'menu: 7th layer refused, no output');
  const m2 = M.Menu.loomMenu(inv);
  M.Menu.slotSet(m2.slots[0], st('blue_banner', { t: { BlockEntityTag: { Patterns: layers(5) } } }));
  M.Menu.slotSet(m2.slots[1], st('lime_dye'));
  ok(m2.button(34) && m2.output.get(0) && m2.output.get(0).t.BlockEntityTag.Patterns[5].Pattern === 'bri', 'menu: button 34 -> bricks');
  ok(!m2.button(0) && !m2.button(35), 'menu: invalid buttons refused');
  M.Menu.slotSet(m2.slots[2], st('skull_banner_pattern'));
  ok(m2.selected === L.patternOrdinal(st('skull_banner_pattern')) && m2.output.get(0).t.BlockEntityTag.Patterns[5].Pattern === 'sku', 'menu: pattern item selects its pattern');
  ok(!m2.slots[0].placeFn(st('stone')) && !m2.slots[3].placeFn(st('white_banner')), 'menu: slot filters');

  // ── breaks
  const saved = L.PATTERNS[5][1];
  L.PATTERNS[5][1] = 'xx';
  const bad = L.result(st('white_banner'), st('red_dye'), 5);
  brk(want && bad.t.BlockEntityTag.Patterns[0].Pattern === want[5][1], 'wrong pattern id');
  L.PATTERNS[5][1] = saved;
  const sv = L.MAX_LAYERS; L.MAX_LAYERS = 7;
  brk(L.reselect(b6, flo, 5) === 0, '7th layer allowed');
  L.MAX_LAYERS = sv;
  const dsv = L.DYES[14]; L.DYES[14] = 'x';
  const wc = L.result(st('white_banner'), st('red_dye'), 1);
  brk(!!wc && wc.t.BlockEntityTag.Patterns[0].Color === 14, 'wrong dye colour');
  L.DYES[14] = dsv;
  const wr = L.result(st('white_banner'), st('red_dye'), 1); wr.n = 2;
  brk(wr.n === 1, 'output count not 1');
}

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${caught}/${breaks}`);
for (let i = 0; i < caught; i++) console.log('   ✓ break caught (' + (i + 1) + ')');
console.log(' ' + caught + ' breaks caught');
if (fails.length || caught !== breaks) { fails.forEach((f) => console.log('   x ' + f)); process.exit(1); }
