#!/usr/bin/env node
// freezeoverlaycheck.mjs — G17-O4. Survival.freezeScale (HUD powder_snow_outline alpha) = frozenTicks/140 clamped.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src/14d_survival.js'), 'utf8');
const hud = readFileSync(join(ROOT, 'src/15_hud.js'), 'utf8');
function scaleFn(code) {
  const m = code.match(/Sv\.freezeScale = function[\s\S]*?\n  \};/);
  if (!m) return null;
  const Sv = {}; new Function('Sv', m[0])(Sv); return Sv.freezeScale;
}
const WANT = [[0, 0], [35, 0.25], [70, 0.5], [140, 1], [200, 1], [-5, 0]];
function run(code) {
  const f = scaleFn(code); if (!f) return 1;
  let bad = 0;
  for (const [t, a] of WANT) if (Math.abs(f({ frozenTicks: t }) - a) > 1e-9) bad++;
  if (f(null) !== 0) bad++;
  return bad;
}
if (run(src)) { console.error('freezeoverlaycheck FAIL'); process.exit(1); }
if (!/H\.drawFreezeOverlay\(c\)/.test(hud) || !/freezeScale\(NS\.Player\)/.test(hud)) { console.error('HUD not wired'); process.exit(1); }
let caught = 0;
for (const brk of [s => s.replace('/ 140;', '/ 100;'), s => s.replace('f > 1 ? 1', 'f > 1 ? 2'), s => s.replace('e.frozenTicks | 0', '0')])
  if (run(brk(src))) caught++; else { console.error('break survived'); process.exit(1); }
console.log(`freezeoverlaycheck ok: ${WANT.length + 1} cases, ${caught} breaks caught`);
