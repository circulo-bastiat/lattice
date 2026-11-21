// #11400: which generator sources produced assets/. gen-data.mjs writes assets/.gen-stamp.json (sha1 per generator file);
// build.mjs refuses when the generators on disk no longer match it. Catches "new GUI code + an assets/ made by older tools"
// (Dan's stale gui.bin), which the mtime check on src/19_data.gen.js cannot see. Content hashes, not mtimes: git checkouts reset mtimes.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GEN = /^(extract|pack|build|gen|merge|bake)-[^/]*\.mjs$/;
const SKIP = new Set(['gen-panorama.mjs']);   // regenerated on every build, writes src/ not assets/
export const STAMP = (root) => join(root, 'assets', '.gen-stamp.json');

export function hashGenerators(root) {
  const dir = join(root, 'tools'), out = {};
  for (const f of readdirSync(dir).sort()) {
    if (GEN.test(f) && !SKIP.has(f)) out[f] = createHash('sha1').update(readFileSync(join(dir, f))).digest('hex').slice(0, 12);
  }
  return out;
}
export const writeStamp = (root) => writeFileSync(STAMP(root), JSON.stringify(hashGenerators(root)));

/** [] when fresh; else the list of problems (a missing stamp is one). Pure: callers decide to exit. */
export function staleGenerators(root) {
  if (!existsSync(join(root, 'assets'))) return [];
  if (!existsSync(STAMP(root))) return ['assets/.gen-stamp.json is missing (assets/ predates the stamp or was not made by gen-data)'];
  let was; try { was = JSON.parse(readFileSync(STAMP(root), 'utf8')); } catch { return ['assets/.gen-stamp.json is unreadable']; }
  const now = hashGenerators(root), bad = [];
  for (const f of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (was[f] !== now[f]) bad.push(`tools/${f} ${!was[f] ? 'is new' : !now[f] ? 'was removed' : 'changed'} since assets/ was generated`);
  }
  return bad;
}
