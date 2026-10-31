// chunkbordercheck — F3+G chunk-border geometry vs ChunkBorderDebugRenderer (.decomp). Player (5.5, 70, -20.5).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NS = {};
new Function('MCL', readFileSync(join(ROOT, 'src/07zzr_chunkborder.js'), 'utf8').replace(/\}\)\(typeof MCL[\s\S]*$/, '})(MCL);'))(NS);
let fails = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL ' + n + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); } };

function run(CB, shift) {
  const g = CB.geometry(5.5, -20.5);
  if (shift) g[1].verts[0][0] += 1;
  return g;
}
function verify(g) {
  const bad = [];
  const [thin, thick] = g;
  const E = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(n); };
  E('widths', [thin.width, thick.width], [1, 2]);
  // chunk of (5.5,-20.5) is (0,-2): x0=0, z0=-32
  E('thin count', thin.verts.length, 16 * 4 + 2 * 7 * 2 * 4 + 161 * 7);
  E('thick count', thick.verts.length, 4 * 4 + (Math.floor(320 / 16) + 1) * 7);
  E('thick first', thick.verts[0], [0, -64, -32, 0.25, 0.25, 1, 0]);
  E('thick second', thick.verts[1], [0, -64, -32, 0.25, 0.25, 1, 1]);
  E('thick top', thick.verts[2], [0, 256, -32, 0.25, 0.25, 1, 1]);
  E('red', thin.verts[1], [-16, -64, -48, 1, 0, 0, 0.5]);
  const ys = thin.verts.map(v => v[1]);
  E('extent', [Math.min(...ys), Math.max(...ys)], [-64, 256]);
  E('teal', thin.verts[72 + 1].slice(3), [0, 155 / 255, 155 / 255, 1]);
  E('yellow', thin.verts[64 + 1].slice(3), [1, 1, 0, 1]);
  return bad;
}
const CB = NS.ChunkBorder;
const ok = verify(run(CB, false));
if (ok.length) { fails++; console.log('FAIL geometry: ' + ok.join(',')); }
const g = run(CB, false);
const lineInfo = ('thin ' + g[0].verts.length + ' verts, thick ' + g[1].verts.length + ' verts');
let caught = 0;
if (!/shift/.test(readFileSync(join(ROOT, 'tools/chunkbordercheck.mjs'), 'utf8'))) { fails++; console.log('FAIL no-op break'); }
if (verify(run(CB, true)).length) { caught++; console.log('✓ shifted edge caught'); } else { fails++; console.log('FAIL anti-vacuity: shifted edge passed'); }
eq('toggle on', CB.toggle(), 'Chunk borders: shown');
eq('toggle off', CB.toggle(), 'Chunk borders: hidden');
console.log(fails ? fails + ' failures' : 'chunkbordercheck: 12 checks passed, ' + caught + ' breaks caught; ' + lineInfo);
process.exit(fails ? 1 : 0);
