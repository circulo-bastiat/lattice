#!/usr/bin/env node
// stats11618check.mjs — #11618 (AUDIT-MAP). 15fs_stats.js StatsScreen: general/items/mobs rows, sort, tabs, entry points.
import { readFileSync } from 'node:fs';
import { loadEngine, SRC, MCLITE_ROOT } from './loadsrc.mjs';
const A = MCLITE_ROOT + 'assets/';
const rd = (f) => readFileSync(SRC + '/' + f, 'utf8');
const opt = rd('15f_options.js');
let N = 0;
function run(patch) {
  const f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    const M = loadEngine({ extra: ['02g_items.js', '07zzo_stats.js', '15fs_stats.js'], ...(patch ? { patch: (fn, t) => (fn === '15fs_stats.js' ? patch(t) : t) } : {}) });
    M.Items.init({ items: readFileSync(A + 'items.bin').toString('base64'), itemsBytes: JSON.parse(readFileSync(A + 'items.meta.json', 'utf8')).rawBytes });
    const St = M.Stats, SS = M.StatsScreen; St.reset();
    ok(SS.items().length === 0 && SS.mobs().length === 0 && !SS.tabs()[1].active && !SS.tabs()[2].active && SS.tabs()[0].active, 'empty tabs');
    St.inc('jump', 1234); St.inc('walk_one_cm', 60000);
    St.set(St.statName('mined', 'stone'), 12); St.set(St.statName('crafted', 'stone'), 3);
    St.set(St.statName('killed', 'zombie'), 2); St.set(St.statName('killed_by', 'skeleton'), 1);
    const g = SS.general();
    ok(g.length === 75, 'general count');
    ok(g.find((r) => r.id === 'jump').value === '1,234' && g.find((r) => r.id === 'walk_one_cm').value === '0.60 km', 'general format');
    ok(g.every((r, i) => i === 0 || g[i - 1].name <= r.name), 'general sorted');
    ok(g[0].color === 0xFFFFFF && g[1].color === 0x909090, 'row colours');
    ok(g.find((r) => r.id === 'aviate_one_cm').name === 'Distance by Elytra', 'en_us name');
    ok(SS.statLabel('foo_bar') === 'Foo Bar' && SS.entityLabel('tnt') === 'Primed TNT' && SS.entityLabel('cave_spider') === 'Cave Spider', 'labels');
    const it = SS.items();
    ok(it.length === 1 && it[0].id === 'stone' && it[0].cells.join() === '12,0,3,0,0,0' && it[0].stack.i === M.Items.of('stone'), 'item row');
    ok(SS.ITEM_COLS.join() === 'mined,broken,crafted,used,picked_up,dropped', 'columns');
    const mb = SS.mobs();
    ok(mb.length === 2 && mb[0].id === 'skeleton' && mb[1].id === 'zombie', 'mobs list');
    ok(mb[1].killed === 'You killed 2 Zombie' && mb[1].killedBy === 'Zombie has never killed you' && mb[1].killedByColor === 0x606060 && mb[1].killedColor === 0x909090, 'zombie texts');
    ok(mb[0].killedBy === 'Skeleton killed you 1 time' && mb[0].killed === 'You have never killed Skeleton', 'skeleton texts');
    St.set(St.statName('killed_by', 'skeleton'), 2); ok(SS.mobs()[0].killedBy === 'Skeleton killed you 2 times', 'plural');
    ok(SS.tabs().every((t) => t.active), 'tabs active');
    ok(SS.rows('items')[0].id === 'stone' && SS.rows('mobs').length === 2 && SS.rows('general').length === 75 && SS.rows('x').length === 75, 'rows by tab');
    St.set(St.statName('mined', 'dirt'), 50);
    const first = M.Items.of('stone') < M.Items.of('dirt') ? 'stone' : 'dirt';
    ok(SS.items()[0].id === first, 'registry order');
    SS.setSort(0); ok(SS.items()[0].id === 'dirt' && SS.sortDir === -1, 'sort desc');
    SS.setSort(0); ok(SS.items()[0].id === 'stone' && SS.sortDir === 1, 'sort flip');
    SS.setSort(2); ok(SS.sortDir === -1 && SS.items()[0].id === 'stone', 'new column desc');
    ok(SS.mobs()[0].killedColor === 0x606060, 'unkilled dim');
    St.set(St.statName('killed', 'creeper'), 1);
    ok(SS.mobs().map((r) => r.id).join() === 'creeper,skeleton,zombie', 'registry mob order');
    St.set(St.statName('mined', 'air'), 4); St.set(St.statName('dropped', 'sand'), 1);
    ok(!SS.items().some((r) => r.id === 'air') && SS.items().some((r) => r.id === 'sand'), 'air skipped, any stat counts');
    St.set(St.statName('mined', 'dirt'), 12); SS.sortCol = -1; SS.sortDir = 1; SS.setSort(0);
    ok(SS.items().slice(0, 2).map((r) => r.id).join() === (M.Items.of('stone') < M.Items.of('dirt') ? 'stone,dirt' : 'dirt,stone'), 'ties by item id');
  } catch (e) { f.push('threw ' + e.message); }
  return f;
}
// entry points: the pause-menu button opens the screen, which draws these rows
const wired = /label: 'Statistics', fn: function \(\) \{[^}]*O\.statsTab = 'general'; O\.go\('stats'\)/.test(opt)
  && /O\.screen === 'stats'\) O\.drawStats/.test(opt) && /SS\.tabs\(\), rows = SS\.rows\(O\.statsTab\)/.test(opt) && /SS\.setSort\(n\)/.test(opt);
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
if (!wired) { console.log('FAIL entry point not wired in 15f_options.js'); process.exit(1); }
const muts = [
  ['name sort', (t) => t.replace('a.name < b.name ? -1', 'a.name < b.name ? 1')],
  ['odd grey', (t) => t.replace('i % 2 === 0 ? 0xFFFFFF : 0x909090; return r; });\n  };\n\n  /** ItemStats', 'true ? 0xFFFFFF : 0x909090; return r; });\n  };\n\n  /** ItemStats')],
  ['any positive', (t) => t.replace('if (v > 0) any = true', 'if (v > 5) any = true')],
  ['cols', (t) => t.replace("'mined', 'broken', 'crafted'", "'broken', 'mined', 'crafted'")],
  ['sort flip', (t) => t.replace('SS.sortDir = -SS.sortDir', 'SS.sortDir = -1')],
  ['sort new', (t) => t.replace('SS.sortCol = col; SS.sortDir = -1', 'SS.sortCol = col; SS.sortDir = 1')],
  ['killed_by', (t) => t.replace('killed(?:_by)?', 'killed')],
  ['mob order', (t) => t.replace('SS.ENTITY_ORDER.filter', 'Object.keys(seen).sort().reverse().filter')],
  ['never killed', (t) => t.replace("'You have never killed '", "'You never killed '")],
  ['plural', (t) => t.replace("b === 1 ? '' : 's'", "''")],
  ['dim colour', (t) => t.replace('a ? 0x909090 : 0x606060', '0x909090')],
  ['items tab', (t) => t.replace('active: SS.items().length > 0', 'active: true')],
  ['mobs tab', (t) => t.replace('active: SS.mobs().length > 0', 'active: true')],
  ['rows items', (t) => t.replace("tab === 'items' ? 'items'", "tab === 'items' ? 'general'")],
  ['title case', (t) => t.replace('w.charAt(0).toUpperCase()', 'w.charAt(0)')],
  ['entity name', (t) => t.replace("tnt: 'Primed TNT'", "tnt: 'Tnt'")],
  ['stat name', (t) => t.replace("aviate_one_cm: 'Distance by Elytra'", "aviate_one_cm: 'Distance Flown 2'")],
  ['stack', (t) => t.replace('stack: { i: i, c: 1 }', 'stack: null')],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
// cutting the entry point must be noticed too
for (const [name, re] of [['button', "O.go('stats')"], ['draw', "O.drawStats(c"]]) {
  if (!opt.includes(re)) { console.log('FAIL missing ' + name); process.exit(1); }
  caught++; console.log('   ✓ entry ' + name + ' present');
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
