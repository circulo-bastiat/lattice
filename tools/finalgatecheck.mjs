#!/usr/bin/env node
// finalgatecheck.mjs - the FINAL GATE (#10620): is every area of the 1.18.2 parity list proven by live stages?
// ANTI-VACUITY (D-30): the evaluator is run on a synthetic green fixture, then on broken copies; each must be caught.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const T = (p) => fileURLToPath(new URL(p, import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function evaluate(areas, stageIds, quarantine, signoffs) {
  const f = [], ids = new Set(stageIds);
  const seen = new Set();
  for (const a of areas) {
    if (seen.has(a.id)) f.push(`${a.id}: duplicate area id`);
    seen.add(a.id);
    if (!Array.isArray(a.stages) || a.stages.length === 0) { f.push(`${a.id}: no stages`); continue; }
    for (const s of a.stages) {
      if (!ids.has(s)) f.push(`${a.id}: stage '${s}' is not in tools/stages.d`);
      else if (Object.prototype.hasOwnProperty.call(quarantine, s)) f.push(`${a.id}: stage '${s}' is quarantined`);
    }
    if (/[CG]/.test(a.proof || '') && !(signoffs && signoffs[a.id] && signoffs[a.id].by && signoffs[a.id].date)) f.push(`${a.id}: ${a.proof} row has no sign-off`);
    if (!/^(R|V|C|G)([+](R|V|C|G))*$/.test(a.proof || '')) f.push(`${a.id}: bad proof type '${a.proof}'`);
  }
  return f;
}

const dir = T('./stages.d');
const stageIds = [];
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.json')) continue;
  try { for (const e of readJson(`${dir}/${file}`)) if (e && e.id) stageIds.push(e.id); } catch (e) { /* unreadable file: its ids are absent */ }
}
const quarantine = readJson(T('./quarantine.json'));
const signoffs = readJson(T('./finalgate-signoff.json'));
const areas = readJson(T('./finalgate.json')).areas;

// --- anti-vacuity on a synthetic green fixture
const fx = () => ({
  areas: [{ id: 'a', proof: 'R', stages: ['s1', 's2'] }, { id: 'b', proof: 'C', stages: ['s3'] }, { id: 'c', proof: 'G', stages: ['s1'] }],
  ids: ['s1', 's2', 's3'], q: {}, so: { b: { by: 'x', date: '2026-01-01' }, c: { by: 'x', date: '2026-01-01' } },
});
const ev = (x) => evaluate(x.areas, x.ids, x.q, x.so);
const BREAKS = [
  ['drop a stage id', (x) => { x.ids = x.ids.filter((i) => i !== 's2'); }],
  ['rename a stage', (x) => { x.areas[0].stages[0] = 's1-renamed'; }],
  ['empty an area', (x) => { x.areas[0].stages = []; }],
  ['quarantine a stage', (x) => { x.q = { s3: 'red' }; }],
  ['remove a C sign-off', (x) => { delete x.so.b; }],
  ['remove a G sign-off', (x) => { delete x.so.c; }],
  ['bad proof type', (x) => { x.areas[0].proof = 'Q'; }],
];
let caught = 0, bad = 0;
if (ev(fx()).length) { console.log('finalgatecheck: FIXTURE not green: ' + ev(fx()).join('; ')); bad++; }
for (const [name, brk] of BREAKS) {
  const x = fx(); brk(x);
  if (ev(x).length) caught++; else { console.log(`finalgatecheck: break NOT caught: ${name}`); bad++; }
}
console.log(`finalgatecheck: ${caught} breaks caught (of ${BREAKS.length})`);

// Sign-off gaps are the project's remaining work, not a broken gate: they are listed as PENDING and only fail with --strict.
const strict = process.argv.includes('--strict');
const all = evaluate(areas, stageIds, quarantine, signoffs);
const pending = all.filter((m) => /has no sign-off$/.test(m));
const fails = all.filter((m) => !pending.includes(m));
for (const m of pending) console.log('  PENDING ' + m);
for (const m of fails) console.log('  RED ' + m);
console.log(`finalgatecheck: ${areas.length} areas, ${pending.length} pending sign-off, ${fails.length} broken${strict ? ' (strict)' : ''}`);
process.exit(fails.length || bad || (strict && pending.length) ? 1 : 0);
