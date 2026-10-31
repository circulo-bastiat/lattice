#!/usr/bin/env node
// mirrorfaultcheck.mjs - #9642: with TEST_REMOTE=mirror every stage runs on the hosted mirror, so a shard that hit its wall (pack-shard-timeout), could not
// build or wrote no ledger is the MIRROR's fault: never a red check, never this PC runner's environment fault (22 Oct: full.mjs flagged PC, #9232,
// and filed no RED issues and no matrix for the whole run). mergeShards moves it to ledger.mirrorFaults and the shard's stages to skipped (not concluded);
// full.mjs mails the fixer and, for a mass failure on the mirror, never opens a runner fault issue. Breaks: the old merge, ids not skipped, the wiring removed.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const SRC = readFileSync(new URL('./infra/fullshard.mjs', import.meta.url), 'utf8');
const FULL = readFileSync(new URL('./infra/full.mjs', import.meta.url), 'utf8');
let asserts = 0, fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const load = async (src) => { const d = mkdtempSync(join(tmpdir(), 'mfc-')), f = join(d, `fullshard-${n++}.mjs`); writeFileSync(f, src); try { return await import(pathToFileURL(f).href); } finally { rmSync(d, { recursive: true, force: true }); } };
const cases = async (src) => {
  const { mergeShards } = await load(src); const bad = [];
  const d = mkdtempSync(join(tmpdir(), 'mfd-'));
  try {
    writeFileSync(join(d, 'shard-0.json'), JSON.stringify({ i: 0, ids: ['a', 'b', 'redcheck'], ran: 0, failed: ['pack-shard-timeout'], skippedInSlice: [], flaky: [] }));
    writeFileSync(join(d, 'shard-1.json'), JSON.stringify({ i: 1, ids: ['c', 'x'], ran: 2, failed: ['x'], skippedInSlice: [], flaky: [] }));
    writeFileSync(join(d, 'shard-2.json'), JSON.stringify({ i: 2, ids: ['e', 'y'], ran: 0, failed: ['pack-shard-build', 'y'], skippedInSlice: [], flaky: [] }));
    const L = mergeShards(d, 3).ledger;
    if (L.failedStages.some((f) => /^pack-shard-/.test(f))) bad.push('a timed-out/unbuilt shard is still a failed (setup) stage');
    if (!['a', 'b', 'redcheck', 'e'].every((x) => (L.skipped || []).includes(x))) bad.push("the faulty shard's stages are not counted as not run");
    if (!L.failedStages.includes('x') || !L.failedStages.includes('y')) bad.push('a real red is lost');
    if ((L.skipped || []).includes('y')) bad.push('a real red of a faulty shard is hidden as not run');
    if (!(L.mirrorFaults || []).some((m) => /pack-shard-timeout/.test(m))) bad.push('the mirror fault is not reported');
    const d2 = mkdtempSync(join(tmpdir(), 'mfe-')); writeFileSync(join(d2, 'shard-0.json'), JSON.stringify({ i: 0, ids: ['q'], ran: 1, failed: [], skippedInSlice: [] }));
    const M = mergeShards(d2, 2).ledger; rmSync(d2, { recursive: true, force: true });
    if (!M.failedStages.includes('pack-shard-1-missing')) bad.push('a missing shard no longer shows (full.mjs stops on it)');
  } finally { rmSync(d, { recursive: true, force: true }); }
  return bad;
};
const real = await cases(SRC); ok(real.length === 0, 'mergeShards: ' + real.join('; '));
const MARK = /    if \(setup\.length\) \{[^\n]*\n/;
ok(MARK.test(SRC), 'fullshard.mjs has the #9642 setup-shard line');
for (const [name, src] of [['the old merge (setup stage stays a failure)', SRC.replace(MARK, '')], ['the shard ids are not skipped', SRC.replace('skippedInSlice.push(...(s.ids || []).filter((x) => !(s.failed || []).includes(x))); ', '')]]) {
  if (src === SRC) { ok(false, 'break did not apply: ' + name); continue; }
  const b = await cases(src); ok(b.length > 0, `cases cannot tell "${name}"`); if (b.length) { breaks++; console.log(`  ✓ "${name}" caught: ${b[0]}`); }
}
const WIRES = [['full.mjs mails the fixer about mirror shard faults', /merged\.ledger\.mirrorFaults \|\| \[\]\)\.length\) \{/], ['full.mjs never blames the PC runner for a mirror run', /if \(fault && AGG\) \{[\s\S]{0,600}\} else if \(fault\) \{\n  \/\/ github\.token cannot edit runner labels/]];
for (const [name, re] of WIRES) { ok(re.test(FULL), name); const br = FULL.replace(re, 'X'); if (br !== FULL && !re.test(br)) { breaks++; console.log(`  ✓ wiring "${name}" removed is caught`); } }
console.log(`mirrorfaultcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
