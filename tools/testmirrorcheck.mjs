#!/usr/bin/env node
// testmirrorcheck.mjs - #6767: the public test mirror must never carry Dan's emails, account names, user paths or machine name, and the
// lander must be wired to it. Drives scrubTree() with planted files, scrubs the REAL tracked tree (0 leaks), checks the wiring, then
// anti-vacuity: each broken scrub config must fail at least one case.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { scrubTree, EXCLUDE, REPLACE, FORBID, ROOT, stageAll } from './infra/mirror.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let asserts = 0, fails = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const B = (s) => Buffer.from(s, 'utf8');
// built from pieces so this file publishes unchanged (the scrub would otherwise rewrite its own planted data)
const ACC = 'hiner' + 'manDanny'.toLowerCase(), MAIN = 'boiler' + 'bobbing', USR = 'hi' + 'ner', PC = 'DESKTOP-' + '6OUIDG0', GM = '@' + 'gmail.com';
const planted = [
  { path: 'src/a.js', buf: B(`// mail ${MAIN}${GM} or ${ACC}${GM}\nconst u = "https://github.com/${ACC}-dev/store.git";`) },
  { path: 'tools/b.mjs', buf: B(`const p = "C:\\\\Users\\\\${USR}\\\\Downloads"; // runner ${PC}, /home/${USR}/x`) },
  { path: '.claude/settings.local.json', buf: B('{"x":1}') },
  { path: '.claude/settings.json', buf: B('{"permissions":{}}') },
  { path: '.github/workflows/land.yml', buf: B('name: land') },
  { path: 'img.png', buf: Buffer.from([0x89, 0x50, 0, 0x47, 1]) },
  { path: 'src/clean.js', buf: B('var machinery = 1; // a plain file stays byte-identical') },
];
function cases(cfg) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch {} if (!r) bad.push(n); };
  const { out, leaks } = scrubTree(planted, cfg), txt = out.filter((o) => !o.buf.includes(0)).map((o) => o.buf.toString('utf8')).join('\n');
  t('no leak left', () => leaks.length === 0);
  t('no email, account or user path in the output', () => !new RegExp(`${GM.replace('.', '\\.')}|${ACC}|${MAIN}|Users\\\\+${USR}|/home/${USR}|${PC}`, 'i').test(txt));
  t('.claude/ is not published, except the generic settings.json that checks read (#7184)', () => !out.some((o) => o.path.startsWith('.claude/') && o.path !== '.claude/settings.json') && out.some((o) => o.path === '.claude/settings.json'));
  t('no private workflow lands where it would RUN on the mirror', () => !out.some((o) => o.path.startsWith('.github/')) && out.some((o) => o.path === '.ci-wf/workflows/land.yml'));
  t('a binary file is copied untouched', () => out.find((o) => o.path === 'img.png')?.buf.equals(planted.find((x) => x.path === 'img.png').buf));
  t('a clean file is byte-identical', () => out.find((o) => o.path === 'src/clean.js')?.buf.toString() === planted.find((x) => x.path === 'src/clean.js').buf.toString());
  // the safety net: a gap in REPLACE must be caught by FORBID, never published silently
  t('FORBID catches what REPLACE missed', () => scrubTree([{ path: 'x.js', buf: B(MAIN) }], { ...cfg, replace: [] }).leaks.length === 1);
  return bad;
}
const real = cases({ exclude: EXCLUDE, replace: REPLACE, forbid: FORBID });
ok(real.length === 0, `the real scrub fails: ${real.join(' | ')}`);
// the real tracked tree publishes clean
const paths = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(Boolean);
const files = []; for (const p of paths) { try { files.push({ path: p, buf: readFileSync(new URL(`../${p}`, import.meta.url)) }); } catch { /* deleted */ } }
const tree = scrubTree(files);
ok(tree.leaks.length === 0, `the tracked tree leaks after the scrub: ${tree.leaks.slice(0, 5).join(', ')}`);
ok(tree.out.length > 1000, `the scrub dropped most of the tree (${tree.out.length} of ${files.length} files): the mirror would test something else`);
// the scrubber and this check publish byte-identical (a scrubbed copy would test nothing on the mirror)
for (const f of ['tools/infra/mirror.mjs', 'tools/testmirrorcheck.mjs']) { const a = files.find((x) => x.path === f), b = tree.out.find((x) => x.path === f);
  ok(!a || (b && a.buf.equals(b.buf)), `${f} is changed by the scrub: build the names from pieces`); }
