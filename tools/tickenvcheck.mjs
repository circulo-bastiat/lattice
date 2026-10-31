// tools/tickenvcheck.mjs - 22 Oct 2026: tools/brain/tick.sh (the 2-minute clock that runs the fill) exported no MIRROR_TOKEN / MIRROR_REPO, so
// brain.mjs could never dispatch worker packs or read the mirror headroom and every worker ran in the VM on Dan's PC, although WORKER_RUNNER=mirror
// was set (Dan's 21 Oct decision). Every MIRROR_* variable brain.mjs reads from the environment must be exported by tick.sh, from the files the VM has.
// Anti-vacuity: each break below must be caught by the same verdict.
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const tick = read('./brain/tick.sh'), brain = read('./brain/brain.mjs');
const verdicts = (t, b) => {
  const bad = [];
  const used = [...new Set([...b.matchAll(/process\.env\.(MIRROR_[A-Z]+)/g)].map((m) => m[1]))];
  if (!used.includes('MIRROR_TOKEN') || !used.includes('MIRROR_REPO')) bad.push(`brain.mjs no longer reads MIRROR_TOKEN and MIRROR_REPO (reads: ${used.join(',') || 'none'}); update this check`);
  for (const v of used) if (!new RegExp(`export ${v}=`).test(t)) bad.push(`tick.sh never exports ${v}, which brain.mjs reads`);
  if (!/\.brain\/mirror-token/.test(t)) bad.push('tick.sh does not read ~/.brain/mirror-token');
  if (!/\.brain\/mirror-repo/.test(t)) bad.push('tick.sh does not read ~/.brain/mirror-repo');
  if (!/export MIRROR_TOKEN=[^\n]*\n[^\n]*export MIRROR_REPO=[^\n]*\nnode tools\/brain\/brain\.mjs health|export MIRROR_REPO=[^\n]*[\s\S]*node tools\/brain\/brain\.mjs fill/.test(t)) bad.push('the MIRROR_* exports come after the fill call');
  return bad;
};
const BREAKS = [
  ['MIRROR_TOKEN not exported', (t, b) => [t.replace('export MIRROR_TOKEN=', 'MIRROR_TOKEN_UNUSED='), b]],
  ['MIRROR_REPO not exported', (t, b) => [t.replace('export MIRROR_REPO=', 'MIRROR_REPO_UNUSED='), b]],
  ['token file not read', (t, b) => [t.replaceAll('.brain/mirror-token', '.brain/other-token'), b]],
  ['a new MIRROR_ variable is read but not exported', (t, b) => [t, b + '\nconst x = process.env.MIRROR_EXTRA;\n']],
  ['exports moved after the fill', (t, b) => [t.replace(/(\[ -r "\$HOME\/\.brain\/mirror-token"[^\n]*\n\[ -r "\$HOME\/\.brain\/mirror-repo"[^\n]*\n)([\s\S]*)$/, '$2$1'), b]],
];
const real = verdicts(tick, brain);
let caught = 0;
for (const [name, mk] of BREAKS) { const [t, b] = mk(tick, brain); if ((t !== tick || b !== brain) && verdicts(t, b).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`tickenvcheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${6 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
