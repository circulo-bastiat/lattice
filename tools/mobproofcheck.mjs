// mobproofcheck (#7520): the matrix must go MISSING/red when an input is broken. Prints "<n> breaks caught".
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMatrix, DIMS } from './mobproof.mjs';
import { diffProven } from './mobproof-proven.mjs';
const T = dirname(fileURLToPath(import.meta.url)), roster = ['a', 'b'];
let caught = 0, bad = 0; const ok = (c, w) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT: ' + w); } };
function fixture(mut) {
  const d = mkdtempSync(join(tmpdir(), 'mp-')); mkdirSync(join(d, 'out')); mkdirSync(join(d, 'referee', 'lanes.d'), { recursive: true });
  const obj = { mobs: { a: [], b: [] } }, files = {}, lanes = { a: 1, b: 1 }, known = [];
  for (const x of DIMS) files[x] = { a: { pass: true }, b: { pass: true } };
  mut({ obj, files, lanes, known });
  writeFileSync(join(d, 'mobl3-mobs.json'), JSON.stringify(obj));
  writeFileSync(join(d, 'goalaudit-known.json'), JSON.stringify({ filed: known }));
  for (const [x, f] of Object.entries(files)) if (f) writeFileSync(join(d, 'out', x + '.json'), JSON.stringify(f));
  for (const m of Object.keys(lanes)) writeFileSync(join(d, 'referee', 'lanes.d', m + '.json'), JSON.stringify({ mob: m }));
  const M = buildMatrix({ tools: d, out: join(d, 'out') }); rmSync(d, { recursive: true }); return M;
}
const base = fixture(() => {});
ok(base.proven === 2 && base.roster === 2, 'baseline all green must be proven 2/2');
for (const x of DIMS) {
  ok(fixture((c) => { delete c.files[x].b; }).rows.b[x] === 'missing', `drop mob row from ${x}`);
  ok(fixture((c) => { c.files[x].b.pass = false; }).rows.b[x] === 'red', `flip pass in ${x}`);
  ok(fixture((c) => { c.files[x] = null; }).rows.a[x] === 'missing', `delete ${x} file`);
  ok(fixture((c) => { c.files[x].b.pass = 'yes'; }).rows.b[x] === 'missing', `non-boolean pass in ${x}`);
}
ok(fixture((c) => { delete c.lanes.b; }).rows.b.lockstep === 'missing', 'lane removed');
ok(fixture((c) => { c.known.push('b|X.Goal'); }).rows.b.goals === 'red', 'goal known entry');
// #10254: an aggregate row (fish -> cod+salmon lanes, player_slim -> player) has no lane of its own name; it counts only through the lanes its row names, and only while those lanes exist
const agg = (mut) => fixture((c) => { c.obj.mobs.g = []; for (const f of DIMS) c.files[f].g = { pass: true }; c.files.lockstep.g = { pass: true, lanes: ['a', 'b'] }; mut(c); });
ok(agg(() => {}).rows.g.lockstep === 'green', 'aggregate row credited through its lanes');
ok(agg((c) => { c.files.lockstep.g.lanes = []; }).rows.g.lockstep === 'missing', 'aggregate row with no lanes is missing');
ok(agg((c) => { delete c.files.lockstep.g.lanes; }).rows.g.lockstep === 'missing', 'a row with no lane and no lanes list is missing');
ok(agg((c) => { c.files.lockstep.g.lanes = ['a', 'zzz']; }).rows.g.lockstep === 'missing', 'aggregate row naming a lane that does not exist is missing');
ok(agg((c) => { c.files.lockstep.g.pass = false; }).rows.g.lockstep === 'red', 'aggregate row that diverges is red');
ok(fixture((c) => { c.obj.mobs.c = []; }).rows.c.proven === false, 'roster mob with no rows');
ok(fixture((c) => { delete c.files.model.b; }).proven === 1, 'proven count drops');
const M = buildMatrix(); ok(M.roster === 91, `real roster is 91 (${M.roster})`);
// stale ledger (#8163): goalaudit has 0 differing rows, so any 'filed' key is stale and may only be deleted
import { readFileSync } from 'node:fs';
const staleKeys = (f) => (f.filed || []).filter((k) => k);
const real = JSON.parse(readFileSync(join(T, 'goalaudit-known.json'), 'utf8'));
ok(staleKeys(real).length === 0, 'stale goalaudit-known.json filed keys: ' + staleKeys(real).join(', '));
ok(staleKeys({ filed: ['wolf|ActiveTargetGoal'] }).length === 1, 'a stale filed key is flagged');
const d = diffProven(base, ['a', 'zz']); ok(d.regressed.length === 1 && d.regressed[0].mob === 'zz', 'regressed unknown mob');
ok(diffProven(fixture((c) => { c.files.drops.a.pass = false; }), ['a']).regressed[0]?.dimension === 'drops', 'proven mob turned red');
// #8084: lockstep.json is written from recorded pilot results
import { lockstepRows } from './moblockstepproof.mjs';
function lsFix(mut) {
  const d = mkdtempSync(join(tmpdir(), 'ml-')), ld = join(d, 'lanes'), rr = join(d, 'res'); mkdirSync(ld); mkdirSync(rr);
  writeFileSync(join(ld, 'a.json'), JSON.stringify({ id: 'a', mob: 'a' }));
  const recs = Array.from({ length: 20 }, (_, i) => ({ lane: 'a', salt: i, same: true })); mut(recs);
  for (const r of recs) writeFileSync(join(rr, `a-${r.salt}.json`), JSON.stringify(r));
  const rows = lockstepRows({ lanesDir: ld, resultsDir: rr }); rmSync(d, { recursive: true }); return rows;
}
const lsMatrix = (rows) => fixture((c) => { c.files.lockstep = rows; });
ok(lsMatrix(lsFix(() => {})).rows.a.lockstep === 'green', 'lockstep: zero divergences is green');
ok(lsMatrix(lsFix((r) => { r[3].firstDiv = 42; })).rows.a.lockstep === 'red', 'lockstep: one diverging salt is red');
ok(lsFix((r) => { r[3].firstDiv = 42; }).a.failed[3] === 42, 'lockstep: failed records the first diverging tick');
ok(lsMatrix(lsFix((r) => { r.length = 0; })).rows.a.lockstep === 'missing', 'lockstep: no result files is missing');
ok(lsMatrix(lsFix((r) => { r.length = 19; })).rows.a.lockstep === 'missing', 'lockstep: 19 salts is missing, not green');
ok(lsFix((r) => { r[5].same = false; r[5].firstDiv = 9; r.push({ lane: 'a', salt: 20, same: true }); }).a.pass === true, 'lockstep: a server-unstable salt is excluded and replaced');
console.log(bad ? `FAIL ${bad}` : `mobproofcheck: ${caught} breaks caught`); process.exit(bad ? 1 : 0);
