// tools/briefguardcheck.mjs - #10712: a stub-body issue (#7348: "Part of #7335.") is never handed to a worker; the unblock -> no-code -> block loop mails the commander once.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const files = { guard: rd('./infra/briefguard.mjs'), filter: rd('./infra/claimfilter.mjs'), lane: rd('./infra/phaselane.mjs'), go: rd('./go.mjs'), brain: rd('./brain/brain.mjs') };
const I = (number, body, labels = []) => ({ number, body, labels: labels.map((name) => ({ name })) });
const REAL = 'Translate the .decomp classes net.minecraft.world.entity.animal.Fox and FoxGoals into src/41_fox.js, wire the spawn table in src/40_spawn.js, and prove same outputs as vanilla with tools/foxcheck.mjs against the referee golden files. '.repeat(2);
async function verdict(f) {
  const d = mkdtempSync(join(tmpdir(), 'bgc-'));
  writeFileSync(join(d, 'heldnow.mjs'), 'export const isHeld = () => false;');
  writeFileSync(join(d, 'briefguard.mjs'), f.guard); writeFileSync(join(d, 'claimfilter.mjs'), f.filter); writeFileSync(join(d, 'phaselane.mjs'), f.lane);
  const q = '?' + Math.random(), M = await import(pathToFileURL(join(d, 'claimfilter.mjs')).href + q), G = await import(pathToFileURL(join(d, 'briefguard.mjs')).href + q);
  const bad = [], ids = M.claimFilter([I(1, 'Part of #7335.'), I(2, REAL + '\n\nPart of #7335.'), I(3, ''), I(4, 'Part of #1.', ['needs-rebase']), I(5, REAL, ['needs-brief']), I(6, 'Part of #7335.\n'.repeat(20))], { briefMin: 200 }).map((i) => i.number);
  if (ids.includes(1) || ids.includes(3) || ids.includes(6)) bad.push('a stub-body issue was handed to a worker');
  if (!ids.includes(2)) bad.push('a real brief must stay claimable');
  if (!ids.includes(4)) bad.push('a bounced PR is exempt');
  if (ids.includes(5)) bad.push('needs-brief must hide the issue');
  const U = (n) => Array.from({ length: n }, () => ({ body: '**Unblocked by the brain** (#9168): x' }));
  if (G.unblockVerdict(I(7, REAL), U(2)).why !== null) bad.push('2 cycles on a real brief may still unblock');
  const v3 = G.unblockVerdict(I(7, REAL), U(3));
  if (v3.ok || v3.why !== 'loop' || !v3.mail) bad.push('3 unblock cycles must raise a commander mail');
  if (G.unblockVerdict(I(7, REAL), U(3), { 7: 1 }).mail) bad.push('the loop mail must go once');
  if (G.unblockVerdict(I(7, 'Part of #7335.'), []).why !== 'stub') bad.push('stub body must not be unblocked');
  if (!/stubBody\(issue\.body\)[\s\S]{0,300}needs-brief/.test(f.go) || !/briefMin: BRIEF_MIN/.test(f.go) || !/stubBody\(opt\('--body'\)\)/.test(f.go)) bad.push('go.mjs not wired');
  if (!/unblockVerdict\(iss/.test(f.brain)) bad.push('brain unblock not wired');
  return bad;
}
const real = await verdict(files);
let caught = 0;
const BREAKS = [
  ['filter', (s) => s.replace('stubBody(i.body, briefMin)', 'false'), 'stub rule dropped'],
  ['filter', (s) => s.replace("!lab(i, 'needs-brief') && ", ''), 'needs-brief ignored'],
  ['filter', (s) => s.replace("!lab(i, 'needs-rebase') && !(lane", '!(lane'), 'bounced PR not exempt'],
  ['guard', (s) => s.replace('>= 3 ? ', '>= 30 ? '), 'loop never trips'],
  ['guard', (s) => s.replace('!(mailed || {})[issue && issue.number]', 'true'), 'mail repeats'],
  ['guard', (s) => s.replace('.filter((l) => !/^\\s*(Part of|Depends on)\\b/i.test(l))', ''), 'Part of lines counted'],
  ['go', (s) => s.replace('briefMin: BRIEF_MIN', ''), 'go.mjs not passing briefMin'],
  ['brain', (s) => s.replace('unblockVerdict(iss', 'unblockVerdictX(iss'), 'brain unwired'],
];
for (const [k, fn, name] of BREAKS) { const b = await verdict({ ...files, [k]: fn(files[k]) }).catch(() => ['threw']); if (b.length) { caught++; console.log(' ✓ break caught: ' + name); } else console.log('NOT CAUGHT: ' + name); }
if (real.length) { console.log('FAIL\n' + real.join('\n')); process.exit(1); }
if (caught < BREAKS.length) { console.log(`FAIL only ${caught}/${BREAKS.length} breaks caught (of ${BREAKS.length})`); process.exit(1); }
console.log(`briefguardcheck: 13 assertions, 0 failures, ${caught} breaks caught (of ${BREAKS.length})`);
