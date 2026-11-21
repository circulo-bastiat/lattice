#!/usr/bin/env node
// fulltimeoutcheck.mjs - 21 Oct: a full-suite stage that ONLY timed out is inconclusive, not red. Without this ~35 of 48 short worker runs a day closed
// `RED lockstep-*` issues whose only evidence was a cold-cache TIMEOUT on the hosted mirror (the full suite re-filed them every 2 h).
// Cases: timedOutIds reads the FINAL row; mergeShards carries timedOut and keeps it out of failedStages; planTimeoutIssue creates/updates/closes ONE
// tracking issue; fullshard.mjs and full.mjs are wired (timeout-only is partitioned out of failed, and counts as "did not conclude" for RED issues).
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { timedOutIds, mergeShards, lastRowTimedOut } from './infra/fullshard.mjs';
import { planTimeoutIssue, TIMEOUT_TITLE, planRedIssues } from './infra/redissues.mjs';

let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const rows = ' ✗ lockstep-a      720000 ms  TIMEOUT after 12 min\n ✗ boomcheck         50 ms  3 assertions, 1 failures\n ✓ lockstep-b   9000 ms  3 assertions, 0 failures, 3 breaks caught\n ✗ lockstep-ab    10 ms  TIMEOUT after 12 min';
const T = (fn = timedOutIds) => { const bad = [];
  const t = (n, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(n); };
  t('a TIMEOUT row is timed out', () => fn(rows, ['lockstep-a']).join() === 'lockstep-a');
  t('an assertion failure is NOT a timeout', () => fn(rows, ['boomcheck']).length === 0);
  t('a passing row is not a timeout', () => fn(rows, ['lockstep-b']).length === 0);
  t('an id inside a longer id does not match', () => fn(rows, ['lockstep']).length === 0);
  t('only the asked ids are returned', () => fn(rows, ['lockstep-a', 'lockstep-ab', 'boomcheck']).join() === 'lockstep-a,lockstep-ab');
  return bad; };
const bad = T(); ok(bad.length === 0, 'timedOutIds: ' + bad.join('; '));
for (const [name, fn] of [['every failure counts as timeout', (s, ids) => ids], ['nothing counts', () => []], ['substring match', (s, ids) => ids.filter((id) => String(s).includes(id) && /TIMEOUT/.test(s))]]) { const b = T(fn); ok(b.length > 0, `cases cannot tell "${name}" from timedOutIds`); if (b.length) breaks++; }

// #9651: the retry of a 12-min TIMEOUT ran inside a 10-min wall and was killed before printing a row, so the stage stayed RED. The verdict is the LAST row
// each id printed anywhere in the shard log (first run or retry).
{ const killed = ' ✗ lockstep-a   720000 ms  TIMEOUT after 12 min\n ✗ boomcheck  50 ms  3 assertions, 1 failures\n=== RETRY of the failed stages (lockstep-a,boomcheck) ===\n';
  const R = (fn) => { const bad = []; const t = (n, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(n); };
    t('a TIMEOUT whose retry was killed (no row) stays a timeout', () => fn(killed, ['lockstep-a']).join() === 'lockstep-a');
    t('a TIMEOUT whose retry failed an assertion is red, not a timeout', () => fn(killed + ' ✗ lockstep-a   9000 ms  3 assertions, 1 failures\n', ['lockstep-a']).length === 0);
    t('an assertion failure stays red', () => fn(killed, ['boomcheck']).length === 0);
    t('a retry that timed out is a timeout', () => fn(' ✗ x  5 ms  2 assertions, 1 failures\n=== RETRY of the failed stages (x) ===\n ✗ x  600000 ms  TIMEOUT after 10 min\n', ['x']).join() === 'x');
    return bad; };
  const rb = R(lastRowTimedOut); ok(rb.length === 0, 'lastRowTimedOut: ' + rb.join('; '));
  const oldFin = (log, ids) => timedOutIds(log.includes('=== RETRY') ? log.slice(log.lastIndexOf('=== RETRY')) : log, ids);   // the pre-#9651 verdict
  const b = R(oldFin); ok(b.length > 0, 'cases cannot tell the retry-segment-only verdict (#9651)'); if (b.length) { breaks++; console.log('  ✓ the retry-segment-only verdict fails: ' + b[0]); } }

