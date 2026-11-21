// tools/infra/classmapregen.mjs - #11906: docs/audits/classmap.md + tools/classmap.json are GENERATED (node tools/classmap.mjs) but committed, and every AUDIT-MAP
// PR rewrites them, so parallel PRs conflicted (a worker run each, "merge master, regenerate classmap") or merged cleanly with summed counts stale (master red #11790).
// The lander regenerates them on the tested merge tree instead: a conflict confined to them is finished by regenerating, and a tree whose files differ after
// regeneration gets one extra commit, so what is tested is what lands (land.mjs then gives the PR branch that tree through landheal.mjs).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const GENERATED = /^(?:docs\/audits\/classmap\.md|tools\/classmap\.json)$/;
const FILES = ['docs/audits/classmap.md', 'tools/classmap.json'];

/** Run the generator in `cwd`. '' = wrote both files; 'skipped: ...' = no generator or no .decomp here (nothing touched); else why it failed. */
export function runClassmap(cwd) {
  if (!existsSync(join(cwd, 'tools/classmap.mjs'))) return 'skipped: no tools/classmap.mjs';
  if (!existsSync(join(cwd, '.decomp'))) return 'skipped: no .decomp in this checkout';
  const r = spawnSync('node', ['tools/classmap.mjs'], { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  return r.status ? 'classmap.mjs failed: ' + String(r.stderr || r.stdout).trim().slice(0, 200) : '';
}

/** Regenerate on the merged tree; commit the two files when they changed. { changed, why }: why is '' on success and starts with 'skipped' when nothing ran. */
export function regenClassmap(cwd, log = () => {}) {
  const why = runClassmap(cwd);
  if (why) { log(`classmap regen: ${why}`); return { changed: false, why }; }
  const sh = (a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  if (!sh(['status', '--porcelain', '--', ...FILES]).stdout.trim()) return { changed: false, why: '' };
  if (sh(['add', '--', ...FILES]).status) return { changed: false, why: 'git add failed' };
  const c = sh(['commit', '-q', '-m', 'lander: regenerate docs/audits/classmap.md + tools/classmap.json (#11906)']);
  if (c.status) return { changed: false, why: 'commit failed: ' + String(c.stderr || c.stdout).trim().slice(0, 160) };
  log('classmap regen: the merged tree differed from the committed map; regenerated and committed it');
  return { changed: true, why: '' };
}
