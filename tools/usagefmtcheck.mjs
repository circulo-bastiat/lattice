#!/usr/bin/env node
// usagefmtcheck.mjs - #7659: `go.mjs status` must name the account its usage line belongs to and show EVERY account.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'tools/infra/usagefmt.mjs'), 'utf8');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
// the real shape of usage(): the active account's reading plus `all`, one string per account
const U = { ok: true, account: 'pro', email: 'p@x', week: { pct: 98, resets_at: 'W1' }, window: { pct: 0, resets_at: 'H1' }, at: 'T',
  all: { default: 'no Claude Code login', max: 'm@x week 67% 5h 10%', pro: 'p@x week 98% 5h 0%' } };
const load = async (src) => (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).usageLines;
async function bad(src) {
  const f = await load(src), t = f(U).join('\n'), r = [];
  if (!/account "pro"/.test(t)) r.push('first line does not name its account');
  if (!/week 98%/.test(t.split('\n')[0])) r.push('first line is not the active account\'s week');
  if (!/max: m@x week 67% 5h 10%/.test(t)) r.push('the Max account is not listed with its own week');
  if (!/pro: p@x week 98%/.test(t)) r.push('the Pro account is not listed');
  if (!/UNKNOWN/.test(f(null).join(''))) r.push('no reading is not reported as UNKNOWN');
  return r;
}
const base = await bad(SRC);
base.forEach((m) => fails.push(m)); if (!base.length) pass += 5;
for (const [from, to] of [['account "${u.account}"', 'account'], ['Object.entries(u.all || {})', '[]'], ['`  ${n}: ${s}`', '`  ${s}`'],
  ['week ${u.week?.pct}%', 'week ${u.window?.pct}%'], ["'usage (published file) UNKNOWN - '", "'usage '"]]) {
  breaks++;
  if (!SRC.includes(from)) { fails.push('break target missing: ' + from); continue; }
  if ((await bad(SRC.replace(from, to))).length) { pass++; console.log('   ✓ break caught: ' + from); } else fails.push('break not caught: ' + from);
}
for (const f of fails) console.log('   ✗ ' + f);
console.log(`${fails.length ? 'FAIL' : 'PASS'} usagefmtcheck: ${pass} assertions, ${breaks} breaks caught, ${fails.length} failure(s)`);
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
