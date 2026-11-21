// antivacgapcheck (#11379): every anti-vacuity gap in tools/antivac-gaps.json must beat 5x its measured noise,
// and the two flaky checks must carry the noise-scaled rule in their source (not a bare ratio like `* 0.85`).
import { readFileSync } from 'node:fs';
const ROOT = new URL('../', import.meta.url).pathname;
const gaps = JSON.parse(readFileSync(ROOT + 'tools/antivac-gaps.json', 'utf8'));
// #11379 class rule: an entry fails unless it has a 20-run basis, every run green, and (real - reverted) > 5 * noise (noise floored at 1 px / 0.001 blocks)
const failing = (g) => Object.entries(g).filter(([k, v]) => !k.startsWith('_') && !(v.runs >= 20 && v.green === v.runs && v.real - v.reverted > 5 * Math.max(v.noise, v.floor || 1))).map(([k]) => k);
const srcBad = (b, m) => (!/5 \* avNoise/.test(b) || /aSeen\.differing \* 0\.85/.test(b) || !/ever displacement|own displacement/.test(m));
let caught = 0, bad = [];
const real = failing(gaps);
if (real.length) bad.push('gap below 5x noise: ' + real);
const b = readFileSync(ROOT + 'tools/bowdrawcheck.mjs', 'utf8'), m = readFileSync(ROOT + 'tools/mobpackcheck.mjs', 'utf8');
if (srcBad(b, m)) bad.push('flaky checks lost their noise-scaled anti-vacuity rule');
// breaks: each corruption must be detected
const c1 = JSON.parse(JSON.stringify(gaps)); c1['bowdrawcheck.arrow'].reverted = 1500; if (failing(c1).length) caught++; else bad.push('break 1 missed');
const c5 = JSON.parse(JSON.stringify(gaps)); c5['bowdrawcheck.arrow'].runs = 1; if (failing(c5).length) caught++; else bad.push('break 5 missed (single-run basis accepted)');
const c6 = JSON.parse(JSON.stringify(gaps)); c6['bowdrawcheck.arrow'].green = 19; if (failing(c6).length) caught++; else bad.push('break 6 missed (a red run accepted)');
for (const k of ['bowdrawcheck.arrow', 'mobpackcheck.frozen']) if (!gaps[k]) bad.push('missing measured entry ' + k);
const c2 = JSON.parse(JSON.stringify(gaps)); c2['bowdrawcheck.arrow'].noise = 1000; if (failing(c2).length) caught++; else bad.push('break 2 missed');
if (srcBad(b.replaceAll('5 * avNoise', '20'), m)) caught++; else bad.push('break 3 missed');
if (srcBad(b, m.replace(/own displacement/g, 'x'))) caught++; else bad.push('break 4 missed');
console.log(bad.length ? 'FAIL ' + bad.join('; ') : `antivacgapcheck ok, ${caught} breaks caught`);
process.exit(bad.length ? 1 : 0);
