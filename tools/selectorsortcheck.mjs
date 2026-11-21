#!/usr/bin/env node
// selectorsortcheck.mjs — G17-SEL3: sort=nearest/furthest/random/arbitrary, limit after sort, dead excluded.
//   node tools/selectorsortcheck.mjs [--break]  (--break: sort= parse ignored -> must fail)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = fileURLToPath(new URL('..', import.meta.url)) + 'src';
const NS = {}; globalThis.MCL = NS;
const FILES = ['00_ns.js', '01_util.js', '14h_brigadier.js', '15g_commands.js'];
for (const f of FILES) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
const C = NS.Commands, M = C.arg;
try { C.build(); } catch (e) { /* only B needs binding */ }
const sel = (txt) => M.entity(false, false).parse(new NS.Brig.Reader(txt), null);
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const xsPos = [10, 2, 6, 0, 4];
const cows = xsPos.map((x, i) => ({ type: 'cow', x, y: 0, z: 0, id: i }));
cows.push({ type: 'cow', x: 1, y: 0, z: 0, dead: true, id: 9 });
NS.EntityList = { all: () => cows };
NS.Entities = {};
NS.Player = null;
const src = { x: 0, y: 0, z: 0 };
const xs = (txt) => { try { return C.resolve(sel(txt), src).map((t) => t.e.x).join(','); } catch (e) { return 'ERR:' + (e.key || e.msgKey || (e.message && e.message.key) || e.message); } };
const EXP = [
  ['@e[type=cow]', '10,2,6,0,4'],
  ['@e[type=cow,sort=nearest,limit=2]', '0,2'],
  ['@e[type=cow,sort=furthest,limit=1]', '10'],
  ['@e[type=cow,sort=furthest]', '10,6,4,2,0'],
  ['@e[type=cow,limit=2]', '10,2'],
  ['@e[type=cow,sort=arbitrary,limit=3]', '10,2,6'],
  ['@e[type=cow,limit=0]', 'ERR:argument.entity.options.limit.toosmall'],
  ['@e[type=cow,sort=bogus]', 'ERR:argument.entity.options.sort.irreversible'],
];
for (const [t, e] of EXP) { const g = xs(t); ok(g === e, t + ' -> ' + g + ' (want ' + e + ')'); }
{ const g = xs('@e[type=cow,sort=random]').split(',').sort().join(','); ok(g === '0,10,2,4,6', 'random keeps all alive: ' + g); }
{ const g = xs('@e[type=cow,sort=random,limit=1]').split(','); ok(g.length === 1, 'random limit=1'); }
{ ok(!xs('@e[type=cow]').split(',').includes('1'), 'dead never returned'); }
// anti-vacuity: with sort ignored the nearest result is the first two in list order
{ breaks++; ok(xs('@e[type=cow,limit=2]') !== xs('@e[type=cow,sort=nearest,limit=2]'), 'sort changes the result'); }
{ breaks++; ok(xs('@e[type=cow,sort=furthest,limit=1]') !== xs('@e[type=cow,sort=nearest,limit=1]'), 'furthest differs from nearest'); }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('selectorsortcheck: ' + pass + ' ok, ' + breaks + ' breaks caught');
