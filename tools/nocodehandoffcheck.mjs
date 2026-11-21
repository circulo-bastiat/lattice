#!/usr/bin/env node
// nocodehandoffcheck.mjs - #9173: `go.mjs done` on a branch with no commits used to die for every case but --already-fixed, so a worker that
// investigated and changed nothing lost its findings (classed gave-up, 2x = blocked + needs-commander, re-discovered next run). Now findings (>=80 chars,
// no --finished) are recorded as a hand-off. Reads go.mjs; anti-vacuity: each broken copy must be caught.
import { readFileSync } from 'node:fs';
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const go = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
function verdicts(src) {
  const bad = [], i = src.indexOf("if (git(['rev-list', '--count', `origin/master..HEAD`], dir) === '0') {"), j = src.indexOf("if (flag('--finished')) {", i);
  if (i < 0 || j < 0) return ['the no-commits block moved: update this check'];
  const blk = src.slice(i, j);
  if (!/if \(flag\('--finished'\) \|\| msg\.length < 80\) die\(/.test(blk)) bad.push('a no-commit hand-off is not limited to findings (>=80 chars) without --finished');
  if (!/--finished/.test((blk.match(/die\(`nothing to hand in[^\n]*/) || [''])[0]) && !/flag\('--finished'\) \|\|/.test(blk)) bad.push('--finished with no commits no longer dies');
  if (!/done --already-fixed --msg/.test(blk)) bad.push('the already-fixed way out was removed');
  if (!/recording your findings as a hand-off/.test(blk)) bad.push('the findings path does not say it records them');
  if (/^\s*die\('nothing to hand in/m.test(blk)) bad.push('the unconditional die is back: findings are lost again');
  return bad;
}
ok(verdicts(go).length === 0, `go.mjs: ${verdicts(go).join(' | ')}`);
for (const [n, f] of [
  ['unconditional die back', (s) => s.replace("if (flag('--finished') || msg.length < 80) die(`nothing to hand in", "die(`nothing to hand in")],
  ['no length gate', (s) => s.replace(" || msg.length < 80) die(", ") die(")],
  ['--finished no longer dies', (s) => s.replace("if (flag('--finished') || msg.length < 80)", "if (msg.length < 80)")],
  ['already-fixed hint dropped', (s) => s.replace('done --already-fixed --msg "<which commit/landing fixed it and what you ran>". If you', 'If you')],
]) { const m = f(go), b = m !== go && verdicts(m).length > 0; ok(b, `break "${n}" must be caught`); if (b) { breaks++; console.log(`  ✓ break "${n}" caught`); } }
console.log(`nocodehandoffcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
