#!/usr/bin/env node
// statsscreencheck.mjs -- G26b: src/15fs_stats.js rows from a seeded stat handler (StatsScreen.java),
// the pause-menu Statistics button, and O.OWED no longer naming 'Statistics'.
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = MCLITE_ROOT + 'assets/';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (!c) fails.push('anti-vacuity: ' + m); };

const M = loadEngine({ extra: ['02g_items.js', '07zzo_stats.js', '15fs_stats.js'] });
M.Items.init({ items: readFileSync(A + 'items.bin').toString('base64'), itemsBytes: JSON.parse(readFileSync(A + 'items.meta.json', 'utf8')).rawBytes });
const St = M.Stats, SS = M.StatsScreen;

function verify(SS, St, tag) {
  St.reset();
  ok(SS.items().length === 0 && SS.mobs().length === 0, tag + ': empty handler -> empty items/mobs lists');
  ok(SS.tabs()[1].active === false && SS.tabs()[2].active === false, tag + ': Items/Mobs tabs inactive when empty');
  St.inc('jump', 1234); St.inc('walk_one_cm', 60000);
  St.set(St.statName('mined', 'stone'), 12); St.set(St.statName('crafted', 'stone'), 3);
  St.set(St.statName('killed', 'zombie'), 2); St.set(St.statName('killed_by', 'skeleton'), 1);
  const g = SS.general();
  ok(g.length === 75, tag + ': general lists all 75 custom stats');
  ok(g.find((r) => r.id === 'jump').value === '1,234', tag + ': jump formatted 1,234');
  ok(g.find((r) => r.id === 'walk_one_cm').value === '0.60 km', tag + ': walk formatted in km');
  ok(g.every((r, i) => i === 0 || g[i - 1].name <= r.name), tag + ': general sorted by name');
  ok(g[0].color === 0xFFFFFF && g[1].color === 0x909090, tag + ': alternating row colours');
  const it = SS.items();
  ok(it.length === 1 && it[0].id === 'stone' && it[0].cells.join() === '12,0,3,0,0,0', tag + ': items row [mined,broken,crafted,used,picked_up,dropped]');
  const mb = SS.mobs();
  ok(mb.length === 2 && mb[0].id === 'skeleton' && mb[1].id === 'zombie', tag + ': mobs = killed or killed_by > 0');
  if (mb.length < 2) return;
  ok(mb[1].killed === 'You killed 2 Zombie' && mb[1].killedBy === 'Zombie has never killed you' && mb[1].killedByColor === 0x606060, tag + ': zombie texts');
  ok(mb[0].killedBy === 'Skeleton killed you 1 time' && mb[0].killed === 'You have never killed Skeleton', tag + ': skeleton texts');
  ok(SS.tabs().every((t) => t.active), tag + ': all tabs active once seeded');
}
verify(SS, St, 'engine');

const n0 = fails.length;
{ const sv = SS.mobs; SS.mobs = () => []; verify(SS, St, 'no-mobs'); caught(fails.length > n0, 'empty mobs list detected'); SS.mobs = sv; fails.length = n0; }
{ const sv = SS.ITEM_COLS; SS.ITEM_COLS = sv.slice().reverse(); verify(SS, St, 'cols'); caught(fails.length > n0, 'reordered item columns detected'); SS.ITEM_COLS = sv; fails.length = n0; }
{ const sv = St.FORMAT.D; St.FORMAT.D = (n) => String(n); verify(SS, St, 'fmt'); caught(fails.length > n0, 'unformatted counts detected'); St.FORMAT.D = sv; fails.length = n0; }

const opt = readFileSync(MCLITE_ROOT + 'src/15f_options.js', 'utf8');
const wired = (t) => !/'Statistics':/.test(t) && /label: 'Statistics', fn: function \(\) \{[^}]*O\.go\('stats'\)/.test(t);
ok(wired(opt), 'pause Statistics is a live button and not in O.OWED');
caught(!wired(opt.replace("O.go('stats')", "O.go('x')")), 'dead Statistics button detected');
caught(!wired(opt.replace("O.OWED = {", "O.OWED = {\n 'Statistics': 'x',")), 'OWED entry back detected');

for (const f of fails) console.log('FAIL ' + f);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
