// tools/noisemeasure.mjs - #11293: measure a pixel stage's noise. Usage: node tools/noisemeasure.mjs <stageId> [N=3]
// Runs tools/<id>.mjs N times, collects every number on output lines that report a pixel/diff/noise/spread
// measurement, and prints min/max per line shape (digits -> #) - the n/min/max that tools/noisefloors.json needs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
// the stage's own file and args come from tools/stages.d/<id>.json (a bare run without them measured nothing)
export const stageCmd = (id) => { const d = 'tools/stages.d/' + id + '.json'; const st = fs.existsSync(d) ? [].concat(JSON.parse(fs.readFileSync(d, 'utf8'))).find((x) => x.id === id) : null; return ['node', [st && st.file ? st.file : 'tools/' + id + '.mjs', ...((st && st.args) || [])]]; };
const MEAS = /\b(px|pixels?|differ|diff|noise|spread|floor|drift)\b/i;
export const aggregate = (outputs) => {
  const m = new Map();
  for (const out of outputs) {
    const seen = new Map();
    for (const line of out.split('\n')) {
      if (!MEAS.test(line)) continue;
      const nums = (line.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      if (!nums.length) continue;
      const shape = line.trim().replace(/-?\d+(?:\.\d+)?/g, '#');
      const k = (seen.get(shape) || 0); seen.set(shape, k + 1);
      const key = shape + ' @' + k;
      const e = m.get(key) || { shape, n: 0, min: nums.map(() => Infinity), max: nums.map(() => -Infinity) };
      e.n++; nums.forEach((v, i) => { if (v < e.min[i]) e.min[i] = v; if (v > e.max[i]) e.max[i] = v; });
      m.set(key, e);
    }
  }
  return [...m.values()];
};
const selftest = () => {
  const a = aggregate(['x\n 12 px differ against a floor of 5\n', ' 20 px differ against a floor of 5\n', 'unrelated 9\n']);
  let caught = 0, bad = [];
  if (a.length === 1 && a[0].n === 2 && a[0].min[0] === 12 && a[0].max[0] === 20) {} else bad.push('aggregate wrong');
  if (aggregate(['nothing here']).length === 0) caught++; else bad.push('noise-free output not empty');
  if (aggregate(['5 px', '5 px'])[0].n === 2) caught++; else bad.push('n wrong');
  if (aggregate([]).length === 0) caught++;
  if (stageCmd('lumacheck')[1].join(' ') === 'tools/lumacheck.mjs') bad.push('stageCmd ignores stage args'); else caught++;
  if (stageCmd('nonexistent_zz')[1][0] === 'tools/nonexistent_zz.mjs') caught++; else bad.push('fallback wrong');
  console.log(bad.length ? 'FAIL ' + bad : `noisemeasure selftest ok, ${caught} breaks caught`);
  process.exit(bad.length ? 1 : 0);
};
if (process.argv[2] === '--selftest') selftest();
else if (process.argv[2]) {
  const id = process.argv[2], N = +process.argv[3] || 3, outs = [];
  for (let i = 0; i < N; i++) { const r = (([c, a]) => spawnSync(c, a, { encoding: 'utf8', env: process.env }))(stageCmd(id)); outs.push(r.stdout + r.stderr); }
  for (const e of aggregate(outs)) console.log(`n=${e.n} min=[${e.min}] max=[${e.max}]  ${e.shape}`);
}
