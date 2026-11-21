#!/usr/bin/env node
// lightmapcheck.mjs — #8334: LightmapTextureManager.update incl. the gamma mix, vs an independent Math.fround transcription.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['14kc_lightmap.js'] });
const LM = MCL.Lightmap, f = Math.fround;
const lerp = (t, a, b) => f(a + f(t * f(b - a)));
const eq = v => { const i = f(1 - v); return f(1 - f(f(i * i) * f(i * i))); };
const br = (l, am) => { const x = f(l / 15); return lerp(am, f(x / f(4 - f(3 * x))), 1); };
function ref(o, noGamma) {
  const out = []; const sb = o.sb, s3 = f(sb * 0.95 + 0.05), fl = f(o.fl + 1.5);
  const t = [lerp(0.35, sb, 1), lerp(0.35, sb, 1), 1];
  for (let s = 0; s < 16; s++) for (let b = 0; b < 16; b++) {
    const sk = f(br(s, o.am) * s3), bl = f(br(b, o.am) * fl);
    let c = [bl, f(bl * f(f(f(bl * 0.6) + 0.4) * 0.6 + 0.4)), f(bl * f(f(f(bl * bl) * 0.6) + 0.4))];
    if (o.nether) c = [lerp(0.25, c[0], 0.99), lerp(0.25, c[1], 1.12), lerp(0.25, c[2], 1)];
    else c = c.map((v, k) => lerp(0.04, f(v + f(t[k] * sk)), 0.75));
    c = c.map(v => Math.min(1, Math.max(0, v)));
    if (o.nv > 0) { const m = Math.max(...c); if (m < 1) c = c.map(v => lerp(o.nv, v, f(v * f(1 / m)))); }
    if (!noGamma) c = c.map(v => lerp(o.g, v, eq(v)));
    c = c.map(v => Math.min(1, Math.max(0, lerp(0.04, v, 0.75))));
    out.push(...c.map(v => Math.trunc(f(v * 255))));
  }
  return out;
}
let pass = 0, fails = [];
const cases = [];
for (const g of [0, 0.5, 1]) for (const [n, sb, nether, nv, am] of [['day', 0, 0, 0, 0], ['night', 1, 0, 0, 0], ['nether', 0, 1, 0, 0.1], ['nv', 1, 0, 1, 0]])
  cases.push([g + n, { g, sb: f(sb), nether, nv, am: f(am), fl: 0 }]);
const run = (noGamma) => {
  let bad = 0;
  for (const [n, o] of cases) {
    const got = LM.compute({ gamma: o.g, starBrightness: o.sb, brighten: !!o.nether, nightVision: o.nv, ambient: o.am, flicker: 0 });
    const r = ref(o, noGamma);
    if (got.length !== 768 || got.some((v, i) => v !== r[i])) { bad++; if (!noGamma) fails.push(n); } else if (!noGamma) pass++;
  }
  return bad;
};
run(false);
const a = LM.compute({ gamma: 0, starBrightness: 0 }), b = LM.compute({ gamma: 1, starBrightness: 0 });
if (!b.some((v, i) => v !== a[i])) fails.push('gamma has no effect');
if (!/Moody/.test(LM.label(0)) || !/Bright/.test(LM.label(1)) || !/50%/.test(LM.label(0.5))) fails.push('labels');
const breaks = run(true) >= 6 ? 1 : 0;   // dropping the gamma mix must be caught
if (!breaks) fails.push('dropping gamma not caught');
console.log(fails.length ? 'FAIL ' + fails.join(', ') : `lightmapcheck: ${pass} cases ok, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
