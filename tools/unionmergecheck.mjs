#!/usr/bin/env node
// unionmergecheck.mjs - #5752: the shared per-system check files (tools/mobnbtcheck.mjs, dispensercheck.mjs, hoppercheck.mjs) take one
// appended block per unit, so two PRs always edited the same last lines and the lander bounced them. .gitattributes marks them
// merge=union (both sides' lines kept).   node tools/unionmergecheck.mjs
// 1. .gitattributes (the REAL one) lists the three files   2. a real git merge of two different appended blocks is clean and
// keeps both   3. anti-vacuity: the same merge with the attribute removed, and with a file that is not listed, must conflict.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['AUTHOR', 'COMMITTER']) { process.env[`GIT_${k}_NAME`] = 't'; process.env[`GIT_${k}_EMAIL`] = 't@t'; }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['tools/mobnbtcheck.mjs', 'tools/dispensercheck.mjs', 'tools/hoppercheck.mjs'];
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const attrs = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
for (const f of FILES) ok(new RegExp('^' + f.replace(/\./g, '\\.') + '\\s+merge=union\\s*$', 'm').test(attrs), `.gitattributes marks ${f} merge=union`);

const git = (d, ...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
const TAIL = "console.log('\\n' + pass + ' assertions, ' + fails.length + ' failures');\nprocess.exit(fails.length ? 1 : 0);\n";
const file = (blocks) => "const pass = 1, fails = [];\n" + blocks.join('') + TAIL;
// two branches each add their own block right above the shared tail: the exact shape of two unit PRs
function mergeTwo(attributes, path) {
  const d = mkdtempSync(join(tmpdir(), 'unionmerge-'));
  git(d, 'init', '-q', '-b', 'master'); git(d, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(d, 'tools'), { recursive: true });
  const put = (blocks) => writeFileSync(join(d, path), file(blocks));
  writeFileSync(join(d, '.gitattributes'), attributes); put(['{ /* #1 */ }\n']); git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'base');
  git(d, 'checkout', '-q', '-b', 'pr'); put(['{ /* #1 */ }\n', '{ /* PR block */ }\n']); git(d, 'commit', '-qam', 'pr');
  git(d, 'checkout', '-q', 'master'); put(['{ /* #1 */ }\n', '{ /* MASTER block */ }\n']); git(d, 'commit', '-qam', 'master');
  const m = git(d, 'merge', '--no-ff', '-q', '-m', 'land', 'pr');
  const text = readFileSync(join(d, path), 'utf8');
  rmSync(d, { recursive: true, force: true });
  return { clean: m.status === 0, text };
}
for (const f of FILES) {
  const r = mergeTwo(attrs, f);
  ok(r.clean, `${f}: two different appended blocks merge clean`);
  ok(r.text.includes('PR block') && r.text.includes('MASTER block'), `${f}: the merged file keeps BOTH blocks`);
}
{ const r = mergeTwo('', FILES[0]); ok(!r.clean, 'without the attribute the same merge conflicts (else the cases prove nothing)'); if (!r.clean) breaks++; }
{ const r = mergeTwo(attrs, 'tools/somecheck.mjs'); ok(!r.clean, 'a file that is not listed still conflicts (union is not global)'); if (!r.clean) breaks++; }
{ const r = mergeTwo(attrs.replace(/merge=union/g, 'merge=ours'), FILES[0]); ok(!(r.clean && r.text.includes('PR block') && r.text.includes('MASTER block')), 'a driver that drops one side (merge=ours) fails the keep-both assertion'); if (!(r.clean && r.text.includes('PR block') && r.text.includes('MASTER block'))) breaks++; }

console.log('\n' + asserts + ' assertions, ' + fails + ' failures, ' + breaks + ' breaks caught');
process.exit(fails ? 1 : 0);
