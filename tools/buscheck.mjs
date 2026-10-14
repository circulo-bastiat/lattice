// tools/buscheck.mjs - the session bus addresses the right sessions (#63). Pure, no GitHub: tools/infra/bus.mjs.
// Guards the 28 Sept miss: the loop held an issue, so mail to `loop` never reached it, and Dan's message sat unread.
import { addresses, pending, news, typeOf } from './infra/bus.mjs';

const msg = (id, to, from, body = 'hi', re = null) => ({ id, body: `to: ${to}\nfrom: ${from}\n${re ? `re: ${re}\n` : ''}\n${body}` });
const loopOrch = { me: 'work/58-infra-x', role: 'loop-worker', sess: 'loop' };         // the orchestrator, holding #58
const worker = { me: 'work/52-kw-48-x', role: 'loop-worker', sess: 'loop' };           // a Workflow worker, same HOME
const commander = { me: 'commander', sess: 'commander' };

function verdicts(addr = addresses, pend = pending) {
  const bus = [msg(1, 'loop', 'dan', 'Dan says hi'), msg(2, '#52', 'commander'), msg(3, 'all', 'commander', 'news')];
  const out = [];
  const ok = (cond, what) => { if (!cond) out.push(what); };
  const P = (who, b = bus) => pend(b, addr(who)).map((c) => c.id);
  ok(P(loopOrch).includes(1), 'loop orchestrator holding an issue must get mail to `loop`');
  ok(P(worker).includes(1), 'a loop worker must get mail to `loop` (the orchestrator is idle during its Workflow)');
  ok(P(worker).includes(2), 'a worker must get mail to its own #N');
  ok(!P(commander).includes(1), 'the commander must NOT get mail to `loop`');
  ok(!P(loopOrch).includes(3), '`to: all` without reply: required is news, not a gate');
  const answered = [...bus, msg(4, 'commander', 'work/52-kw-48-x', 'yes', '1')];
  ok(!P(loopOrch, answered).includes(1), 'one reply to a `loop` message answers it for the whole loop');
  ok(P(worker, [msg(5, 'sessions', 'commander'), msg(6, 'commander', 'work/58-infra-x', 'ok', '5')]).includes(5),
    'a reply by one session must NOT answer `sessions` mail for the others');
  const T = (type, to = 'commander', extra = '') => ({ id: 20 + type.length, body: `to: ${to}\nfrom: dan\ntype: ${type}\n${extra}\nbody` });
  ok(P(commander, [T('reply')]).length === 1 && P(commander, [T('urgent')]).length === 1, 'type reply and urgent to a session need its answer');
  ok(P(commander, [T('announce')]).length === 0 && P(commander, [T('info')]).length === 0, 'type announce and info never need an answer');
  ok(P(commander, [T('reply', 'all')]).length === 1 && P(commander, [T('urgent', 'all')]).length === 1 && P(commander, [T('announce', 'all')]).length === 0, '`to: all` with type reply or urgent gates everyone; announce does not');
  ok(news([T('announce')], addresses(commander)).length === 1 && news([T('announce', 'all')], addresses(commander)).length === 1 && news([T('announce')], addresses(commander), [T('announce').id]).length === 0, 'announcements reach the session (also via all) once, then are not shown again');
  ok(news([T('announce', '#9')], addresses(commander)).length === 0 && news([T('info')], addresses(commander)).length === 0 && news([T('reply')], addresses(commander)).length === 0, 'news is only announcements addressed to this session');
  ok(typeOf('to: x\ntype: URGENT\n') === 'urgent' && typeOf('to: x\ntype: shout\n') === '' && typeOf('to: x') === '', 'type is read case-insensitively; unknown types count as none');
  return out;
}

const real = verdicts();
if (real.length) { console.error('FAIL buscheck:\n  ' + real.join('\n  ')); process.exit(1); }

// anti-vacuity: each break reintroduces a real failure mode and must be caught
const breaks = [
  ['session role dropped while holding an issue', (w) => addresses({ ...w, sess: w.me === 'commander' ? w.sess : null })],
  ['everyone answers to loop', (w) => [...addresses(w), 'loop']],
];
let caught = 0;
const report = (name, hit) => { if (hit) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.error(`  ✗ break NOT caught: ${name}`); };
for (const [name, addr] of breaks) report(name, verdicts(addr).length > 0);
const noGroup = (all, mine) => pending(all.filter((c) => !/^re: 1$/m.test(c.body)), mine);
report('group reply ignored', verdicts(addresses, noGroup).length > 0);
const typesIgnored = (all, mine) => pending(all.map((c) => ({ ...c, body: c.body.replace(/^type:.*$/m, '') })), mine);
report('message types ignored', verdicts(addresses, typesIgnored).length > 0);
const total = breaks.length + 2;
console.log(`buscheck: 13 assertions, 0 failures, ${caught} breaks caught (of ${total})`);
process.exit(caught === total ? 0 : 1);
