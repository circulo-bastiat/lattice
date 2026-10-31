// tools/cameraeyecheck.mjs - #7885: Camera.updateEyeHeight (.decomp Camera.java:62): cameraY += (eye - cameraY) * 0.5 per tick, view y = lerp(partial, last, cur).
// Reads the real P.cameraEyeTick / P.cameraEyeY from src/14_player.js. Anti-vacuity below.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/14_player.js', import.meta.url), 'utf8');
const GFX = readFileSync(new URL('../src/10_gfx.js', import.meta.url), 'utf8');
const load = (src) => {
  const a = src.indexOf('P.cameraEyeTick = function'), b = src.indexOf('P.tick = function');
  const P = { EYE: 1.62, eyeHeight: 1.62 };
  new Function('P', src.slice(a, b))(P);
  return P;
};
const verdict = (src, gfx) => {
  const bad = [], P = load(src);
  P.cameraEyeTick();
  P.eyeHeight = 1.27;
  let y = Math.fround(1.62); const seq = [];
  for (let i = 0; i < 8; i++) { y = Math.fround(y + Math.fround((1.27 - y) * 0.5)); P.cameraEyeTick(); seq.push(y); if (P.camY !== y) bad.push('tick ' + i + ': ' + P.camY + ' != ' + y); }
  if (!(Math.abs(seq[0] - 1.445) < 1e-6) || !(Math.abs(seq[7] - 1.27) < 0.002)) bad.push('decay sequence wrong: ' + seq);
  if (Math.abs(P.cameraEyeY(0.5) - (P.lastCamY + P.camY) / 2) > 1e-9) bad.push('lerp(partial) wrong');
  if (P.eyeHeight !== 1.27) bad.push('ray cast eye changed');
  for (const [pose, eye] of [['swim', 0.4], ['sleep', 0.2]]) {   // pose eye heights ease the same way
    const Q = load(src); Q.cameraEyeTick(); Q.eyeHeight = eye; Q.cameraEyeTick();
    if (Math.abs(Q.camY - (1.62 + (eye - 1.62) * 0.5)) > 1e-6) bad.push(pose + ' pose not eased');
  }
  if (!/cameraEyeY/.test(gfx)) bad.push('syncCamera does not use cameraEyeY');
  return bad;
};
const BREAKS = [
  ['factor 0.3', SRC.replace('(eye - P.camY) * 0.5', '(eye - P.camY) * 0.3'), GFX],
  ['no easing', SRC.replace('(eye - P.camY) * 0.5', '(eye - P.camY) * 1'), GFX],
  ['lerp ignores partial', SRC.replace('P.lastCamY + (P.camY - P.lastCamY) * alpha', 'P.camY'), GFX],
  ['ray eye overwritten', SRC.replace('P.lastCamY = P.camY;', 'P.lastCamY = P.camY; P.eyeHeight = P.camY;'), GFX],
  ['camera not wired', SRC, GFX.replace(/cameraEyeY/g, 'x')],
];
const real = verdict(SRC, GFX); let caught = 0;
for (const [n, s, g] of BREAKS) { if (verdict(s, g).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`cameraeyecheck: ${caught} breaks caught (of ${BREAKS.length}); ${BREAKS.length + 6} assertions`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
