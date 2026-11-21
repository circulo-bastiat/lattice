#!/usr/bin/env node
// foxglowsoundcheck.mjs — #4258: CaveVines.pickBerries (via the fox's EatSweetBerriesGoal) plays
// block.cave_vines.pick_berries, BLOCKS, vol 1.0, pitch 0.8..1.2. Static check of the glow-berry branch in
// src/07zj_fox.js eatBerry. Anti-vacuity: breaks its own source text.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src', '07zj_fox.js'), 'utf8');
const EV = 'block.cave_vines.pick_berries';
function problems(text) {
  const i = text.indexOf('hasGlowBerries(x, y, z)) {');
  if (i < 0) return ['branch missing'];
  const body = text.slice(i, text.indexOf('return;', i));
  const bad = [];
  if (body.indexOf(EV) < 0) bad.push('no ' + EV);
  if (!/volume: 1\b/.test(body)) bad.push('volume not 1');
  if (!/pitch: 0\.8 \+ rf\(e\)\(\) \* 0\.4/.test(body)) bad.push('pitch not 0.8+rand*0.4');
  if (body.indexOf("source: 'block'") < 0) bad.push('not BLOCKS category');
  return bad;
}
const fails = problems(src);
let breaks = 0;
const caught = (label, text) => {
  if (problems(text).length) breaks++;
  else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
caught('sound removed', src.replace(EV, 'x.y'));
caught('pitch fixed', src.replace('pitch: 0.8 + rf(e)() * 0.4', 'pitch: 1'));
caught('volume 0.3', src.replace("volume: 1, pitch: 0.8", 'volume: 0.3, pitch: 0.8'));
caught('branch gone', src.replace('hasGlowBerries(x, y, z)) {', 'false) {'));
console.log(`${4 - fails.length} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
