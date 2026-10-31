#!/usr/bin/env node
// selectorposcheck.mjs — G17-SEL1: selector distance RANGES, x/y/z origin, dx/dy/dz volume, y_rotation.
// .decomp EntitySelectorOptions + NumberRange. Calls Commands.resolve on a stub entity list.
//   node tools/selectorposcheck.mjs [--break]   (--break swaps in the old parseFloat range parse)
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
const cows = [0, 2, 4, 6, 10].map((x, i) => ({ type: 'cow', x, y: 0, z: 0, yaw: i * 90 - 90, pitch: 0, id: i }));
NS.EntityList = { all: () => cows };
NS.Entities = { boxAt: (n, x, y, z) => [x - 0.45, y, z - 0.45, x + 0.45, y + 1.4, z + 0.45] };
NS.Player = null;
const src = { x: 0, y: 0, z: 0 };
const xs = (txt) => { try { return C.resolve(sel(txt), src).map((t) => t.e.x).join(','); } catch (e) { return 'ERR:' + (e.key || e.msgKey || (e.message && e.message.key) || e.message); } };
const EXP = [
  ['@e[type=cow,distance=..5]', '0,2,4'],
  ['@e[type=cow,distance=3..]', '4,6,10'],
  ['@e[type=cow,distance=2..6]', '2,4,6'],
  ['@e[type=cow,distance=4]', '4'],
  ['@e[type=cow,x=10,y=0,z=0,distance=..1]', '10'],
  ['@e[type=cow,x=6,distance=..2.5]', '4,6'],
  ['@e[type=cow,dx=3,dy=2,dz=3]', '0,2,4'],
  ['@e[type=cow,x=5,dx=2]', '6'],
  ['@e[type=cow,y_rotation=0..90]', '2,4'],
  ['@e[type=cow,distance=5..2]', 'ERR:argument.range.swapped'],
  ['@e[type=cow,distance=..]', 'ERR:argument.range.empty'],
];
for (const [t, e] of EXP) { const g = xs(t); ok(g === e, t + ' -> ' + g + ' (want ' + e + ')'); }
// anti-vacuity: the old parseFloat parse would give NaN for `..5` and select everything
{ breaks++; ok(parseFloat('..5') !== parseFloat('..5') && xs('@e[type=cow,distance=..5]') !== '0,2,4,6,10', 'parseFloat form would skip the filter'); }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('selectorposcheck: ' + pass + ' ok, ' + breaks + ' breaks caught');
