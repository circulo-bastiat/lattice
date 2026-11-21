#!/usr/bin/env node
// playerlistcheck.mjs - G17-O9. PlayerListHud layout, ordering and visibility from src/15k_playerlist.js.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/15k_playerlist.js'), 'utf8');
const load = (s) => { const NS = {}; new Function('MCL', s.replace(/\}\)\(MCL\);\s*$/, '})(MCL);'))(NS); return NS.PlayerList; };
let asserted = 0;
function verify(P) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ name: 'p' + i, mode: 'survival', team: '' }));
  const w = () => 30;
  let L = P.layout(mk(1), 320, w, null, true);
  no(L.rows === 1 && L.cols === 1 && L.colW === 52 && L.width === 52 && L.x0 === 134, '1 entry: ' + JSON.stringify([L.rows, L.cols, L.colW, L.x0]));
  L = P.layout(mk(21), 640, w, null, true);   // 21 -> 2 cols of 11
  no(L.rows === 11 && L.cols === 2 && L.colW === 52 && L.width === 109 && L.x0 === 266, '21 entries: ' + JSON.stringify([L.rows, L.cols, L.colW, L.width, L.x0]));
  L = P.layout(mk(81), 640, w, null, true);   // capped at 80 -> 4 cols of 20
  no(L.sorted.length === 80 && L.rows === 20 && L.cols === 4 && L.width === 4 * 52 + 15, '81 entries: ' + JSON.stringify([L.sorted.length, L.rows, L.cols]));
  no(L.cells[20].x === L.x0 + 57 && L.cells[20].y === 10 && L.cells[19].y === 10 + 19 * 9, 'cell placement');
  L = P.layout(mk(1), 320, w, { hearts: true }, true);
  no(L.colW === 142, 'hearts objective adds 90: ' + L.colW);
  L = P.layout(mk(1), 320, w, { hearts: false, scoreW: 12 }, false);
  no(L.colW === 55, 'integer objective adds the score width, no head: ' + L.colW);
  const o = [{ name: 'zed', mode: 'spectator', team: '' }, { name: 'Bob', mode: 'survival', team: 'b' }, { name: 'amy', mode: 'survival', team: 'b' }, { name: 'Cy', mode: 'creative', team: 'a' }];
  no(P.layout(o, 320, w, null, true).sorted.map((e) => e.name).join() === 'Cy,amy,Bob,zed', 'order: spectators last, team, name (ignore case)');
  no(!P.visible(true, true, 1, null), 'singleplayer, one entry, no objective: hidden');
  no(P.visible(true, true, 1, {}), 'objective set: shown');
  no(P.visible(true, true, 2, null) && !P.visible(false, false, 5, null), 'two players shown; key up hidden');
  no(P.pingIcon(-1) === 5 && P.pingIcon(149) === 0 && P.pingIcon(150) === 1 && P.pingIcon(1000) === 4, 'ping icons');
  return f;
}
const bad = verify(load(SRC));
if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
const BREAKS = [
  ['spectators first', (s) => s.replace('return sa ? 1 : -1', 'return sa ? -1 : 1')],
  ['team ignored', (s) => s.replace("if (ta !== tb)", 'if (false)')],
  ['visibility', (s) => s.replace('singleplayer && count <= 1 && !objective', 'false')],
  ['rows cap', (s) => s.replace('rows > PL.MAX_ROWS', 'rows > 30')],
];
let caught = 0;
for (const [n, fn] of BREAKS) { if (fn(SRC) === SRC) { console.log('no-op break (not found): ' + n); process.exit(1); }
  if (verify(load(fn(SRC))).length) caught++; else console.log('NOT CAUGHT: ' + n); }
if (caught !== BREAKS.length) process.exit(1);
console.log(asserted / (BREAKS.length + 1) + ' checks ok, ' + caught + ' breaks caught');
