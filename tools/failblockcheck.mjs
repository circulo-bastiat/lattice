#!/usr/bin/env node
// failblockcheck.mjs - the `master is red` comment quotes a red stage's whole FAILED block, including a check's own `====` summary and its FAIL lines
// (25 Oct: full.mjs cut the block at the first `====` line, so soundcheck & co. were red with no reason shown). ANTI-VACUITY: the old cut is rebuilt and must lose the FAIL line.
import { failBlock } from './infra/failblock.mjs';
let n = 0, breaks = 0; const bad = [];
const ok = (c, m) => { n++; if (!c) bad.push(m); };
const out = ['x', '──── soundcheck FAILED ────', 'soundcheck - tables', '   ✓ a', '================ soundcheck ================', ' failures ........... 1', '===========================================', 'FAIL  no listener: silent',
  '', '──── other FAILED ────', 'boom', '', '==================== suite ====================', ' table'].join('\n');
const b = failBlock(out, 'soundcheck');
ok(/FAIL {2}no listener: silent/.test(b), 'the check\'s own summary and FAIL line are in the block');
ok(!/boom|other FAILED/.test(b), 'the next stage\'s block is not');
ok(!/ table/.test(failBlock(out, 'other')) && /boom/.test(failBlock(out, 'other')), 'the last block stops at the suite table');
ok(/no FAILED block/.test(failBlock(out, 'nope')), 'an absent id says so');
const long = '──── big FAILED ────\n' + Array.from({ length: 80 }, (_, i) => 'l' + i).join('\n');
ok(failBlock(long, 'big').split('\n').length <= 47, 'a huge block is capped');
// break: the pre-25-Oct cut (first ==== line ends the block) must lose the FAIL line, or this check proves nothing
const old = (o, id) => { const L = o.split('\n'), i = L.findIndex((l) => l.includes(`──── ${id} FAILED ────`)); let j = i + 1; while (j < L.length && j <= i + 25 && !/^(────|====)/.test(L[j])) j++; return L.slice(i, j).join('\n'); };
breaks++; ok(!/FAIL {2}no listener/.test(old(out, 'soundcheck')), 'the old cut lost the FAIL line (this is the bug)'); console.log('   ✓ break caught: the old first-==== cut loses the FAIL line');
console.log(`failblockcheck: ${n} assertions, ${bad.length} failures, ${breaks} breaks caught`);
for (const m of bad) console.log('FAIL  ' + m);
process.exit(bad.length ? 1 : 0);
