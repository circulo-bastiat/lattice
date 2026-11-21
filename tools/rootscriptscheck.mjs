#!/usr/bin/env node
// rootscriptscheck.mjs — issue #46: proves tools/sync-root-scripts.mjs actually does its job —
// copies mclite/'s ADD-CLAUDE-ACCOUNT.cmd and SWITCH-ACCOUNT.cmd to the Projects root and keeps
// them byte-identical to the committed source — AND proves its safety guard (never write outside
// a workspace unless the parent really looks like Dan's real, consolidated Projects folder).
//
// Everything below runs against a scratch pair of directories under the OS temp dir, never against
// this checkout or any real Projects folder, so it is safe to run from any workspace.
//
//   node tools/rootscriptscheck.mjs

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncRootScripts, looksLikeProjectsRoot, SYNCED_FILES } from './sync-root-scripts.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   ✗ ' + m); } };

const scratch = mkdtempSync(join(tmpdir(), 'rootscriptscheck-'));
try {
  const fakeProjects = join(scratch, 'Projects');
  const fakeMclite = join(fakeProjects, 'mclite');
  mkdirSync(fakeMclite, { recursive: true });
  const body = '@echo off\r\nrem fixture for rootscriptscheck\r\n';
  for (const name of SYNCED_FILES) writeFileSync(join(fakeMclite, name), body);

  // ── A. the guard: an ordinary workspace clone (no _secrets/_status siblings) must NOT be
  //      written to — this is the property that keeps a build run in a throwaway clone from
  //      touching anything outside that clone ─────────────────────────────────────────────────
  ok(!looksLikeProjectsRoot(fakeProjects), 'a bare parent directory does not look like Projects root');
  const before = syncRootScripts(fakeMclite, { quiet: true });
  ok(before.length === 0, 'sync is a no-op against a parent that is not Dan\'s real Projects root');
  for (const name of SYNCED_FILES) ok(!existsSync(join(fakeProjects, name)), `${name}: nothing written outside the checkout without the marker`);

  // now make it look like the real thing
  mkdirSync(join(fakeProjects, '_secrets'));
  mkdirSync(join(fakeProjects, '_status'));
  ok(looksLikeProjectsRoot(fakeProjects), 'a parent with _secrets + _status is recognised as Projects root');

  // ── B. the sync itself, once the guard allows it ────────────────────────────────────────────
  syncRootScripts(fakeMclite, { quiet: true });
  for (const name of SYNCED_FILES) {
    const dst = join(fakeProjects, name);
    ok(existsSync(dst) && readFileSync(dst, 'utf8') === body, `${name}: copied to Projects root, byte-identical to mclite/'s`);
  }

  // ── C. anti-vacuity — tamper with the root copy and confirm it is caught, then confirm the
  //      sync step repairs it ─────────────────────────────────────────────────────────────────
  const rootCopy = join(fakeProjects, SYNCED_FILES[0]);
  writeFileSync(rootCopy, body + 'rem tampered\r\n');
  const stillMatches = readFileSync(rootCopy, 'utf8') === readFileSync(join(fakeMclite, SYNCED_FILES[0]), 'utf8');
  okAv(!stillMatches, 'a tampered Projects-root copy is caught as out of sync (not silently equal)');
  syncRootScripts(fakeMclite, { quiet: true });
  okAv(readFileSync(rootCopy, 'utf8') === body, 're-running the sync step repairs the tampered copy');

  // and the mirror break: if the guard itself were broken (always returning true), an unmarked
  // parent above would wrongly get written to - assert that did NOT happen, using a FRESH bare
  // parent so this assertion cannot pass by reusing state ------------------------------------------
  const bareAgain = join(scratch, 'not-projects');
  const bareMclite = join(bareAgain, 'mclite');
  mkdirSync(bareMclite, { recursive: true });
  for (const name of SYNCED_FILES) writeFileSync(join(bareMclite, name), body);
  syncRootScripts(bareMclite, { quiet: true });
  okAv(SYNCED_FILES.every((name) => !existsSync(join(bareAgain, name))),
    'the guard really blocks the write (checked against a fresh unmarked parent, not the one already synced above)');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('');
console.log('=============== rootscriptscheck ==========');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('=============================================');
process.exit(fails.length ? 1 : 0);
