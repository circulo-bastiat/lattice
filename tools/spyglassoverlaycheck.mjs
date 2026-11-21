#!/usr/bin/env node
// spyglassoverlaycheck.mjs — #8065: InGameHud.renderSpyglassOverlay geometry + scale lerp (.decomp InGameHud:965, 174).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HUD = readFileSync(join(ROOT, 'src/15_hud.js'), 'utf8');
function load(src) {
  const H = {};
  const a = src.match(/H\.spyglassRect = function[\s\S]*?\n  \};/), b = src.match(/H\.spyglassStep = function[^\n]*/);
  if (!a || !b) return null;
  new Function('H', a[0] + '\n' + b[0])(H);
  return H;
}
function run(src) {
  const f = [], H = load(src);
  if (!H) return ['spyglass overlay missing'];
  const no = (c, m) => { if (!c) f.push(m); };
  const r = H.spyglassRect(400, 200, 1);
  no(r[0] === 100 && r[1] === 0 && r[2] === 300 && r[3] === 200, 'scale 1 on 400x200: centred 200 square, got ' + r);
  const q = H.spyglassRect(400, 200, 0.5);
  no(q[0] === 150 && q[1] === 50 && q[2] === 250 && q[3] === 150, 'scale 0.5 halves the square, got ' + q);
  const p = H.spyglassRect(200, 400, 1.125);
  no(p[0] === -12.5 && p[2] === 212.5, 'scale 1.125 overshoots the narrow axis, got ' + p);
  const s = H.spyglassStep(0.5, 1);
  no(Math.abs(s - 0.8125) < 1e-9, 'one tick lerps halfway to 1.125, got ' + s);
  return f;
}
const bad = run(HUD);
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
let caught = 0;
for (const [a, b] of [['h / m) * scale', 'h / m) * 1'], ['(w - sz) / 2', '(w - sz) / 3'], ['1.125 - scale', '1.0 - scale'], ['Math.min(w / m, h / m)', 'Math.max(w / m, h / m)']]) {
  if (!HUD.includes(a)) { console.error('break target missing: ' + a); process.exit(1); }
  if (run(HUD.replace(a, b)).length) caught++;
}
if (caught < 4) { console.error('only ' + caught + ' breaks caught'); process.exit(1); }
console.log(`spyglassoverlaycheck OK — 4 cases; ${caught} breaks caught`);
