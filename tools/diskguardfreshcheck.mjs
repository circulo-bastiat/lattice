#!/usr/bin/env node
// diskguardfreshcheck.mjs - #11254: gate.mjs diskGuard() must honour a FRESH low usage.json reading (exit 5) but ignore
// a stale (>1 h), missing or corrupt one. Anti-vacuity: a copy of gate.mjs with the age test removed must be caught.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GATE = join(ROOT, 'tools', 'infra', 'gate.mjs');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const env = { ...process.env }; delete env.GITHUB_ACTIONS; delete env.MCLITE_GATE; delete env.MCLITE_GATE_NODISK;
function run(gateFile, usage) {
  const top = mkdtempSync(join(tmpdir(), 'mclite-diskguard-'));
  const ws = join(top, 'ws'); mkdirSync(join(ws, 'tools'), { recursive: true }); mkdirSync(join(ws, '.git'));
  writeFileSync(join(ws, 'tools', 'go.mjs'), '//stub\n');
  writeFileSync(join(ws, '.git', 'mclite-gate.json'), JSON.stringify({ at: Date.now() + 1e9 }));   // clear cache: only the disk guard may stop
  if (usage !== undefined) { mkdirSync(join(top, '_status')); writeFileSync(join(top, '_status', 'usage.json'), usage); }
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(gateFile).href)}).then(m => (m.gate || m.default)(${JSON.stringify(ws)}))`],
    { encoding: 'utf8', env, timeout: 30e3 });
  rmSync(top, { recursive: true, force: true });
  return r.status;
}
const at = (ms) => new Date(Date.now() - ms).toISOString();
const low = (ms) => JSON.stringify({ diskFreeGB: 3.7, at: at(ms) });
function cases(gateFile, label, expectStaleStops) {
  const res = {
    fresh: run(gateFile, low(60e3)), stale: run(gateFile, low(2 * 86400e3)),
    missing: run(gateFile, undefined), corrupt: run(gateFile, '{not json'),
  };
  return res;
}
const g = cases(GATE);
ok(g.fresh === 5, `fresh low reading must stop with exit 5 (got ${g.fresh})`);
ok(g.stale !== 5, `2-day-old low reading must not stop (got ${g.stale})`);
ok(g.missing !== 5, `missing usage.json must not stop (got ${g.missing})`);
ok(g.corrupt !== 5, `corrupt usage.json must not stop (got ${g.corrupt})`);

// anti-vacuity: remove the age test, the stale case must then be caught
const src = readFileSync(GATE, 'utf8');
const stripped = src.replace(/ && Date\.now\(\) - Date\.parse\(u\.at\) < 3600e3 \/\*AGE\*\//, '');
let breaks = 0;
if (stripped !== src) {
  const tmp = join(ROOT, 'tools', 'infra', 'gate.noage.tmp.mjs');
  writeFileSync(tmp, stripped);
  try { if (run(tmp, low(2 * 86400e3)) === 5) { breaks++; console.log('✓ break caught: without the age test a stale reading stops the build'); } } finally { rmSync(tmp, { force: true }); }
}
ok(breaks === 1, 'removing the age test was not caught');
if (fails.length) { for (const f of fails) console.log('✗ ' + f); process.exit(1); }
console.log(`diskguardfreshcheck: ${pass} checks passed, ${breaks} breaks caught`);
