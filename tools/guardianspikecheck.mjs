// guardianspikecheck.mjs — #1075: guardian/elder_guardian carry all 12 spikes from GuardianEntityModel.java
// (cuboid(-1,-4.5,-1,2,9,2) uv(0,0); pivot SPIKE_PIVOTS_X*a, 16+SPIKE_PIVOTS_Y*a, Z*a with a=getAngle(i,0,0); rotation PI*SPIKE_PITCHES/YAWS/ROLLS).
import fs from 'node:fs';
const PATH = new URL('./golden/models-1.18.2.tsv', import.meta.url);
const good = fs.readFileSync(PATH, 'utf8');
const P = [1.75, 0.25, 0, 0, 0.5, 0.5, 0.5, 0.5, 1.25, 0.75, 0, 0], Y = [0, 0, 0, 0, 0.25, 1.75, 1.25, 0.75, 0, 0, 0, 0];
const R = [0, 0, 0.25, 1.75, 0, 0, 0, 0, 0, 0, 0.75, 1.25], X = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8];
const PY = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8], Z = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0];
const f = Math.fround;
function run(txt) {
  const rows = txt.split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
  let n = 0, bad = 0;
  for (const layer of ['guardian', 'elder_guardian']) for (let i = 0; i < 12; i++) {
    const r = rows.filter((x) => x[0] === layer && x[1] === 'spike' + i);
    n++;
    if (r.length !== 1) { bad++; continue; }
    const v = r[0].slice(2).map(Number), a = f(f(1 + f(f(Math.cos(i)) * 0.01)) - 0), e = [0, 0, -1, -4.5, -1, 2, 9, 2, f(X[i] * a), f(16 + f(PY[i] * a)), f(Z[i] * a)];
    const rot = [P[i], Y[i], R[i]].map((a) => a * Math.PI);
    if (e.some((q, k) => Math.abs(v[k] - q) > 1e-5) || rot.some((q, k) => Math.abs(v[11 + k] - q) > 1e-6) || v[15] !== 64 || v[16] !== 64) bad++;
  }
  return { n, bad };
}
let ok = run(good);
let caught = 0;
const brk = (f) => { const r = run(f(good)); if (r.bad > 0) caught++; else console.log('NOT CAUGHT'); };
brk((t) => t.replace(/^guardian\tspike3\t.*\n/m, ''));
brk((t) => t.replace(/^(elder_guardian\tspike5\t0\t0\t-1\t-4\.5\t-1\t2\t9\t2\t)8/m, '$19'));
brk((t) => t.replace(/^(guardian\tspike8\t(?:[^\t]*\t){11})[^\t]*/m, '$10'));
console.log((ok.n - ok.bad) + ' assertions, ' + ok.bad + ' failures, ' + caught + ' breaks caught');
process.exit(ok.bad ? 1 : 0);
