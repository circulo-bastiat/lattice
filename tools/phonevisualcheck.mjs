#!/usr/bin/env node
// phonevisualcheck.mjs - #7806 (phone app A): "looks wrong" fails automatically.
// Screenshots every screen in phone-web/qa/screens.json at 360x640, 390x844, 430x932, dark + light, against the mock GitHub (qa/serve.mjs), and audits
// overflow, tap size, contrast, clipping, font size, bottom bar and safe area. Violations present TODAY are frozen in qa/baseline.json (screen|rule|selector);
// the check fails on any NEW one, and later issues shrink the baseline (`node tools/phone-web/qa/shoot.mjs --update-baseline`).
// ANTI-VACUITY: five visual bugs are injected into a copy of the built site (600px element, 30px button, light grey on white, 300-char title, content under the bar).
// Cost ~65 s for the full matrix + ~25 s for the breaks: over the lander's 90 s, so this runs on the mirror full run, not in --core (quarantine-free list: see stage json).
process.setMaxListeners(40);
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findChrome } from './cdp.mjs';
import { build } from './phone-web/build.mjs';
import { shootAll, keys } from './phone-web/qa/shoot.mjs';
const T = dirname(fileURLToPath(import.meta.url)), Q = join(T, 'phone-web', 'qa');
if (!findChrome()) { console.log('SKIP  phonevisualcheck: no Chromium found (set $CHROME to run it)'); console.log('phonevisualcheck: 0 breaks caught [skipped: no Chromium]'); process.exit(process.env.CI_HOSTED_UNFIT ? 0 : 1); } // hosted-unfit
const fails = [], d = mkdtempSync(join(tmpdir(), 'pvc-')), site = join(d, 'site'); build(site);
const rows = await shootAll({ siteDir: site, outDir: join(T, '..', '_status', 'phone-shots') });
const base = new Set(JSON.parse(readFileSync(join(Q, 'baseline.json'), 'utf8'))), now = keys(rows);
const fresh = now.filter((k) => !base.has(k)); for (const k of fresh) fails.push('new visual violation: ' + k);
const stale = [...base].filter((k) => !now.includes(k)); if (stale.length) console.log(`note: ${stale.length} baseline entries no longer occur - shrink qa/baseline.json`);
const head = `${rows.length} shots, ${now.length} known violations, ${fresh.length} new`;
// ---- breaks
const BREAKS = [
  ['a 600 px wide element', 'hscroll', '<div class="qa-brk" style="width:600px;height:20px;background:#f0f">x</div>', ''],
  ['a 30 px button', 'tap', '<button class="qa-brk" style="height:30px !important;min-height:0 !important;width:100px !important;padding:0">tiny</button>', ''],
  ['light grey text on white', 'contrast', '<div class="qa-brk" style="background:#fff;color:#ccc;font-size:16px;padding:4px">pale text</div>', ''],
  ['a 300-char unbroken title', 'hscroll', `<div class="qa-brk" style="font-size:16px">${'W'.repeat(300)}</div>`, ''],
  ['content under the bar', 'bar', '', 'body{padding-bottom:0 !important}'],
];
let caught = 0;
for (const [name, rule, html, css] of BREAKS) {
  const s2 = join(d, 'b' + caught + name.length); build(s2);
  const f = join(s2, 'index.html'), inj = `<style>${css}</style><script>var qa=()=>{if(!document.querySelector('.qa-brk')&&${JSON.stringify(html)})document.body.insertAdjacentHTML('beforeend',${JSON.stringify(html)})};qa();setInterval(qa,150)</script>`;
  writeFileSync(f, readFileSync(f, 'utf8').replace('</body>', inj + '</body>'));
  const r = await shootAll({ siteDir: s2, only: 'home', shots: false, sizes: [[390, 844]], schemes: ['dark'] });
  if (!r) console.log('note: no browser for break ' + name);
  const hit = r && r.some((x) => x.violations.some((v) => v.rule === rule && (rule === 'bar' || /qa-brk/.test(v.sel) || v.rule === 'hscroll')));
  if (hit) caught++; else fails.push(`break not caught: ${name} (expected rule ${rule})`);
}
rmSync(d, { recursive: true, force: true });
for (const f of fails) console.log('FAIL  ' + f);
console.log(`phonevisualcheck: ${caught} breaks caught (of ${BREAKS.length}); ${head}`);
process.exit(fails.length ? 1 : 0);
