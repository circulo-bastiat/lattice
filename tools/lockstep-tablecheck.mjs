#!/usr/bin/env node
// lockstep-tablecheck -- #7063: the lockstep coverage table is fresh, goes STALE when a covered line of src/07zb_creeper.js
// changes (temp copy), and fails when a lockstep stage has no row (row dropped from a temp tsv).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (env) => spawnSync('node', [join(ROOT, 'tools/lockstep-table.mjs')], { env: { ...process.env, ...env }, encoding: 'utf8' });
let bad = 0, breaks = 0;
let asserts = 0;
const ok = (c, m) => { asserts++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { asserts++; if (c) { breaks++; console.log('✓ caught: ' + m); } else { bad++; console.log('NOT CAUGHT ' + m); } };
const fresh = run({});
ok(fresh.status === 0, 'fresh table not clean: ' + fresh.stdout.split('\n').filter((l) => /STALE|MISSING|ORPHAN/.test(l)).slice(0, 3).join(' | '));
ok(/creeper/.test(fresh.stdout), 'no creeper row');
const tmp = mkdtempSync(join(tmpdir(), 'lstable-'));
cpSync(join(ROOT, 'src'), join(tmp, 'src'), { recursive: true });
const f = join(tmp, 'src/07zb_creeper.js'), lines = readFileSync(f, 'utf8').split('\n');
lines[Math.floor(lines.length / 2)] += ' /* edit */';
writeFileSync(f, lines.join('\n'));
const st = run({ MCLITE_SRC_DIR: join(tmp, 'src') });
caught(st.status === 1 && /creeper[^\n]*STALE/.test(st.stdout), 'edited creeper line not marked STALE');
const tsv = readFileSync(join(ROOT, 'tools/golden/lockstep-table.tsv'), 'utf8').split('\n');
const t2 = join(tmp, 't.tsv'); writeFileSync(t2, tsv.filter((l, i) => i !== 1).join('\n'));
const ms = run({ MCLITE_LOCKSTEP_TSV: t2 });
caught(ms.status === 1 && /MISSING/.test(ms.stdout), 'stage without a row not reported');
console.log(`lockstep-tablecheck: ${asserts} assertions, ${bad ? bad + ' FAILED' : 'ok'}, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