// mergeShards: timedOut comes through and never sits in failedStages
{ const d = mkdtempSync(join(tmpdir(), 'fto-')); for (let i = 0; i < 16; i++) writeFileSync(join(d, `shard-${i}.json`), JSON.stringify({ ran: 5, failed: i === 1 ? ['boomcheck'] : [], timedOut: i === 2 ? ['lockstep-a'] : [], skippedInSlice: [], flaky: [] }));
  const m = mergeShards(d, 16).ledger; ok(m.timedOut.join() === 'lockstep-a' && !m.failedStages.includes('lockstep-a') && m.failedStages.join() === 'boomcheck', 'mergeShards carries timedOut apart from failedStages'); }

// the tracking issue: one issue, updated, closed when empty
const iss = (number, title = TIMEOUT_TITLE, state = 'open') => ({ number, title, state });
const P = (fn = planTimeoutIssue) => { const bad = []; const t = (n, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(n); };
  t('timed out + no issue -> create', () => fn({ ids: ['a'], issues: [] }).op === 'create');
  t('timed out + open issue -> update it (not a second one)', () => { const a = fn({ ids: ['a'], issues: [iss(7)] }); return a.op === 'update' && a.number === 7; });
  t('none timed out + open issue -> close', () => { const a = fn({ ids: [], issues: [iss(7)] }); return a.op === 'close' && a.number === 7; });
  t('none timed out + no issue -> nothing', () => fn({ ids: [], issues: [] }).op === null);
  t('a closed issue is not reused', () => fn({ ids: ['a'], issues: [iss(7, TIMEOUT_TITLE, 'closed')] }).op === 'create');
  t('another issue with a different title is ignored', () => fn({ ids: ['a'], issues: [iss(8, 'something else')] }).op === 'create');
  return bad; };
const pb = P(); ok(pb.length === 0, 'planTimeoutIssue: ' + pb.join('; '));
for (const [name, fn] of [['always creates', ({ ids }) => ({ op: ids.length ? 'create' : null })], ['never closes', (x) => { const a = planTimeoutIssue(x); return a.op === 'close' ? { op: null } : a; }], ['reuses closed issues', ({ ids, issues }) => planTimeoutIssue({ ids, issues: issues.map((i) => ({ ...i, state: 'open' })) })]]) { const b = P(fn); ok(b.length > 0, `cases cannot tell "${name}"`); if (b.length) breaks++; }

// a timed-out id passed as "skipped" neither creates a RED issue nor closes an open one
ok(planRedIssues({ failed: [], skipped: ['lockstep-a'], quarantine: {}, issues: [{ number: 5, title: 'RED lockstep-a: full-suite check red on master', state: 'open', labels: ['red-check'] }] }).length === 0, 'a skipped (timed out) check keeps its open RED issue and files nothing');

// wiring
const shard = readFileSync(new URL('./infra/fullshard.mjs', import.meta.url), 'utf8'), full = readFileSync(new URL('./infra/full.mjs', import.meta.url), 'utf8');
const wires = [['fullshard partitions timeouts out of failed', shard, /rec\.timedOut = lastRowTimedOut\(rec\.log, rec\.failed\); rec\.failed = rec\.failed\.filter\(\(x\) => !rec\.timedOut\.includes\(x\)\)/],
  ['fullshard does not retry a TIMEOUT (#9651)', shard, /const again = rec\.failed\.filter\(\(x\) => set\.has\(x\) && !lastRowTimedOut\(rec\.log, \[x\]\)\.length\)/],
  ['fullshard deletes the ledger before the retry (#9651)', shard, /unlinkSync\(join\(root, '\.ledger', 'suite-last\.json'\)\)/],
  ['full.mjs treats timed out as not concluded', full, /skipped: \[\.\.\.\(ledger\.skipped \|\| \[\]\), \.\.\.\(ledger\.timedOut \|\| \[\]\)\]/], ['full.mjs files the tracking issue', full, /applyTimeoutIssue\(gh, ghAll, \{ ids: ledger\.timedOut/]];
for (const [n, src, re] of wires) { ok(re.test(src), n); const broken = src.replace(re, 'X'); if (broken !== src && !re.test(broken)) breaks++; }
console.log(`fulltimeoutcheck: ${breaks} breaks caught, ${asserts} assertions, ${fails} failures`);
process.exit(fails ? 1 : 0);
