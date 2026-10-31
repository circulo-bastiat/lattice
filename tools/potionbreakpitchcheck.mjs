#!/usr/bin/env node
// potionbreakpitchcheck (#1624): splash potion break sound pitch = nextFloat()*0.1+0.9
// (WorldRenderer.processWorldEvent 2002/2007), volume 1, NEUTRAL. Not a fixed 1.0.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src/07z_potion.js'), 'utf8');
function run(code) {
  let fails = 0;
  const Po = {};
  new Function('Po', code.match(/Po\.breakPitch = [^\n]*/)?.[0] ?? 'Po.breakPitch=()=>1')(Po);
  if (Po.breakPitch(() => 0) !== 0.9) fails++;
  if (Math.abs(Po.breakPitch(() => 1) - 1.0) > 1e-9) fails++;
  if (Math.abs(Po.breakPitch(() => 0.5) - 0.95) > 1e-9) fails++;
  if (!/entitySound\('entity\.splash_potion\.break', e\.x, e\.y, e\.z, 1, Po\.breakPitch\(NS\.wrand\), 'neutral'/.test(code)) fails++;
  return fails;
}
const real = run(src);
const breaks = [src.replace('rnd() * 0.1 + 0.9', '1'), src.replace('Po.breakPitch(NS.wrand)', '1'), src.replace("'neutral', NS.Player);\n    // loop/potion", "'block', NS.Player);\n    // loop/potion")];
let caught = 0;
for (const b of breaks) if (run(b) > 0) { caught++; console.log('  ✓ break caught'); }
console.log(real === 0 ? `OK  4 checks passed, 0 failures; ${caught} breaks caught` : 'FAIL ' + real);
process.exit(real === 0 && caught === breaks.length ? 0 : 1);
