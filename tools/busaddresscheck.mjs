// busaddresscheck.mjs - #7772: every session has its own bus address; a slice mail reaches one instance; a role broadcast needs no answer.
import { addresses as A0, pending as P0 } from './infra/bus.mjs';
import { readFileSync } from 'node:fs';
const roles = JSON.parse(readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8')).roles;
const mk = (to, extra = '') => ({ id: 1, body: `to: ${to}\nfrom: commander\n${extra}\n\nslice` });
function problems(addresses, pending, R) {
  const out = [], ok = (c, m) => { if (!c) out.push(m); };
  const inst = [1, 2, 3].map((k) => addresses({ me: `enlarger-${k}`, sess: `enlarger-${k}` }));
  ok(new Set(inst.map((a) => a[0])).size === 3, 'two instances share an address');
  inst.forEach((a, i) => ok(pending([mk('enlarger-2')], a).length === (i === 1 ? 1 : 0), `slice mail for enlarger-2 reached ${i + 1}`));
  inst.forEach((a, i) => ok(pending([mk('enlarger')], a).length === 0, `broadcast demands a reply from ${i + 1}`));
  ok(pending([mk('enlarger', 'reply: required')], inst[0]).length === 1, 'reply: required broadcast ignored');
  ok(R.enlarger.who === 'enlarger', 'roles.json who must stay the role name');
  ok([1, 2, 3].every((k) => new RegExp(`--to enlarger-${k} `).test(R.commander.prompt)), 'commander prompt does not mail each slice to its own address');
  return out;
}
const real = problems(A0, P0, roles);
real.forEach((m) => console.log('FAIL ' + m));
const clone = () => JSON.parse(JSON.stringify(roles));
const breaks = {
  'instances share one address': () => problems(() => ['enlarger'], P0, roles),
  'slice mail lands on everyone': () => problems(A0, (all, mine) => P0(all.map((c) => ({ ...c, body: c.body.replace('enlarger-2', 'enlarger') })), mine.concat('enlarger')), roles),
  'broadcast demands replies': () => problems((x) => [...A0(x), 'enlarger'], P0, roles).concat(problems((x) => A0(x).filter((m) => m !== 'enlarger'), (all, mine) => P0(all.map((c) => ({ ...c, body: c.body.replace('to: enlarger\n', 'to: enlarger-1\n') })), ['enlarger-1']), roles)),
  'commander still mails shared name': () => { const r = clone(); r.commander.prompt = r.commander.prompt.replace(/--to enlarger-1 /, '--to enlarger '); return problems(A0, P0, r); },
};
let caught = 0;
for (const [k, f] of Object.entries(breaks)) { const c = f().length > 0; if (c) caught++; else console.log(`FAIL break "${k}" not caught`); }
console.log(`busaddresscheck: ${real.length} failures, ${caught} breaks caught`);
process.exit(real.length || caught < Object.keys(breaks).length ? 1 : 0);
