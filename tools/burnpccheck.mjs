// tools/burnpccheck.mjs - #2071 (Dan, 3 Oct): a brain worker that wastes a run on a RED check issue (it has no GPU, so it
// cannot verify browser checks) parks the issue with the label pc-gpu after ONE burn; queue() already skips pc-gpu for brain
// workers. Other issues keep the 2-burns -> blocked rule. Anti-vacuity: each rule is broken in a copy and must be caught.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';   // Windows: import('C:\\...') is ERR_UNSUPPORTED_ESM_URL_SCHEME
const route = readFileSync(new URL('./brain/route.mjs', import.meta.url), 'utf8');
const launch = readFileSync(new URL('./brain/launch.mjs', import.meta.url), 'utf8');
const go = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
const claimfilter = readFileSync(new URL('./infra/claimfilter.mjs', import.meta.url), 'utf8');   // #8981: the pc-gpu rule moved here; claimfiltercheck RUNS it
const cases = [   // [name, labels, expect parked]
  ['red check, first burn', ['bug', 'severe', 'red-check'], true],
  ['already pc-gpu', ['bug', 'red-check', 'pc-gpu'], false],
  ['ordinary bug', ['bug', 'severe'], false],
  ['feature issue', ['enhancement'], false],
  ['no labels', [], false],
];
const bad = (mod) => cases.filter(([, l, want]) => mod.needsPc(l) !== want).map((c) => c[0]);
const load = async (text) => { const f = join(mkdtempSync(join(tmpdir(), 'bpc-')), 'r.mjs'); writeFileSync(f, text); return import(pathToFileURL(f).href); };
let fail = 0;
const real = bad(await load(route)); if (real.length) { fail++; console.log('FAIL needsPc wrong for:', real.join(', ')); }
const wired = /import \{[^}]*\bneedsPc\b[^}]*\} from '\.\/route\.mjs'/.test(launch) && /if \(!produced\) \{[\s\S]{0,400}needsPc\(il\)[\s\S]{0,300}labels: \['pc-gpu'\]/.test(launch);
if (!wired) { fail++; console.log('FAIL launch.mjs does not label a burned red-check issue pc-gpu'); }
if (!/lab\(i, 'pc-gpu'\)/.test(claimfilter) || !/MCLITE_BRAIN === '1'/.test(go)) { fail++; console.log('FAIL go.mjs queue() no longer skips pc-gpu for brain workers'); }
const breaks = [
  [route, "(labels || []).includes('red-check') && ", '', 'parks every issue, not just red checks', async (t) => bad(await load(t))],
  [route, " && !(labels || []).includes('pc-gpu')", '', 'labels an issue that is already pc-gpu', async (t) => bad(await load(t))],
  [launch, "labels: ['pc-gpu']", "labels: ['blocked']", 'launch labels the wrong thing', async (t) => (/labels: \['pc-gpu'\]/.test(t) ? [] : ['x'])],
  [launch, 'needsPc(il)', 'true', 'launch parks without asking needsPc', async (t) => (/needsPc\(il\)/.test(t) ? [] : ['x'])],
];
let caught = 0;
for (const [src, a, b, name, judge] of breaks) {
  if (!src.includes(a)) { fail++; console.log(`FAIL break "${name}" no longer applies`); continue; }
  if ((await judge(src.replace(a, b))).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else { fail++; console.log(`FAIL break "${name}" not caught`); }
}
console.log(`burnpccheck: ${caught} breaks caught (of ${breaks.length})`);
console.log(` failures ........... ${fail}\n assertions passed .... ${cases.length + 2 - fail}`);
process.exit(fail ? 1 : 0);
