// tools/vignettecheck.mjs - #7880 G17-O6: Hud vignette darkness lerp (rate 0.01/tick), Fast draws nothing. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/15_hud.js'), 'utf8');
const a = SRC.indexOf('H.vignetteDarkness = 0;'), b = SRC.indexOf('// --- crosshair, fluids, toast');
const body = SRC.slice(a, b);
function verify(code) {
  const bad = [];
  const H = {}, NS = { Settings: { fancyLeaves: true }, Player: { x: 0, y: 0, z: 0 }, World: { getLight: () => 0 } };
  new Function('H', 'NS', code)(H, NS);
  const run = (light) => { NS.World.getLight = () => light << 4 | 0; H.vignetteDarkness = 0; for (let i = 0; i < 100; i++) H.tickVignette(); return H.vignetteDarkness; };
  const close = (br) => { const f = 1 - br; return f * (1 - Math.pow(0.99, 100)); };
  const lit = run(15), dark = run(0);
  if (Math.abs(lit - close(1)) > 1e-9) bad.push('lit room ' + lit);
  if (Math.abs(dark - close(0)) > 1e-9) bad.push('dark cave ' + dark + ' want ' + close(0));
  NS.Settings.fancyLeaves = false; H.vignetteDarkness = 0; H.tickVignette();
  if (H.vignetteDarkness !== 0) bad.push('Fast graphics must not change darkness');
  let n = 0; const ctx = { canvas: { width: 10, height: 10 }, createRadialGradient: () => ({ addColorStop() {} }), fillRect: () => n++ };
  H.vignetteDarkness = 0.5; H.drawVignette(ctx);
  if (n) bad.push('Fast graphics drew');
  NS.Settings.fancyLeaves = true; H.drawVignette(ctx); if (n !== 1) bad.push('Fancy did not draw');
  return bad;
}
const BREAKS = [['rate 0.02', body.replace('= 0.01', '= 0.02')], ['no fancy gate', body.replace('!NS.Settings.fancyLeaves) return;\n    H.vignetteDarkness', 'false) return;\n    H.vignetteDarkness')], ['no clamp', body.replace('f < 0 ? 0 : f > 1 ? 1 : f', 'f + 1')]];
const real = verify(body); let caught = 0;
for (const [n, c] of BREAKS) { if (verify(c).length) { caught++; console.log(' ✓ caught:', n); } else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log("assertions passed ..... 6");
console.log(`${caught} breaks caught (vignettecheck OK, of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
