#!/usr/bin/env node
// browserslotscheck.mjs - #3921: the host browser budget. Cap holds across concurrent opens, RAM floor waits then fails with
// the host-load signature, dead/overdue owners are reaped, a browser without a slot is never touched, priority is set.
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHostLoad } from './infra/hostload.mjs';

process.env.MCLITE_BROWSER_DIR = mkdtempSync(join(tmpdir(), 'bslots-'));
const B = await import('./infra/browserslots.mjs');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { breaks++; ok(c, "break NOT caught: " + m); if (c) console.log("  ✓ break caught: " + m); };
const clear = () => { for (const f of B.slots()) B.reap({ isAlive: () => false, kill: () => {} }); };

// 1. cap holds at 3 across 10 concurrent opens; each holds its slot 60 ms
const run = async (cap) => {
  let live = 0, peak = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    const rel = await B.acquire({ cap, floorGB: 0, poll: 5, waitMs: 20000 });
    live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 60)); live--; rel();
  }));
  return peak;
};
ok(await run(3) <= 3, 'more than 3 browsers at once');
brk(await run(10) > 3, 'a cap of 10 is not seen as exceeding 3 (the peak counter is blind)');
ok(B.slots().length === 0, 'slots leaked after release');

// 2. RAM floor: impossible floor -> times out with the host-load signature
let err = '';
await B.acquire({ cap: 3, floorGB: 1e9, poll: 5, waitMs: 80 }).catch((e) => { err = e.message; });
ok(isHostLoad(err), 'the RAM-floor timeout lacks the host-load signature: ' + err);
brk(!isHostLoad('plain failure'), 'a plain message is taken for host load');
ok(B.slots().length === 0, 'a failed wait left a slot');

// 3. reaper: dead owner reaped, live owner kept, an unslotted browser never touched
const killed = [];
const put = (i, o) => writeFileSync(join(B.DIR, 'slot' + i), JSON.stringify(o));
const now = Date.now();
put(0, { owner: 111, browser: 1001, start: now });                    // dead owner
put(1, { owner: process.pid, browser: 1002, start: now });            // live, young
put(2, { owner: process.pid, browser: 1003, start: now - 16 * 60e3 }); // live but older than 15 min
const n = B.reap({ now, kill: (p) => killed.push(p), isAlive: (p) => p === process.pid });
ok(n === 2 && killed.join() === '1001,1003', 'reap killed ' + killed + ' (want 1001,1003)');
ok(!existsSync(join(B.DIR, 'slot0')) && existsSync(join(B.DIR, 'slot1')) && !existsSync(join(B.DIR, 'slot2')), 'slot files after reap');
ok(!killed.includes(1002) && !killed.includes(4242), 'a live or unslotted browser was killed');
brk(B.reap({ now, kill: (p) => killed.push(p), isAlive: () => false }) === 1 && killed.includes(1002), 'a dead owner is not reaped (reaper blind)');

// 4. priority: suite/full/land set below-normal; cdp passes the slot to every browser
for (const f of ['suite.mjs', 'infra/full.mjs', 'infra/land.mjs']) ok(/setPriority\(/.test(readFileSync(new URL('./' + f, import.meta.url), 'utf8')), f + ' does not set priority');
brk(!/setPriority\(/.test('const x = 1;'), 'a file without setPriority passes the priority scan');
ok(/await acquire\(\)/.test(readFileSync(new URL('./cdp.mjs', import.meta.url), 'utf8')), 'cdp.open does not take a slot');
brk(!/await acquire\(\)/.test('open(){}'), 'a cdp without acquire passes the scan');
ok(/host:/.test(B.evidence(0)), 'evidence line');

console.log(`browserslotscheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