// wiring
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const land = src('./infra/land.mjs'), yml = src('../.github/workflows/land.yml'), ci = src('./infra/mirror/ci.yml');
ok(/suite\(\['--core'\]\)/.test(land) && /MCLITE_TEST_REMOTE === 'mirror'/.test(land) && !/sh\('node', \['tools\/suite\.mjs', '--core'\]/.test(land), 'land.mjs runs the core suite through suite() (mirror-able)');
ok(/MIRROR_TOKEN: \$\{\{ secrets\.MIRROR_TOKEN \}\}/.test(yml) && /MCLITE_TEST_REMOTE: \$\{\{ vars\.TEST_REMOTE \}\}/.test(yml), 'land.yml passes TEST_REMOTE + MIRROR_REPO/TOKEN to the lander');
ok(!FORBID.test(ci) && /branches: \['t\/\*\*'\]/.test(ci) && /secrets\.STORE_URL/.test(ci) && /cp -r \.ci-wf\/\. \.github\//.test(ci), 'the mirror workflow names nobody, runs only on t/** and reads its data source from a secret');
ok(/TEST_REMOTE/.test(src('./infra/mirror.mjs')) && /visibility private/.test(src('../MIRROR-PRIVATE.cmd')), 'MIRROR-PRIVATE.cmd makes it private AND turns TEST_REMOTE off');
// #8362: a tracked file the repo's .gitignore ignores (tools/mobproof/matrix.json) must reach the mirror commit
const staged = (stage) => {
  const d = mkdtempSync(join(tmpdir(), 'mirrorstage-')), g = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8' });
  try { g('init', '-q'); writeFileSync(join(d, '.gitignore'), 'tools/mobproof/\n'); mkdirSync(join(d, 'tools', 'mobproof'), { recursive: true });
    writeFileSync(join(d, 'tools', 'mobproof', 'matrix.json'), '{}'); writeFileSync(join(d, 'a.js'), '1'); stage((...a) => g(...a)); return g('ls-files').split('\n'); }
  finally { rmSync(d, { recursive: true, force: true }); }
};
ok(staged(stageAll).includes('tools/mobproof/matrix.json'), 'stageAll drops a tracked file the .gitignore ignores (tools/mobproof/matrix.json)');
const tracked = execFileSync('git', ['ls-files', '-ci', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
ok(tracked.includes('tools/mobproof/matrix.json'), 'the real tree still has the tracked-but-ignored matrix.json this test models');
ok(!/g\('add', '-A'\)/.test(src('./infra/mirror.mjs')), 'mirror.mjs stages with a plain add -A again: use stageAll');
// anti-vacuity
let breaks = 0;
{ const lost = !staged((g) => g('add', '-A')).includes('tools/mobproof/matrix.json'); ok(lost, 'a plain `add -A` does NOT lose the ignored file: the test above proves nothing');
  if (lost) { breaks++; console.log('  ✓ a plain `git add -A` loses tools/mobproof/matrix.json (the phonevisualcheck ENOENT), so the stageAll case can fail'); } }
for (const [name, cfg] of [['no replacements', { exclude: EXCLUDE, replace: [], forbid: FORBID }], ['no exclusions', { exclude: [], replace: REPLACE, forbid: FORBID }],
  ['no safety net', { exclude: EXCLUDE, replace: REPLACE.slice(1), forbid: /$^/ }], ['emails only', { exclude: EXCLUDE, replace: REPLACE.slice(0, 1), forbid: FORBID }]]) {
  const b = cases(cfg); ok(b.length > 0, `the cases cannot tell "${name}" from the real scrub`);
  if (b.length) { breaks++; console.log(`  ✓ "${name}" fails ${b.length} case(s): ${b.slice(0, 2).join(' | ')}`); }
}
console.log(`testmirrorcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
