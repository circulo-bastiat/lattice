#!/usr/bin/env node
// effectviewcheck.mjs — #303 (G23k): night vision strength, blindness fog/sky, nausea ramp + wobble vs .decomp.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const dec = (f) => readFileSync(join(MCLITE_ROOT, '.decomp', f), 'utf8');
const fr = Math.fround;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('effectviewcheck — #303 (G23k), view effects');
const GR = dec('net/minecraft/client/render/GameRenderer.java');
const BR = dec('net/minecraft/client/render/BackgroundRenderer.java');
const CP = dec('net/minecraft/client/network/ClientPlayerEntity.java');
ok(/\$\$2 > 200 \? 1\.0F : 0\.7F \+ MathHelper\.sin\(\(\(float\)\$\$2 - \$\$1\) \* \(float\) Math\.PI \* 0\.2F\) \* 0\.3F/.test(GR), 'java: night vision curve');
ok(/Math\.min\(1\.0F, \(float\)\$\$17 \/ 20\.0F\), \$\$2, 5\.0F/.test(BR) && /\$\$18 \* 0\.25F/.test(BR) && /\$\$18 \* 0\.8F/.test(BR), 'java: blindness fog');
ok(/\$\$38 < 20/.test(BR) && /1\.0F - \(float\)\$\$38 \/ 20\.0F/.test(BR), 'java: blindness sky ramp');
ok(/\+= 0\.0125F/.test(CP) && /\+= 0\.006666667F/.test(CP) && /-= 0\.05F/.test(CP) && /getDuration\(\) > 60/.test(CP), 'java: nausea constants');
ok(/\? 7 : 20/.test(GR) && /5\.0F \/ \(\$\$7 \* \$\$7 \+ 5\.0F\) - \$\$7 \* 0\.04F/.test(GR), 'java: wobble');

function run(EV) {
  const nv = (d, p) => EV.nightVisionStrength(d, p);
  ok(nv(201, 0.3) === 1 && nv(1000, 0) === 1, 'nv >200 is 1');
  ok(Math.abs(nv(200, 0) - (0.7 + Math.sin(200 * Math.PI * 0.2) * 0.3)) < 1e-4, 'nv 200 formula');
  ok(Math.abs(nv(100, 0.5) - (0.7 + Math.sin((99.5) * Math.PI * 0.2) * 0.3)) < 1e-5, 'nv blink');
  for (let d = 0; d <= 200; d++) { const v = nv(d, 0.25); ok(v >= 0.4 - 1e-6 && v <= 1 + 1e-6, 'nv range ' + d); }
  let f = EV.blindnessFog(100, 128, false); ok(f.start === 1.25 && f.end === 5, 'blind fog long: ' + JSON.stringify(f));
  f = EV.blindnessFog(10, 128, false); ok(f.end === fr(128 + 0.5 * (5 - 128)) && f.start === fr(f.end * 0.25), 'blind fog ramp');
  f = EV.blindnessFog(20, 128, true); ok(f.start === 0 && Math.abs(f.end - 4) < 1e-6, 'blind sky fog');
  ok(EV.blindnessColorFactor(20) === 1 || EV.blindnessColorFactor(20) === 0, 'colour at 20');
  ok(EV.blindnessColorFactor(10) === 0.25 && EV.blindnessColorFactor(0) === 1 && EV.blindnessColorFactor(25) === 0, 'colour ramp');
  const fe = EV.frameFor({ effects: { blindness: { duration: 100 }, night_vision: { duration: 300 } } }, 128, 0);
  ok(fe.nightVision === 1 && !!fe.blind && fe.blind.fog.end === 5 && fe.blind.color === 0, 'frameFor both effects');
  const f0 = EV.frameFor({ effects: {} }, 128, 0); ok(f0.nightVision === 0 && f0.blind === null, 'frameFor none');
  ok(EV.frameFor({ effects: { blindness: { duration: 0 } } }, 128, 0).blind === null, 'frameFor expired');
  let st = { next: 0, last: 0 };
  for (let i = 0; i < 151; i++) EV.tickNausea(st, false, 200);
  ok(st.next === 1, 'nausea reaches 1 in 151 ticks');
  const s2 = { next: 0, last: 0 }; for (let i = 0; i < 148; i++) EV.tickNausea(s2, false, 200); ok(s2.next < 1, 'not before 149');
  for (let i = 0; i < 20; i++) EV.tickNausea(st, false, 30);
  ok(st.next === 0, 'nausea drains 0.05/tick'); 
  const sp = { next: 0, last: 0 }; for (let i = 0; i < 81; i++) EV.tickNausea(sp, true, 0); ok(sp.next === 1, 'portal 81 ticks');
  ok(EV.nauseaWobble({ next: 0, last: 0 }, 0.5, 5, 1, true) === null, 'no wobble at 0');
  const w = EV.nauseaWobble({ next: 1, last: 1 }, 0.5, 10, 1, true);
  const g = (5 / 6 - 0.04) ** 2; ok(Math.abs(w.scaleX - 1 / g) < 1e-4 && Math.abs(w.degrees - 10.5 * 7) < 1e-4, 'wobble');
  ok(EV.nauseaWobble({ next: 1, last: 1 }, 0, 4, 1, false).degrees === 80, 'portal spin 20');
  ok(EV.nauseaWobble({ next: 1, last: 1 }, 0, 4, 0, true) === null, 'distortion scale 0');
}
const EV = loadEngine({ extra: ['14kd_effectview.js'], dom: true }).EffectView;
ok(!!EV, 'EffectView loaded'); run(EV);
// anti-vacuity: each break must flip a check
const mk = (patch) => { const o = Object.assign({}, EV, patch); return o; };
const breakers = {
  'nv threshold 100': { nightVisionStrength: (d, p) => EV.nightVisionStrength(d > 100 ? 201 : d, p) },
  'fog 6': { blindnessFog: (d, v, s) => { const r = EV.blindnessFog(d, v, s); return { start: r.start, end: r.end + 1 }; } },
  'colour linear': { blindnessColorFactor: (d) => d < 20 ? 1 - d / 20 : 0 },
  'nausea slow': { tickNausea: (st, a, b) => EV.tickNausea(st, a, b - 61 > 0 ? 0 : b) },
  'frameFor drops blindness': { frameFor: (e, v, p) => { const r = EV.frameFor(e, v, p); r.blind = null; return r; } },
  'wobble rate': { nauseaWobble: (a, b, c, d, e) => EV.nauseaWobble(a, b, c, d, !e) },
};
for (const [n, p] of Object.entries(breakers)) {
  const before = fails.length; run(mk(p));
  if (fails.length > before) { breaks++; console.log('   ✓ break caught: ' + n); fails.length = before; }
  else fails.push('anti-vacuity: ' + n + ' not caught');
}
console.log(`${pass} checks passed, 0 failures, ${breaks} breaks caught`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
