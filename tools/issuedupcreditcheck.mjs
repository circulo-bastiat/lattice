#!/usr/bin/env node
// issuedupcreditcheck.mjs - #9070: a CLOSED twin of a lockstep rollout does not block re-filing when lockstep.json has no row for the mob; open twins always refuse.
import { checkNew } from './infra/issuedup.mjs';
const I = (number, title, state, labels = []) => ({ number, title, state, state_reason: state === 'closed' ? 'completed' : null, labels });
const fake = (items) => async (p) => (decodeURIComponent(p).includes('in:title') ? { items } : { total_count: 0, items: [] });
const T = 'G17-L4-strider: lockstep rollout - strider x20 seeds';
const rows = { strider: { pass: true } };
async function run(o) {
  const f = [], ok = (c, m) => { if (!c) f.push(m); };
  const at = (items, r) => checkNew({ title: T, body: 'x' }, fake(items), { rows: r, ...o });
  const closed = [I(1, 'G17-L4-strider: lockstep rollout - strider, 20 seeds', 'closed')], open = [I(2, 'G17-L4-strider: lockstep rollout - strider, 20 seeds', 'open')];
  ok(await at(closed, rows), 'closed twin + mob with a row must be refused');
  ok(await at(closed, {}) === null, 'closed twin + mob without a row must be allowed');
  ok(await at(open, {}), 'open twin must be refused even without a row');
  ok(await at(open, rows), 'open twin + row must be refused');
  return f;
}
const real = await run({});
real.forEach((m) => console.log('FAIL ' + m));
let caught = 0;
for (const [k, o] of Object.entries({ 'credit ignored': { creditFree: false }, 'everything credit-free': { rows: {}, creditFree: true } })) {
  // second break forces empty rows everywhere, which must trip the row-present case
  if ((await run(k === 'credit ignored' ? o : { rows: undefined, ...o })).length) caught++; else console.log('FAIL break not caught: ' + k);
}
console.log(`issuedupcreditcheck: ${real.length} failures, ${caught} breaks caught`);
process.exit(real.length || caught < 2 ? 1 : 0);
