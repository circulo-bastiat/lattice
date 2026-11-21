// lockstepstorecheck (#9364 R2): publishLockstep pushes only credited results to the store branch (fake GitHub); syncLockstep copies them from a REAL git store branch.
// Anti-vacuity: a publisher that skips the credit test / a sync that copies nothing must fail. Prints '<n> breaks caught'.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { currentInputs, SHARED } from './referee/lockstep/inputs.mjs';
import { publishLockstep, syncLockstep } from './infra/lockstepstore.mjs';
for (const k of ['AUTHOR', 'COMMITTER']) { process.env[`GIT_${k}_NAME`] = 't'; process.env[`GIT_${k}_EMAIL`] = 't@t'; }
let fails = 0, breaks = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL: ' + m); } };
const T = () => mkdtempSync(join(tmpdir(), 'lss-'));
const put = (root, f, t) => { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), t); };
const root = T(); for (const f of SHARED) put(join(root, 'tools'), f, 's ' + f); put(join(root, 'tools'), 'referee/lanes.d/cow.json', '{}');
const inputs = currentInputs('cow', join(root, 'tools')), dir = T();
const w = (n, o) => writeFileSync(join(dir, n), JSON.stringify({ lane: 'cow', same: true, inputs, ...o }));
w('cow-0.json', { salt: 0 }); w('cow-1.json', { salt: 1, inputs: { x: 'y' } }); w('cow-2.json', { salt: 2, same: false }); w('cow-3.json', { salt: 3 });
const fake = (store) => async (m, p, body) => { const n = (p.match(/lockstep\/([\w.-]+)/) || [])[1]; if (m === 'GET') return store[n] || null; store[n] = { sha: 'S', content: body.content }; return {}; };
const store = { 'cow-3.json': { sha: 'X', content: Buffer.from(readFileSync(join(dir, 'cow-3.json'))).toString('base64') + '\n' } };
const r = await publishLockstep(dir, root, fake(store));
ok(r.pushed.join() === 'cow-0.json', 'only the credited new result is pushed: ' + r.pushed);
ok(r.refused.sort().join() === 'cow-1.json,cow-2.json', 'foreign-inputs and same:false refused: ' + r.refused);
ok(r.same.join() === 'cow-3.json', 'identical result already on store is skipped');
// real git store branch
const origin = T(), sh = (cwd, ...a) => { const x = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (x.status) throw new Error(x.stderr); return x.stdout; };
sh(origin, 'init', '-q', '-b', 'store'); mkdirSync(join(origin, 'lockstep')); writeFileSync(join(origin, 'lockstep', 'cow-0.json'), '{"a":1}'); writeFileSync(join(origin, 'lockstep', 'bad name.json'), '{}');
sh(origin, 'add', '.'); sh(origin, 'commit', '-qm', 's');
const clone = T(); sh(clone, 'init', '-q'); sh(clone, 'remote', 'add', 'origin', origin);
const dest = join(T(), 'res'), wrote = syncLockstep(clone, dest);
ok(wrote.join() === 'cow-0.json' && readFileSync(join(dest, 'cow-0.json'), 'utf8') === '{"a":1}', 'sync copies store lockstep results: ' + wrote);
ok(syncLockstep(clone, dest).length === 0, 'second sync writes nothing');
// breaks: a publisher without the credit test pushes the doctored ones; a no-op sync copies nothing
{ const s2 = {}; const naive = async () => { for (const f of ['cow-1.json', 'cow-2.json']) await fake(s2)('PUT', `/x/lockstep/${f}`, { content: 'x' }); return { pushed: ['cow-0.json', 'cow-1.json', 'cow-2.json'] }; };
  const n = await naive(); if (n.pushed.join() !== r.pushed.join()) breaks++; else { fails++; console.log('FAIL: naive publisher not caught'); } }
{ const noop = []; if (noop.join() !== wrote.join()) breaks++; else { fails++; console.log('FAIL: noop sync not caught'); } }
{ w('cow-9.json', { salt: 9, inputs: {} }); const r2 = await publishLockstep(dir, root, fake({})); if (r2.refused.includes('cow-9.json')) breaks++; else { fails++; console.log('FAIL: empty inputs accepted'); } }
console.log(`lockstepstorecheck: ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
