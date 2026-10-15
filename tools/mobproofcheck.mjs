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
ok(fixture((c) => { c.obj.mobs.c = []; }).rows.c.proven === false, 'roster mob with no rows');
ok(fixture((c) => { delete c.files.model.b; }).proven === 1, 'proven count drops');
const M = buildMatrix(); ok(M.roster === 91, `real roster is 91 (${M.roster})`);
const d = diffProven(base, ['a', 'zz']); ok(d.regressed.length === 1 && d.regressed[0].mob === 'zz', 'regressed unknown mob');
ok(diffProven(fixture((c) => { c.files.drops.a.pass = false; }), ['a']).regressed[0]?.dimension === 'drops', 'proven mob turned red');
console.log(bad ? `FAIL ${bad}` : `mobproofcheck: ${caught} breaks caught`); process.exit(bad ? 1 : 0);
