#!/usr/bin/env node
// fovmultcheck.mjs — G17-V1: the world FOV multiplier against a transcription of the decompiled arithmetic
// (AbstractClientPlayerEntity.getFovMultiplier + GameRenderer.updateFovMultiplier).
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';

const fr = Math.fround;
// independent transcription, written from .decomp (not from src/14kb_fovmult.js)
function ref(attr, flying, scale, ticks) {
  let t = 1;
  if (flying) t *= fr(1.1);
  t = fr(t * fr(fr(fr(attr) / fr(0.1) + 1) / 2));
  t = fr(1 + (t - 1) * scale);
  let m = 1; const out = [];
  for (let i = 0; i < ticks; i++) {
    m = fr(m + fr((t - m) * 0.5));
    if (m > 1.5) m = 1.5; if (m < 0.1) m = 0.1;
    out.push(m);
  }
  return out;
}
const cases = [
  ['walk', {}, 0.1, false], ['sprint', { sprinting: true }, 0.1 * 1.3, false],
  ['speed2', { effects: { speed: { amplifier: 1, duration: 100 } } }, 0.1 * 1.4, false],
  ['slow4', { effects: { slowness: { amplifier: 3, duration: 100 } } }, 0.1 * 0.4, false],
  ['fly', { flying: true }, 0.1, true],
];

function run(patch) {
  const MCL = loadEngine({ extra: ['07q_effects.js', '14kb_fovmult.js'], patch });
  const FM = MCL.FovMult;
  let bad = 0, n = 0;
  for (const [name, p, attr, fly] of cases) for (const sc of [0, 0.5, 1]) {
    const want = ref(attr, fly, sc, 10);
    FM.cur = FM.last = 1;
    const got = [];
    for (let i = 0; i < 10; i++) { FM.tick(p, sc); got.push(FM.cur); }
    n++;
    if (want.some((w, i) => Math.abs(w - got[i]) > 1e-6)) { bad++; console.log(`  MISMATCH ${name} scale ${sc}`, want.slice(0, 3), got.slice(0, 3)); }
  }
  return { bad, n };
}

const base = run();

let fail = base.bad > 0;
const breaks = [
  ['smoothing 0.5->0.4', (f, s) => f === '14kb_fovmult.js' ? s.replace('* 0.5));', '* 0.4));') : s],
  ['sprint 1.3->1.2', (f, s) => f === '14kb_fovmult.js' ? s.replace('v *= 1.3', 'v *= 1.2') : s],
  ['flying 1.1->1.2', (f, s) => f === '14kb_fovmult.js' ? s.replace('fr(1.1)', 'fr(1.2)') : s],
  ['speed step', (f, s) => f === '14kb_fovmult.js' ? s.replace('0.2 * (a + 1)', '0.3 * (a + 1)') : s],
];
let caught = 0;
const srcFm = fs.readFileSync(new URL('../src/14kb_fovmult.js', import.meta.url), 'utf8');
for (const [name, patch] of breaks) if (patch('14kb_fovmult.js', srcFm) === srcFm) { console.log('  no-op break (pattern not found):', name); fail = true; }
for (const [name, patch] of breaks) {
  const r = run(patch);
  if (r.bad > 0) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log('  NOT CAUGHT:', name);
}
console.log(`fovmultcheck: ${base.n} assertions, ${base.bad} failures, ${caught} breaks caught`);
if (caught !== breaks.length) fail = true;
process.exit(fail ? 1 : 0);
