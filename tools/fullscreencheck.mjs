// tools/fullscreencheck.mjs - #8338: F11 / options.fullscreen drive the Fullscreen API; fullscreenchange keeps the option true.
// Loads 00_ns.js + 13_input.js into a stubbed window/document. Anti-vacuity: the same run on broken sources must fail.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const rd = (f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
const NSJ = rd('00_ns.js'), INP = rd('13_input.js'), OPT = rd('15f_options.js');
const run = (inp) => {
  const bad = [], L = {}, calls = { req: 0, exit: 0, resize: 0, save: 0 };
  const doc = { fullscreenElement: null, documentElement: { requestFullscreen() { calls.req++; doc.fullscreenElement = this; return Promise.resolve(); } },
    exitFullscreen() { calls.exit++; doc.fullscreenElement = null; return Promise.resolve(); },
    addEventListener(t, f) { (L[t] = L[t] || []).push(f); } };
  const win = { addEventListener(t, f) { (L['w' + t] = L['w' + t] || []).push(f); } };
  const ctx = vm.createContext({ window: win, document: doc, console, Object, Math, Promise });
  try {
    vm.runInContext(NSJ + '\n;this.MCL = MCL;', ctx); vm.runInContext(inp, ctx);
    const NS = ctx.MCL; NS.Settings = { fullscreen: false, save() { calls.save++; } }; NS.Main = { resize() { calls.resize++; } };
    NS.Input.attach({ addEventListener() {} });
    let pd = 0; (L.wkeydown || []).forEach((f) => f({ code: 'F11', key: 'F11', preventDefault() { pd++; } }));
    if (calls.req !== 1) bad.push('F11 must call requestFullscreen once, got ' + calls.req);
    if (!pd) bad.push('F11 must preventDefault');
    (L.fullscreenchange || []).forEach((f) => f());
    if (NS.Settings.fullscreen !== true) bad.push('options.fullscreen must be true after entering');
    if (!calls.resize) bad.push('fullscreenchange must re-run resize / GUI scale');
    doc.fullscreenElement = null; (L.fullscreenchange || []).forEach((f) => f());
    if (NS.Settings.fullscreen !== false) bad.push('leaving fullscreen (no element) must set the option false');
  } catch (e) { bad.push('threw: ' + e.message); }
  if (!/toggle\('Fullscreen'/.test(OPT)) bad.push('Video screen has no Fullscreen row');
  return bad;
};
const BREAKS = [
  ['listener removed', INP.replace("doc.addEventListener('fullscreenchange', FS.onChange);", '')],
  ['F11 ignored', INP.replace("e.code === 'F11'", "e.code === 'F99'")],
  ['option not cleared', INP.replace('S.fullscreen = FS.active();', 'S.fullscreen = true;')],
  ['no resize', INP.replace("NS.Main.resize();      //", "0;      //")],
];
const real = run(INP); let caught = 0;
for (const [n, src] of BREAKS) { if (run(src).length) { caught++; console.log(' ✓ caught:', n); } else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`fullscreencheck: 7 checks passed, ${real.length} failures; ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
