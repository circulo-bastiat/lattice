// tools/noisefloorcheck.mjs - #11293: a browser stage that reads pixels/screenshots needs a recorded noise floor
// (tools/noisefloors.json: floors = measured, owed = not yet measured) so a hard threshold is never set from one clean run.
import { readFileSync, readdirSync } from 'node:fs';
const PIX = /captureScreenshot|readPixels|getImageData|screenshot/i;
const stages = () => {
  const out = [];
  for (const f of readdirSync('tools/stages.d')) for (const s of JSON.parse(readFileSync('tools/stages.d/' + f, 'utf8'))) {
    if (s.kind !== 'browser') continue;
    let src = ''; try { src = readFileSync(s.file || 'tools/' + s.id + '.mjs', 'utf8'); } catch (e) { continue; }
    if (PIX.test(src)) out.push(s.id);
  }
  return out;
};
const verdict = (ids, reg) => {
  const bad = [];
  for (const id of ids) {
    const fl = reg.floors[id];
    if (reg.exact && id in reg.exact) { if (!String(reg.exact[id]).trim()) bad.push(id + ': exact without a reason'); if (fl || reg.owed.includes(id)) bad.push(id + ': exact and also floor/owed'); continue; }
    if (fl) {
      if (!(fl.n >= 2)) bad.push(id + ': floor measured over fewer than 2 runs');
      if (typeof fl.min === 'number' && typeof fl.max === 'number' && fl.min > fl.max) bad.push(id + ': min > max');
      if (!fl.source || !fl.margin) bad.push(id + ': floor lacks source/margin');
    } else if (!reg.owed.includes(id)) bad.push(id + ': pixel stage with no recorded noise floor (add it to floors, or to owed)');
  }
  for (const id of Object.keys(reg.floors)) if (reg.owed.includes(id)) bad.push(id + ': both measured and owed');
  return bad;
};
const reg = JSON.parse(readFileSync('tools/noisefloors.json', 'utf8'));
const ids = stages();
const real = verdict(ids, reg);
const BREAKS = [
  ['exact without reason', ids, { ...reg, exact: { ...reg.exact, guitexcheck: '' } }],
  ['exact and owed', ids, { ...reg, owed: reg.owed.concat(['guitexcheck']) }],
  ['unlisted stage', ids.concat(['newdrawcheck']), reg],
  ['floor dropped', ids, { floors: {}, owed: reg.owed.filter((x) => x !== reg.owed[0]) }],
  ['one-run floor', ids, { floors: { ...reg.floors, mobdrawcheck: { ...reg.floors.mobdrawcheck, n: 1 } }, owed: reg.owed }],
  ['min>max', ids, { floors: { ...reg.floors, glintdrawcheck: { ...reg.floors.glintdrawcheck, min: 9e9 } }, owed: reg.owed }],
];
let caught = 0;
for (const [n, i, r] of BREAKS) if (verdict(i, r).length) caught++; else real.push('break not caught: ' + n);
console.log(real.length ? "FAIL\n" + real.join("\n") : `noisefloorcheck: ok, ${caught} breaks caught (${ids.length} pixel stages, ${reg.owed.length} owed)`);
process.exit(real.length ? 1 : 0);
