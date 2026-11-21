#!/usr/bin/env node
// #9536: the pilot farm must push its results every ~20 min (a killed run keeps what it proved). Breaks its own inputs to prove it can fail.
import { readFileSync } from 'node:fs';
import { shipBatch } from './infra/pilotfarm.mjs';

const wf = readFileSync(new URL('../.github/workflows/pilot-farm.yml', import.meta.url), 'utf8') + readFileSync(new URL('./infra/mirror/farm-run.yml', import.meta.url), 'utf8');   // #10530: both farm workflows
const src = readFileSync(new URL('./infra/pilotfarm.mjs', import.meta.url), 'utf8');
function verdict(wfText, srcText, ship) {
  const bad = [];
  if ((wfText.match(/pilotfarm\.mjs --run[^\n]*--ship-every \d+/g) || []).length !== 2) bad.push('a farm workflow step lacks --ship-every (both pilot-farm.yml and farm-run.yml must ship in batches)');
  if (!/name: ship the results\n\s+if: always\(\)/.test(wfText)) bad.push('ship step lacks if: always()');
  if (!/shipMaybe\(\);/.test(srcText)) bad.push('pilotfarm never calls shipMaybe after a lane');
  // #10530: every result add is ADDITIVE: a batch that stages a deletion of a file master also dropped is a rename/delete conflict on every landing
  if ((wfText.match(/git add [^\n]*pilot-results/g) || []).length !== 2 || (wfText.match(/git add --ignore-removal tools\/referee\/lockstep\/pilot-results/g) || []).length !== 2) bad.push('a farm workflow stages pilot-results without --ignore-removal');
  const calls = [];
  const sh = (a) => { calls.push(a); return a[0] === 'diff' ? 'tools/referee/lockstep/pilot-results/x/a-0.json\n' : ''; };
  let br; try { br = ship({ sh, run: '77', n: 2 }); } catch (e) { bad.push('ship threw ' + e.message); }
  if (br !== 'farm/77-p2') bad.push('branch is ' + br);
  if (!calls.some((a) => a[0] === 'add' && a.includes('--ignore-removal'))) bad.push('shipBatch stages pilot-results without --ignore-removal (#10530)');
  if (!calls.some((a) => a.includes('push') && a.includes('HEAD:refs/heads/farm/77-p2'))) bad.push('no push to farm/<run>-p<n>');
  const empty = (() => { try { return ship({ sh: () => '', run: '77', n: 3 }); } catch { return 'threw'; } })();
  if (empty !== null) bad.push('empty batch should ship nothing');
  return bad;
}
const base = verdict(wf, src, shipBatch);
if (base.length) { console.log('FAIL: ' + base.join('; ')); process.exit(1); }
const mutants = [
  verdict(wf.replace(/ --ship-every \d+/, ''), src, shipBatch),
  verdict(wf.replace('if: always()', ''), src, shipBatch),
  verdict(wf, src.replace(/shipMaybe\(\);/g, ''), shipBatch),
  verdict(wf, src, (o) => { const c = []; return shipBatch({ ...o, sh: (a) => (a.includes('push') ? '' : o.sh(a)) }); }),
  verdict(wf, src, (o) => shipBatch({ ...o, run: 'x' })),
  verdict(wf.replace('git add --ignore-removal tools/referee/lockstep/pilot-results >/dev/null', 'git add tools/referee/lockstep/pilot-results >/dev/null'), src, shipBatch),   // #10530 farm-run.yml
  verdict(wf.replace(/git add --ignore-removal tools\/referee\/lockstep\/pilot-results(?! >)/, 'git add tools/referee/lockstep/pilot-results'), src, shipBatch),   // #10530 pilot-farm.yml
  verdict(wf, src, (o) => shipBatch({ ...o, sh: (a) => o.sh(a[0] === 'add' ? a.filter((x) => x !== '--ignore-removal') : a) })),   // #10530 shipBatch
];
const caught = mutants.filter((m) => m.length).length;
if (caught !== mutants.length) { console.log(`FAIL: only ${caught}/${mutants.length} mutants caught`); process.exit(1); }
console.log(`${caught} breaks caught`);
