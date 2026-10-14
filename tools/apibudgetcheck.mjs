#!/usr/bin/env node
// apibudgetcheck.mjs - the GitHub API budget of ONE working session (30 Sept). Every worker, runner, the lander, the
// brain and Dan's phone share one PAT: 5000 REST calls an hour. The mail hook (every tool call), the build/test gate
// and go.mjs each re-read the whole bus, ~9 calls every 30 s per worker; 10 workers emptied the quota in 16 min at
// 02:30-02:46Z and every session died on 403s. This runs go.mjs `pending` (the hook) and `gatecheck` (the gate) 10 times
// each against a stubbed GitHub that counts calls, and holds them to a budget. It also checks mail is still SEEN.
// ANTI-VACUITY: the same runs with the caches thrown away each time must blow the budget ("<n> breaks caught").
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GO = fileURLToPath(new URL('./go.mjs', import.meta.url));
const T = mkdtempSync(join(tmpdir(), 'apibudget-'));
const COUNT = join(T, 'calls.txt'), STUB = join(T, 'stub.mjs'), WS = join(T, 'ws');
mkdirSync(join(WS, '.git'), { recursive: true });
writeFileSync(join(WS, '.git', 'mclite-claim'), 'work/7-some-issue');
writeFileSync(STUB, `import { appendFileSync } from 'node:fs';
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (u) => {
  u = String(u); appendFileSync(${JSON.stringify(COUNT)}, u + '\\n');
  if (/labels=bus/.test(u)) return J([{ number: 53, comments: 10 }]);
  if (/issues\\/53\\/comments/.test(u)) return J([{ id: 101, body: 'to: #7\\nfrom: commander\\n\\nwhere are you', created_at: new Date().toISOString() }]);
  if (/issues\\/7$/.test(u)) return J({ state: 'open' });
  return J({ message: 'Not Found' }, 404);
};`);
const env = { ...process.env, GH_TOKEN: 'stub', MCLITE_GATE: 'off', NODE_OPTIONS: `--import ${pathToFileURL(STUB).href}` };
const calls = () => (existsSync(COUNT) ? readFileSync(COUNT, 'utf8').split('\n').filter(Boolean).length : 0);
const go = (...a) => spawnSync(process.execPath, [GO, ...a, '--dir', WS], { env, encoding: 'utf8', timeout: 30e3 });
const wipe = () => { for (const f of ['mclite-mail.json', 'mclite-yield.json']) rmSync(join(WS, '.git', f), { force: true }); };

function scenario(breakCaches) {
  rmSync(COUNT, { force: true }); wipe();
  let seen = true;
  for (let i = 0; i < 10; i++) { if (breakCaches) wipe(); const r = go('pending'); if (!/where are you/.test(r.stdout)) seen = false; }
  for (let i = 0; i < 10; i++) { if (breakCaches) wipe(); go('gatecheck'); }
  return { n: calls(), seen };
}
const fails = [];
const BUDGET = 4;   // bus number + one comments page for the first read; the yield check's 2 reads; nothing more
const t0 = Date.now(), ok = scenario(false), el = Date.now() - t0;
// a loaded box can stretch the 20 runs past the 60 s mail TTL / 3 min yield TTL: each expiry legitimately costs 1 / 2 more calls
const allowed = BUDGET + Math.floor(el / 60e3) + 2 * Math.floor(el / 180e3);
if (!ok.seen) fails.push('a message to this session was not reported by `go.mjs pending`');
if (ok.n > allowed) fails.push(`20 hook/gate runs in ${Math.round(el / 1e3)} s made ${ok.n} GitHub calls (budget ${allowed})`);
let caught = 0;
const br = scenario(true);
if (br.n > BUDGET) { caught++; console.log(`  ✓ break caught: caches thrown away (${br.n} calls)`); } else fails.push(`break NOT caught: with no caches the runs made only ${br.n} calls`);
rmSync(T, { recursive: true, force: true });
console.log(`apibudgetcheck: ${ok.n} calls for 20 hook/gate runs (budget ${BUDGET}); without caches ${br.n}`);
console.log(`apibudgetcheck: ${caught} breaks caught (of 1)`);
for (const f of fails) console.log(`  ✗ ${f}`);
console.log(` assertions passed .... ${2 - fails.filter((f) => !f.startsWith('break')).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
