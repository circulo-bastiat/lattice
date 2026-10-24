#!/usr/bin/env node
// viewoverlaycheck.mjs — #7875: Hud.underwaterOverlayQuad vs InGameOverlayRenderer.renderUnderwaterOverlay arithmetic.
import fs from 'node:fs';
import vm from 'node:vm';
console.log('viewoverlaycheck — underwater overlay quad');
const src = fs.readFileSync('src/15_hud.js', 'utf8');
const m = src.match(/H\.underwaterOverlayQuad = function[\s\S]*?\n  \};\n/);
if (!m) { console.log('FAIL no underwaterOverlayQuad'); process.exit(1); }
const mk = (code) => { const H = {}; vm.runInNewContext('(function(H){' + code + '})', {Math})(H); return H.underwaterOverlayQuad; };
const fr = Math.fround;
const cases = [[0, 0, 15], [90, 0, 15], [-45, 30, 8], [180, -90, 0], [33.5, 12.25, 12], [720, 89.9, 3]];
function run(fn, perturb) {
  let bad = 0;
  for (const [yaw, pit, lv] of cases) {
    const f = fr(lv / 15), b = fr(f / fr(4 - fr(3 * f)));
    const du = fr(-yaw / 64) + (perturb ? 0.01 : 0), dv = fr(pit / 64);
    const want = [[4 + du, 4 + dv], [du, 4 + dv], [du, dv], [4 + du, dv]].map((p) => p.map(fr));
    const q = fn(yaw, pit, lv);
    if (q.rgba.some((v, i) => v !== [b, b, b, fr(0.1)][i])) bad++;
    else if (JSON.stringify(q.uv) !== JSON.stringify(want)) bad++;
  }
  return bad;
}
const good = run(mk(m[0]), false);
const broke = run(mk(m[0]), true);
console.log(good ? 'FAIL ' + good + ' of ' + cases.length : 'ok ' + cases.length + ' cases; ' + (broke === cases.length ? broke + ' breaks caught' : 'VACUOUS: ' + broke));
process.exit(good || broke !== cases.length ? 1 : 0);
