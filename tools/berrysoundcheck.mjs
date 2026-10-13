#!/usr/bin/env node
// berrysoundcheck.mjs — #535: SweetBerryBushBlock.onUse plays ITEM_SWEET_BERRIES_PICK_FROM_BUSH (BLOCKS, vol 1.0,
// pitch 0.8 + rand*0.4) when berries are picked. Static check of the sweet_berry_bush branch in src/14l_use.js.
// Anti-vacuity: breaks its own source text.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src', '14l_use.js'), 'utf8');
const EV = 'item.sweet_berries.pick_from_bush';
function problems(text) {
  const bad = [];
  const i = text.indexOf("bname === 'sweet_berry_bush'");
  if (i < 0) return ['branch missing'];
  const j = text.indexOf('return true;', i);
  const body = text.slice(i, j);
  if (body.indexOf(EV) < 0) bad.push('no ' + EV);
  if (!/volume: 1\b/.test(body)) bad.push('volume not 1');
  if (!/pitch: 0\.8 \+ Math\.random\(\) \* 0\.4/.test(body)) bad.push('pitch not 0.8+rand*0.4');
  if (body.indexOf('source: \'block\'') < 0) bad.push('not BLOCKS category');
  return bad;
}
const fails = problems(src);
let breaks = 0;
const caught = (label, text) => {
  if (problems(text).length) { breaks++; console.log('   ✓ break caught: ' + label); }
  else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
caught('sound removed', src.replace(EV, 'x.y'));
caught('pitch fixed', src.replace('pitch: 0.8 + Math.random() * 0.4', 'pitch: 1'));
caught('volume 0.3', src.replace('volume: 1, pitch: 0.8', 'volume: 0.3, pitch: 0.8'));
caught('branch gone', src.replace("bname === 'sweet_berry_bush'", "bname === 'nope'"));
console.log('\n================ berrysoundcheck ================');
console.log(` assertions passed .. ${4 - fails.length}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
