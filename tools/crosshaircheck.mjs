#!/usr/bin/env node
// crosshaircheck.mjs — #367: the crosshair is icons.png (0,0,15,15), there is no break ring, and the
// attack indicator follows attackStrengthScale (InGameHud.renderCrosshair / renderHotbar).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const load = (extra) => {
  const NS = { Settings: { attackIndicator: 1 }, Player: { breakProgress: 0.5, mode: 0 } };
  globalThis.MCL = NS;
  let src = readFileSync(SRC + '15_hud.js', 'utf8');
  for (const [a, b] of extra || []) src = src.split(a).join(b);
  try { new Function('MCL', 'document', 'window', src)(NS, {}, {}); } catch (e) { console.log('load failed: ' + e.message); process.exit(1); }
  return NS;
};
const run = (extra, p) => {
  const NS = load(extra), H = NS.Hud;
  NS.Hand = { attackStrengthScale: () => p, attackStrengthDelay: () => 12.5 };
  NS.Gui = { ready: true, blits: [], blitPart(c, n, r, x, y, s, f) { this.blits.push([r.join(), x, y, Math.round(r[2] * f)]); } };
  H.w = 640; H.h = 480; H.scale = 2;
  let arcs = 0; const c = { arc() { arcs++; }, fillRect() { arcs += 100; }, beginPath() {}, stroke() {} };
  H.drawCrosshair(c);
  return { blits: NS.Gui.blits, arcs, H };
};
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const good = (extra, p) => {
  const r = run(extra, p);
  const cross = r.blits[0];
  const bar = r.blits.find(b => b[0] === '52,94,16,4');
  return r.arcs === 0 && cross && cross[0] === '0,0,15,15' && cross[1] === 152 * 2 - 0 + 0 - 0 && (p >= 1 || (bar && bar[3] === (p * 17 | 0)));
};
ok(good(null, 0.5), 'p=0.5: cross icon, no ring, fill width 8');
ok(good(null, 0), 'p=0');
ok(run(null, 1).blits.length === 1, 'full charge, no target: cross only');
// anti-vacuity: each break must be caught
const brk = (name, extra, p) => { if (!good(extra, p)) breaks++; else fails.push('break not caught: ' + name); };
brk('ring', [['  H.drawCrosshair = function (c) {', '  H.drawCrosshair = function (c) { c.arc();']], 0.5);
brk('no indicator', [['if (st.mode === 1) {', 'if (false) {']], 0.5);
brk('wrong width', [['(st.p * 17) | 0', '(st.p * 16) | 0']], 0.3);
console.log(fails.length ? 'FAIL ' + fails.join('; ') : `crosshaircheck: ${pass} passed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
