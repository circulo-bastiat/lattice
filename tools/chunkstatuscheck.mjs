// tools/chunkstatuscheck.mjs - #9258: the STEPS table must equal the register(...) calls in .decomp ChunkStatus.java (order, name, radius),
// and each named engine file must exist. Anti-vacuity below.
import { readFileSync, existsSync } from 'node:fs';
import { STEPS } from './chunkstatus-steps.mjs';
const J = readFileSync(new URL('../.decomp/net/minecraft/world/chunk/ChunkStatus.java', import.meta.url), 'utf8');
const extract = () => {
  const out = [], re = /register\(\s*"(\w+)",\s*(?:null|\w+),\s*(-?\d+),/g; let m;
  while ((m = re.exec(J))) out.push({ name: m[1], radius: +m[2] });
  return out;
};
const verdict = (steps, ref) => {
  const bad = [];
  if (ref.length !== 13) bad.push('decomp yielded ' + ref.length + ' steps, expected 13');
  if (steps.length !== ref.length) bad.push('step count ' + steps.length + ' != ' + ref.length);
  ref.forEach((r, i) => {
    const s = steps[i]; if (!s) return;
    if (s.name !== r.name) bad.push(`#${i} name ${s.name} != ${r.name}`);
    else if (s.radius !== r.radius) bad.push(`${r.name} radius ${s.radius} != ${r.radius}`);
  });
  for (const s of steps) if (s.engine !== 'none' && !existsSync(new URL('../' + s.engine, import.meta.url))) bad.push(s.name + ': missing ' + s.engine);
  for (const s of steps) if (s.engine === 'none' && !s.note) bad.push(s.name + ': none without a note');
  return bad;
};
const ref = extract(), real = verdict(STEPS, ref);
const clone = () => STEPS.map((s) => ({ ...s }));
const BREAKS = [
  ['radius wrong', () => { const a = clone(); a[3].radius = 0; return [a, ref]; }],
  ['order swapped', () => { const a = clone(); [a[5], a[6]] = [a[6], a[5]]; return [a, ref]; }],
  ['step dropped', () => { const a = clone(); a.splice(7, 1); return [a, ref]; }],
  ['engine file missing', () => { const a = clone(); a[4].engine = 'src/nope.js'; return [a, ref]; }],
  ['decomp radius changed', () => { const r = ref.map((x) => ({ ...x })); r[9].radius = 2; return [clone(), r]; }],
];
let caught = 0;
for (const [n, mk] of BREAKS) { if (verdict(...mk()).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`chunkstatuscheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
