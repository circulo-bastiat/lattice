#!/usr/bin/env node
// acctfaultcheck.mjs - #10723: the 30 Oct "subscription access disabled" error must park the account; a good run unparks; a no-turn claim is void.
import { readFileSync } from 'node:fs';
import { accountFault, accountDisabled, claimIsVoid } from './brain/acctfault.mjs';
const ERR = 'Your organization has disabled Claude subscription access for Claude Code (usage HTTP 429 UNKNOWN)';
let bad = 0; const t = (ok, m) => { if (!ok) { bad++; console.log('FAIL ' + m); } };
const run = (f) => {
  const j = (x) => JSON.stringify(x);
  t(j(f({ text: ERR, ok: false, turns: 0, account: 'max' }, {})) === j({ park: 'max' }), 'error text parks max');
  t(f({ text: ERR, ok: false, turns: 0, account: 'max' }, { max: '10' })?.hold === true, 'already parked: no second park');
  t(j(f({ text: 'done', ok: true, turns: 12, account: 'max' }, { max: '10' })) === j({ unpark: 'max', restore: '10' }), 'success unparks');
  t(f({ text: 'done', ok: true, turns: 12, account: 'max' }, {}) === null, 'ordinary run: nothing');
  t(f({ text: 'You have 3 tests failing', ok: false, turns: 9, account: 'pro' }, {}) === null, 'ordinary failure: nothing');
};
run(accountFault);
t(claimIsVoid({ turns: 0, code: 1 }) && !claimIsVoid({ turns: 5, code: 1 }) && !claimIsVoid({ turns: 0, code: 0 }), 'void claim');
t(readFileSync(new URL('./brain/launch.mjs', import.meta.url), 'utf8').includes('accountFault('), 'launch.mjs calls accountFault');
// anti-vacuity: broken classifiers must be caught
let caught = 0;
for (const b of [() => () => null, () => (x, p) => accountFault({ ...x, text: '' }, p), () => (x, p) => { const r = accountFault(x, p); return r && r.unpark ? null : r; }, () => (x, p) => { const r = accountFault(x, p); return r && r.park ? { park: 'pro' } : r; }]) {
  const before = bad; run(b()); if (bad > before) caught++; bad = before;
}
t(caught === 4, `breaks caught ${caught}/4`);
console.log(bad ? "FAILED" : `8 assertions, 0 failures, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
