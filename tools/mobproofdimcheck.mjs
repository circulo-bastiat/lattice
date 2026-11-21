// #8982: a full run fails loud when a proof dimension has no out/<dim>.json or a stage left a SKIP marker.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { DIMS } from './mobproof.mjs';
const HERE = new URL('.', import.meta.url).pathname;
let bad = 0, caught = 0;
const fix = (omit, skip) => { const d = mkdtempSync(join(tmpdir(), 'mpd-')); for (const x of DIMS) if (x !== omit) writeFileSync(join(d, x + '.json'), JSON.stringify({ __sha: 'S', zombie: { pass: true } })); if (skip) writeFileSync(join(d, skip + '.skip'), 'golden not generated'); return d; };
const run = (d) => spawnSync('node', [join(HERE, 'mobproof-merge.mjs'), d], { encoding: 'utf8' });
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const brk = (n, c) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT ' + n); } };
const all = run(fix()); ok(all.status === 0 && !all.stdout, 'all present passes');
for (const d of DIMS) { const r = run(fix(d)); brk('missing ' + d, r.status !== 0 && r.stdout.includes(`proof dimension ${d} MISSING for all mobs`)); }
const sk = run(fix(null, 'drops')); brk('skip marker', sk.status !== 0 && sk.stdout.includes('proof dimension drops MISSING') && sk.stdout.includes('SKIP'));
{ const d = fix(); writeFileSync(join(d, 'lockstep.json'), '{"__sha":"S"}'); brk('empty dimension file', run(d).status !== 0); }
console.log(`mobproofdimcheck: ${bad ? bad + ' FAILED' : 'ok'}, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
