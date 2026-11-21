// tools/eolcheck.mjs - #4972. (a) No tracked text file may be committed with CRLF/mixed line endings under eol=lf (two golden TSVs were,
// and the lander bounced every PR for ~90 min). (b) land.mjs must test its tree right after `reset --hard` and, if dirty, raise an
// issue and KEEP the PR's `land` label instead of bouncing it. Anti-vacuity: each break below must be caught.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { badEolLines, dirtyTracked } from './infra/landtree.mjs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const land = read('./infra/land.mjs'), tree = read('./infra/landtree.mjs');
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const verdicts = async (src, landSrc) => {
  const bad = [], m = await load(src);
  const L = (i, w, a, p) => `i/${i}${' '.repeat(6 - i.length)}w/${w}${' '.repeat(6 - w.length)}attr/${a}\t${p}`;
  if (m.badEolLines(L('crlf', 'lf', 'text eol=lf', 'tools/golden/x.tsv')).length !== 1) bad.push('a CRLF blob under eol=lf is not flagged');
  if (m.badEolLines(L('mixed', 'lf', 'text eol=lf', 'a.js')).length !== 1) bad.push('a mixed blob is not flagged');
  if (m.badEolLines(L('lf', 'lf', 'text eol=lf', 'a.js')).length) bad.push('a clean LF blob is flagged');
  if (m.badEolLines(L('-text', 'none', 'binary', 'a.png')).length) bad.push('a binary file is flagged');
  if (m.badEolLines(L('crlf', 'crlf', 'text eol=crlf', 'a.cmd')).length) bad.push('a .cmd that is meant to be CRLF is flagged');
  if (m.dirtyTracked(' M tools/golden/a.tsv\n?? jars/\nM  b.js\n').join() !== 'tools/golden/a.tsv,b.js') bad.push('dirtyTracked misreads porcelain');
  const reset = landSrc.indexOf("'reset', '-q', '--hard', 'origin/master'"), guard = landSrc.indexOf('dirtyTracked('), merge = landSrc.indexOf("'merge', '--no-ff'");
  if (!(reset > 0 && guard > reset && guard < merge)) bad.push('land.mjs does not test the tree between `reset --hard` and the merge');
  if (!/lander-dirty/.test(landSrc)) bad.push('a dirty lander tree raises no `lander-dirty` issue');
  return bad;
};
const BREAKS = [
  ['crlf not flagged', (t, l) => [t.replace('(crlf|mixed)', '(mixed)'), l]],
  ['mixed not flagged', (t, l) => [t.replace('(crlf|mixed)', '(crlf)'), l]],
  ['attr ignored (a .cmd with eol=crlf flagged)', (t, l) => [t.replace('\\battr\\/[^\\t]*\\beol=lf\\b', ''), l]],
  ['untracked counted dirty', (t, l) => [t.replace("!l.startsWith('??')", 'true'), l]],
  ['guard removed from land.mjs', (t, l) => [t, l.replace('dirtyTracked(', 'dirtyTrackedX(')]],
  ['guard after the merge', (t, l) => [t, l.replace('dirtyTracked(sh(', 'x(sh(') + '\ndirtyTracked('] ],
  ['no issue raised', (t, l) => [t, l.replaceAll('lander-dirty', 'lander-x')]],
];
// the real repo: nothing committed as CRLF/mixed under eol=lf
const real = badEolLines(execFileSync('git', ['ls-files', '--eol'], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const own = await verdicts(tree, land);
for (const f of real.slice(0, 20)) console.log(' CRLF/mixed blob under eol=lf:', f.split('\t')[1]);
let caught = 0;
for (const [name, mk] of BREAKS) { const [t, l] = mk(tree, land); if ((t !== tree || l !== land) && (await verdicts(t, l)).length) caught++; else console.log(' NOT CAUGHT:', name); }
for (const b of own) console.log(' FAIL:', b);
console.log(`eolcheck: ${caught} breaks caught (of ${BREAKS.length}); ${real.length} bad blobs`);
process.exit(real.length || own.length || caught < BREAKS.length ? 1 : 0);
