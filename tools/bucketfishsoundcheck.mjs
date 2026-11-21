#!/usr/bin/env node
// bucketfishsoundcheck.mjs — #3184: Bucketable.tryBucket plays item.bucket.fill_fish / fill_axolotl before exchanging the stack.
import { readFileSync } from 'node:fs';
import { SRC } from './loadsrc.mjs';
const src = readFileSync(SRC + '/14l_use.js', 'utf8');
const sound = (s) => { const i = s.indexOf("NS.Sound.play(e.type === 'axolotl' ? 'item.bucket.fill_axolotl' : 'item.bucket.fill_fish'"); const j = s.indexOf('Use.exchangeStack(P, stack, bucketOf, true)'); return i >= 0 && j > i; };
let pass = 0, breaks = 0; const fails = [];
if (sound(src)) pass++; else fails.push('fill_fish/fill_axolotl not played before exchangeStack');
breaks++; if (sound(src.replace('item.bucket.fill_fish', 'item.bucket.fill'))) fails.push('break 1 not caught'); else console.log('   ✓ break 1 caught');
breaks++; if (sound(src.replace("'item.bucket.fill_axolotl'", "'item.bucket.fill_fish'"))) fails.push('break 2 not caught'); else console.log('   ✓ break 2 caught');
console.log(fails.join('\n'));
console.log(`bucketfishsoundcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
