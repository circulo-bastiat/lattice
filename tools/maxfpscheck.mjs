// tools/maxfpscheck.mjs - #8339: Max Framerate pacer (Settings.paceFrame / framerateLimit) driven by a fake 144 Hz clock. Anti-vacuity below.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/16_settings.js', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../src/17_main.js', import.meta.url), 'utf8');
const blk = SRC.slice(SRC.indexOf('// PACER-BEGIN'), SRC.indexOf('// PACER-END'));
const mk = (b) => { const S = { maxFps: 120 }; new Function('S', b)(S); return S; };
const frames = (S, limit) => { const st = { next: 0 }; let n = 0; for (let t = 0; t < 10000; t += 1000 / 144) if (S.paceFrame(st, t, limit)) n++; return n / 10; };
const verdict = (b, main) => {
  const bad = [], S = mk(b);
  for (const [lim, want] of [[30, 30], [60, 60], [260, 144]]) { const f = frames(S, lim); if (Math.abs(f - want) > 1.5) bad.push(`limit ${lim}: ${f} fps, want ~${want}`); }
  S.maxFps = 144; if (S.framerateLimit(false, true) !== 60) bad.push('title menu cap 60 missing');
  if (S.framerateLimit(true, true) !== 144 || S.framerateLimit(false, false) !== 144) bad.push('cap applied outside title');
  if (!/paceFrame\(Main\.pace/.test(main)) bad.push('main loop does not pace');
  return bad;
};
const BREAKS = [
  ['limit ignored', blk.replace('var iv = 1000 / limit;', 'return true; var iv = 1000 / limit;'), MAIN],
  ['menu cap gone', blk.replace('? 60 :', '? S.maxFps :'), MAIN],
  ['cap everywhere', blk.replace('(!hasWorld && hasScreen) ?', 'true ?'), MAIN],
  ['loop unpaced', blk, MAIN.replace('paceFrame(Main.pace', 'x(Main.pace')],
];
const real = verdict(blk, MAIN); let caught = 0;
for (const [n, b, m] of BREAKS) { if (verdict(b, m).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`maxfpscheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
