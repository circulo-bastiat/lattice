// shoot.mjs - screenshots of every registered screen at 3 phone sizes, dark + light, and the layout assertions (#7806).
//   node tools/phone-web/qa/shoot.mjs [--site <dir>] [--out <dir>] [--only <screen>]   -> <out>/<screen>-<w>-<scheme>.png + report.json
// Rules per screen: hscroll, tap (>=44x44), contrast (4.5 / 3 large), clip (no silent overflow clipping), font (>=14px; captions 12px marked .cap/<small>),
// bar (last content clears the bottom bar), safe (bar/body pad env(safe-area-inset-bottom)).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { open } from '../../cdp.mjs';
import { build } from '../build.mjs';
import { start } from './serve.mjs';
const here = dirname(fileURLToPath(import.meta.url));
export const SIZES = [[360, 640], [390, 844], [430, 932]], SCHEMES = ['dark', 'light'];
/** runs in the page; returns [{rule, sel, msg}] */
export function audit(vw) {   // vw = the device width asked for: a mobile page that overflows widens innerWidth, so it cannot be read back
  const out = [], sel = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; else if (e.classList.length) s += '.' + [...e.classList].join('.'); return s; };
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && c.opacity !== '0'; };
  const all = [...document.body.querySelectorAll('*')].filter(vis);
  if (document.documentElement.scrollWidth > vw) out.push({ rule: 'hscroll', sel: 'html', msg: `scrollWidth ${document.documentElement.scrollWidth} > ${vw}` });
  for (const e of all) { const r = e.getBoundingClientRect(); if (r.right > vw + 1 && !e.closest('[data-qa-scroll]') && !(function sc(x) { for (; x && x !== document.body; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if ((o === 'auto' || o === 'scroll') && x.scrollWidth > x.clientWidth) return true; } return false; })(e.parentElement)) out.push({ rule: 'hscroll', sel: sel(e), msg: `right edge ${Math.round(r.right)} > ${vw}` }); }
  for (const e of all.filter((x) => x.matches('a[href],button,input,select,textarea,summary,[role=button],[onclick]'))) { const r = e.getBoundingClientRect(); if (e.matches('input[type=hidden]')) continue; if (r.width < 43.5 || r.height < 43.5) out.push({ rule: 'tap', sel: sel(e), msg: `${Math.round(r.width)}x${Math.round(r.height)}` }); }
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return [0, 0, 0, 0]; const a = m[1].split(',').map(Number); return [a[0], a[1], a[2], a.length > 3 ? a[3] : 1]; };
  const bgOf = (e) => { const st = []; for (let x = e; x; x = x.parentElement) { const c = parse(getComputedStyle(x).backgroundColor); if (c[3] > 0) { st.push(c); if (c[3] === 1) break; } } let b = [255, 255, 255]; if (!st.length || st[st.length - 1][3] < 1) b = matchMedia('(prefers-color-scheme: dark)').matches ? [0, 0, 0] : [255, 255, 255]; for (const c of st.reverse()) b = [0, 1, 2].map((i) => c[i] * c[3] + b[i] * (1 - c[3])); return b; };
  const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const lbar = document.getElementById('tabs');
  for (const e of all) {
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own) continue;
    const c = getComputedStyle(e), fs = parseFloat(c.fontSize), bold = parseInt(c.fontWeight) >= 700, large = fs >= 24 || (fs >= 18.66 && bold), fg = parse(c.color), bg = bgOf(e);
    const f = fg[3] < 1 ? [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])) : fg, L1 = lum(f), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (ratio < (large ? 3 : 4.5)) out.push({ rule: 'contrast', sel: sel(e), msg: `${ratio.toFixed(2)}:1 (need ${large ? 3 : 4.5})` });
    const cap = e.closest('.cap,small,[data-caption]'); if (fs < (cap ? 12 : 14) - 0.01) out.push({ rule: 'font', sel: sel(e), msg: `${fs}px${cap ? ' caption' : ''}` });
  }
  for (const e of all) { const c = getComputedStyle(e); if ((e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) && e.clientWidth > 0 && /hidden|clip/.test(c.overflowX + c.overflowY) && !/ellipsis/.test(c.textOverflow) && c.webkitLineClamp === 'none' && !e.closest('[data-qa-scroll]')) out.push({ rule: 'clip', sel: sel(e), msg: `content ${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight}` }); }
  if (lbar && vis(lbar)) {
    const top = lbar.getBoundingClientRect().top, ds = document.documentElement, bottom = Math.max(...all.filter((e) => !lbar.contains(e) && getComputedStyle(e).position !== 'fixed').map((e) => e.getBoundingClientRect().bottom + scrollY));
    const room = ds.scrollHeight - (bottom); const need = lbar.getBoundingClientRect().height;
    if (room < need - 1) out.push({ rule: 'bar', sel: 'nav#tabs', msg: `last content ends ${Math.round(ds.scrollHeight - bottom)}px above page end, bar is ${Math.round(need)}px` });
    if (!/safe-area-inset-bottom/.test(window.__qaCss || '')) out.push({ rule: 'safe', sel: 'nav#tabs', msg: 'no env(safe-area-inset-bottom) in the stylesheet' });
  }
  return out;
}
export async function shootAll({ siteDir, outDir, only, shots = true, sizes = SIZES, schemes = SCHEMES } = {}) {
  if (!siteDir) { siteDir = mkdtempSync(join(tmpdir(), 'phoneqa-')); build(siteDir); }
  const screens = JSON.parse(readFileSync(join(here, 'screens.json'), 'utf8')).filter((s) => !only || s.id === only), { srv, origin } = await start(siteDir);
  const page = await open(origin + '/index.html', { port: 9441, width: 390, height: 844, initScript: `localStorage.setItem('gh-token','t');localStorage.setItem('gh-api','${origin}');localStorage.setItem('gh-refresh-ms','600000');` });
  if (!page) { srv.close(); return null; }
  const rows = [], ev = (code) => page.evaluate(new Function(code));
  try {
    if (shots) mkdirSync(outDir, { recursive: true });
    for (const [w, h] of sizes) for (const sc of schemes) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: sc }] });
      for (const s of screens) {
        await ev(`location.hash=${JSON.stringify(s.hash)};`); await ev('window.__qaOld=1;location.reload();'); await page.waitFor(() => !window.__qaOld && document.readyState === 'complete', 8000); await new Promise((r) => setTimeout(r, 1000));
        await page.waitFor(() => document.readyState === 'complete', 5000);
        const v = await ev(`window.__qaCss=[...document.styleSheets].map(s=>{try{return [...s.cssRules].map(r=>r.cssText).join('')}catch(e){return ''}}).join('');return (${audit.toString()})(${w})`);
        if (shots) { const r = await page.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, `${s.id}-${w}-${sc}.png`), Buffer.from(r.data, 'base64')); }
        rows.push({ screen: s.id, w, scheme: sc, violations: v || [] });
      }
    }
  } finally { try { await page.close(); } catch { /* gone */ } srv.close(); }
  if (shots) writeFileSync(join(outDir, 'report.json'), JSON.stringify(rows, null, 1));
  return rows;
}
/** a violation's identity for the baseline: screen|rule|selector (sizes and schemes merged) */
export const keys = (rows) => [...new Set(rows.flatMap((r) => r.violations.map((v) => `${r.screen}|${v.rule}|${v.sel}`)))].sort();
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv, g = (n) => a.includes(n) ? a[a.indexOf(n) + 1] : null, root = join(here, '..', '..', '..');
  const rows = await shootAll({ siteDir: g('--site'), outDir: g('--out') || join(root, '_status', 'phone-shots'), only: g('--only') });
  if (!rows) { console.log('no Chromium'); process.exit(0); }
  const k = keys(rows); console.log(`${rows.length} shots, ${k.length} distinct violations`); if (a.includes('--update-baseline')) { writeFileSync(join(here, 'baseline.json'), JSON.stringify(k, null, 1)); console.log('baseline written'); }
  process.exit(0);
}
