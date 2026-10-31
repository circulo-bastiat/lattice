// tools/fullsuitecostcheck.mjs - #7727: the cost report finds what it should, and the stage list has no duplicate left.
import { analyse, loadStages, compareFamilies } from './fullsuitecost.mjs';
const bad = []; let breaks = 0;
const real = analyse(loadStages(), {}, { q1: 'x' }, {});
if (real.duplicates.length) bad.push('duplicate stages on master: ' + real.duplicates.map((g) => g.join('=')).join('; '));
const base = [{ id: 'a', kind: 'check', file: 'f.mjs', args: [] }, { id: 'b', kind: 'check', file: 'f.mjs', args: ['x'] }, { id: 'lockstep-x', kind: 'check', file: 'g.mjs' }, { id: 'lockstep_x', kind: 'check', file: 'h.mjs', why: 're-proves lockstep-x' }, { id: 'br', kind: 'browser', file: 'k.mjs' }];
const ok = analyse(base, { a: [10, 20], b: [5], br: [100] }, { a: 1 }, {});
if (ok.duplicates.length || ok.top[0][0] !== 'br' || ok.qSec !== 15 || ok.families.length !== 1 || ok.reprove.join() !== 'lockstep_x' || ok.browserNotUnfit.join() !== 'br') bad.push('report wrong on a known fixture');
const src = { 'g.mjs': "engineZombieTrace(s,{mob:'x'}) length: 20 const F = ['pos']; caught( caught(", 'h.mjs': "engineZombieTrace(SALTS[0],{mob:\"x\"}) length: 20 const F = ['pos']; at(" };
const cf = compareFamilies(base, ok.families, (f) => src[f]);
const cf2 = compareFamilies(base, ok.families, (f) => (f === 'h.mjs' ? src[f].replace('length: 20', 'length: 5') : src[f]));
const catches = [
  ['same lane found', cf[0].same.length === 2 && cf[0].rows[0].muts === 2],
  ['different salts split lanes', cf2[0].same.length === 0],
  ['duplicate', analyse([...base, { id: 'c', kind: 'check', file: 'f.mjs', args: [] }]).duplicates.length === 1],
  ['unfit browser excluded', analyse(base, {}, {}, { br: 1 }).browserNotUnfit.length === 0],
  ['family evidence flags a shared file', analyse([{ id: 'lockstep-y', kind: 'check', file: 'z.mjs', args: [] }, { id: 'lockstep_y', kind: 'check', file: 'z.mjs', args: ['1'] }]).familyEvidence[0].sameFile === true],
  ['family evidence quiet for distinct files', analyse(base).familyEvidence[0].sameFile === false],
  ['no timing, empty top', analyse(base).top.length === 0],
  ['top sorted', analyse(base, { a: [1], b: [9] }).top[0][0] === 'b'],
];
for (const [n, c] of catches) { if (c) { breaks++; console.log('  ✓ break caught: ' + n); } else bad.push('not caught: ' + n); }
if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log(`fullsuitecostcheck: ${breaks} breaks caught (of ${catches.length})`);
console.log(' assertions passed .... 8');
console.log(' failures ........... 0');
