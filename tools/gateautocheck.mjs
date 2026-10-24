#!/usr/bin/env node
// gateautocheck.mjs - #8878: proves tools/infra/gateauto.mjs lifts Gate M only when all four conditions hold, and fails closed.
// ANTI-VACUITY: each condition broken individually must keep the gate closed; broken copies of the module must be caught.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const SRC = fileURLToPath(new URL('./infra/gateauto.mjs', import.meta.url));
const NOW = Date.parse('2026-10-18T12:00:00Z'), D = ['model', 'texture', 'animation', 'drops', 'spawn', 'lockstep', 'goals'];
const good = () => ({ roster: 2, proven: 2, full: true, sha: 'abc', generatedAt: '2026-10-18T10:00:00Z',
  rows: Object.fromEntries(['cow', 'pig'].map((m) => [m, { ...Object.fromEntries(D.map((d) => [d, 'green'])), proven: true }])) });
const issues = () => [{ number: 585, title: 'gate', labels: [{ name: 'gate' }] }, { number: 9000, title: 'x', labels: [] }];
let N = 0;
function run(Q) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); }, L = (matrix, iss = issues()) => Q.decide({ matrix, issues: iss, now: NOW }).lift;
  ok(L(good()) === true, 'all four hold: lifts');
  ok(!L(null) && !L(undefined) && !L('junk') && !L({}), 'missing/unreadable matrix: closed');
  const stale = good(); stale.generatedAt = '2026-10-18T05:00:00Z'; ok(!L(stale), 'matrix 7 h old: closed');
  const unst = good(); delete unst.sha; ok(!L(unst), 'no sha stamp: closed');
  const part = good(); part.full = false; ok(!L(part), 'not a full run: closed');
  const fut = good(); fut.generatedAt = '2026-10-19T10:00:00Z'; ok(!L(fut), 'future stamp: closed');
  const bad = good(); bad.rows.cow.drops = 'red'; bad.rows.cow.proven = false; bad.proven = 1; ok(!L(bad), 'one RED cell: closed');
  const mis = good(); mis.rows.pig.spawn = 'missing'; ok(!L(mis), 'one MISSING cell (proven flag lying): closed');
  const cl = good(); cl.proven = 1; ok(!L(cl), 'matrix header claims 1/2: closed');
  const lie = good(); lie.roster = 3; lie.proven = 3; ok(!L(lie), 'N != roster size: closed');
  ok(!L(good(), [...issues(), { number: 9001, title: 'PROOF: cow drops', labels: [] }]), 'open PROOF issue: closed');
  ok(!L(good(), [...issues(), { number: 9002, title: 'y', labels: [{ name: 'tester-finding' }] }]), 'open tester-finding: closed');
  for (const n of [578, 579, 581, 582, 584]) ok(!L(good(), [...issues(), { number: n, title: 'kw', labels: [] }]), `open KW #${n}: closed`);
  ok(L(good(), [...issues(), { number: 9003, title: 'PROOF: x', labels: [], pull_request: {} }]) === true, 'a PR titled PROOF is not an issue');
  ok(/reopen #585/.test(Q.comment(Q.decide({ matrix: good(), issues: issues(), now: NOW }))), 'comment carries the undo');
  return f;
}
const fails = run(await import(pathToFileURL(SRC).href)), total = N, src = readFileSync(SRC, 'utf8');
const BREAKS = [['staleness ignored', 'age <= MAX_AGE_H', 'true'], ['unstamped accepted', 'M.full === true && M.sha && ', ''],
  ['proven claim ignored', ' && M.proven === M.roster', ''],
  ['PROOF issues ignored', 'proofOpen === 0', 'true'], ['findings ignored', 'finds.length === 0', 'true'],
  ['KW list dropped', '|| KW.includes(i.number)', ''], ['any single condition suffices', '.every((c) => c.ok)', '.some((c) => c.ok)']];
let caught = 0;
for (const [name, from, to] of BREAKS) {
  if (!src.includes(from)) { fails.push(`break "${name}": gateauto.mjs no longer contains ${from}`); continue; }
  const d = mkdtempSync(join(tmpdir(), 'ga-')), p = join(d, 'g.mjs'); writeFileSync(p, src.split(from).join(to));
  if (run(await import(pathToFileURL(p).href)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
  rmSync(d, { recursive: true, force: true });
}
console.log(`gateautocheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !x.startsWith('break')).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
