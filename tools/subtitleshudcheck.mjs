#!/usr/bin/env node
// subtitleshudcheck.mjs -- #8340: SubtitlesHud entry list, arrows, expiry, merge. Anti-vacuity: edited source must fail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const SRC = readFileSync(fileURLToPath(new URL('../src/15l_subtitles.js', import.meta.url)), 'utf8');

function run(edit) {
  let s = SRC;
  if (edit) { if (!s.includes(edit[0])) throw new Error('edit target missing'); s = s.replace(edit[0], edit[1]); }
  const NS = {}; new Function('MCL', s)(NS);
  const SH = NS.SubtitlesHud, errs = [];
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) errs.push(m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); };
  const L = { x: 0, y: 0, z: 0, yaw: 0 }; // yaw 0 looks +z, right is -x
  SH.add('a', { x: -5, y: 0, z: 0 }, 0, L);
  SH.add('b', { x: 5, y: 0, z: 0 }, 100, L);
  SH.add('c', { x: 0, y: 0, z: 8 }, 200, L);
  let r = SH.rows(1000, L);
  eq(r.map(x => x.key + x.arrow), ['a>', 'b<', 'c'], 'arrows');
  eq(r.map(x => x.color), [Math.floor(255 - 180 * 5 / 16), Math.floor(255 - 180 * 5 / 16), Math.floor(255 - 90)], 'color');
  eq(r.map(x => x.alpha), [1, 1, 1], 'alpha');
  r = SH.rows(2500, L); eq(r[0].alpha, 0.5, 'fade');
  eq(SH.rows(3000, L).length, 3, 'a alive at exactly 3000');
  eq(SH.rows(3001, L).map(x => x.key), ['b', 'c'], 'a expired at 3001');
  SH.add('b', { x: 9, y: 0, z: 0 }, 3050, L); // farther: time refreshed, position kept
  eq(SH.entries.find(e => e.key === 'b').pos.x, 5, 'closest kept');
  eq(SH.rows(6000, L).map(x => x.key), ['b'], 'b refreshed to 3050');
  SH.enabled = false; SH.add('z', { x: 0, y: 0, z: 1 }, 6000, L); eq(SH.entries.length, 1, 'disabled');
  return errs;
}
const base = run(null);
if (base.length) { console.log('FAIL', base); process.exit(1); }
let caught = 0;
for (const e of [['LIFE: 3000', 'LIFE: 5000'], ["s > SH.ARROW ? '>' : s < -SH.ARROW ? '<'", "s > SH.ARROW ? '<' : s < -SH.ARROW ? '>'"]]) if (run(e).length) caught++;
if (caught !== 2) { console.log('FAIL: only ' + caught + ' breaks caught'); process.exit(1); }
console.log('subtitleshudcheck -- #8340: ' + caught + ' breaks caught');
