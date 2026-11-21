#!/usr/bin/env node
// sync-root-scripts.mjs — issue #46: ADD-CLAUDE-ACCOUNT.cmd and SWITCH-ACCOUNT.cmd must be one
// double-click away from a brand-new PC, which means a copy at the PROJECTS ROOT (one level above
// this checkout) as well as the copy committed here in mclite/. mclite/'s copy is the source of
// truth (it's the one in git); this script is the mechanism that keeps the root copy in step with
// it — build.mjs calls it on every build, which every session runs constantly per RUN.md, so the
// root copy self-heals the moment a session with the real checkout builds.
//
// ⚠ THE GUARD. build.mjs runs from all sorts of places that are NOT Dan's real
// `Downloads\Projects\mclite` — a cloud container, a Cowork `/tmp/mc-<uid>/...` clone, a Windows
// per-issue clone under `%LOCALAPPDATA%\mclite-work\...` (see go.mjs's `workspace()`). In every one
// of those, "one level up from this checkout" is some throwaway build/session directory, and
// RUN.md's own rule is to work only inside a session's own workspace — writing two files into a
// stranger directory one level up would break exactly that rule. So this only ever writes when the
// parent directory already looks like Dan's real, consolidated Projects folder: it must already
// contain BOTH `_secrets` and `_status` (CONSOLIDATE.cmd creates both, once, and nothing else does).
// Anywhere else, this is a clean no-op.
//
//   node tools/sync-root-scripts.mjs [--quiet]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MCLITE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SYNCED_FILES = ['ADD-CLAUDE-ACCOUNT.cmd', 'SWITCH-ACCOUNT.cmd'];

/** True only for a parent directory that looks like Dan's real, consolidated Projects folder. */
export function looksLikeProjectsRoot(parent) {
  return existsSync(join(parent, '_secrets')) && existsSync(join(parent, '_status'));
}

export function syncRootScripts(root = MCLITE_ROOT, opts = {}) {
  const { quiet = false, force = false } = typeof opts === 'boolean' ? { quiet: opts } : opts;
  const parent = dirname(root);
  if (!force && !looksLikeProjectsRoot(parent)) {
    if (!quiet) console.log(`sync-root-scripts: SKIP — ${parent} is not Dan's Projects root (no _secrets + _status siblings)`);
    return [];
  }
  const results = [];
  for (const name of SYNCED_FILES) {
    const src = join(root, name);
    const dst = join(parent, name);
    if (!existsSync(src)) { results.push({ name, action: 'skip (no source)' }); continue; }
    const body = readFileSync(src, 'utf8');
    const already = existsSync(dst) && readFileSync(dst, 'utf8') === body;
    if (already) { results.push({ name, action: 'up to date' }); continue; }
    writeFileSync(dst, body);
    results.push({ name, action: 'copied' });
  }
  if (!quiet) for (const r of results) console.log(`sync-root-scripts: ${r.name} — ${r.action}`);
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  syncRootScripts(MCLITE_ROOT, { quiet: process.argv.includes('--quiet') });
}
