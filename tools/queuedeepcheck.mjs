// tools/queuedeepcheck.mjs - 11 Oct 16:08 + 16:20 (Dan: "the queue should be lengthened substantially instead of every few minutes"; "150 is too much, have it be split to 3 queue
// enlargeners of 50 each, who work together and message each other"). A queue-thin mail makes the commander (50 turns) send THREE slice mails; the brain starts one 50-turn
// enlarger per mail; the enlargers read and post to each other on the bus (to: enlargers, which wakes nobody). Real units only stays. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { routeComment } from './brain/route.mjs';
const ROLES = readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8'), YML = readFileSync(new URL('../.github/workflows/brain.yml', import.meta.url), 'utf8');
const verdict = (txt, yml, route) => {
  const bad = []; let C; try { C = JSON.parse(txt); } catch { return ['roles.json does not parse']; }
  if (!/claimable BY A WORKER/.test(txt)) bad.push('the thin-queue test must read what a WORKER can claim, not the count that includes cap-hidden lockstep issues (#7700)');
  const c = C.roles.commander || {}, e = C.roles.enlarger || {}, cp = c.prompt || '', ep = e.prompt || '';
  if (!/if 40 or more issues are claimable/.test(cp)) bad.push('the queue-thin threshold must be 40 claimable');
  if (!/send exactly three mails/.test(cp) || !/slice 1 of 3/.test(cp) || !/slice 2 of 3/.test(cp) || !/slice 3 of 3/.test(cp) || !/#5043/.test(cp) || !/--to enlarger-1 /.test(cp)) bad.push('the commander must send the three slice mails (G17, G18, #5043 lockstep rollout)');
  if (/split ONE phase|split as many of those phases/.test(cp)) bad.push('the commander must not split phases itself any more');
  if (!/enlargers already on it/.test(cp)) bad.push('the commander must not start a second trio while one is working (to: enlargers under 30 min old)');
  if (c.maxTurns !== 50) bad.push('commander maxTurns must be 50 (Dan: 150 is too much): ' + c.maxTurns);
  if (!(e.maxTurns === 50 && e.model === 'sonnet' && e.who === 'enlarger')) bad.push('the enlarger is a 50-turn sonnet with who=enlarger: ' + JSON.stringify({ t: e.maxTurns, m: e.model, w: e.who }));
  if (!(e.maxPerHour >= 6)) bad.push('maxPerHour must allow two trios an hour');
  if (!/WORK TOGETHER AND MESSAGE EACH OTHER/.test(ep) || !/inbox --all/.test(ep) || !/--to enlargers/.test(ep) || !/never file a unit a peer has filed or announced/.test(ep)) bad.push('the enlarger prompt must have them read and message each other on the bus (to: enlargers)');
  if (!/After every 5 filings/.test(ep) || !/slice done, I can take/.test(ep)) bad.push('enlargers must report every 5 filings and hand over a finished slice');
  if (!/REAL units only/.test(ep) || !/a check that can fail/.test(ep) || !/Never file renames/.test(ep)) bad.push('the real-units-only rule must stay');
  if (C.wake.enlarger !== 'enlarger' || 'enlargers' in C.wake) bad.push('wake: to: enlarger starts an enlarger, to: enlargers (peer chatter) wakes nobody');
  if (!/role == 'worker' \|\| needs\.route\.outputs\.role == 'enlarger' \|\| /.test(yml)) bad.push('brain.yml: enlargers must run side by side (own concurrency group)');
  if (!((yml.match(/options: \[([^\]]*)\]/) || [])[1] || '').split(',').map((x) => x.trim()).includes('enlarger')) bad.push('brain.yml: enlarger missing from the dispatch roles');   // 16 Oct: membership, not the exact list (adding the requests role bounced PR #7694)
  const r1 = route('to: enlarger\nfrom: commander\n\nslice 1 of 3: x', C), r2 = route('to: enlargers\nfrom: enlarger\n\nenlarger 1: filed #1', C);
  if (r1.do !== 'start' || r1.role !== 'enlarger') bad.push('a mail to enlarger must start the enlarger role');
  if (r2.do !== 'none') bad.push('peer chatter to enlargers must wake nobody (it would start runs in a loop)');
  return bad;
};
const BREAKS = [
  ['thin test reads the inflated count', ROLES.replace('claimable BY A WORKER', 'claimable'), YML],
  ['threshold back to 8', ROLES.replace('if 40 or more issues are claimable', 'if 8 or more issues are claimable'), YML],
  ['commander splits phases itself again', ROLES.replace('send exactly three mails', 'split ONE phase'), YML],
  ['commander back to 150 turns', ROLES.replace('"maxTurns": 50, "maxPerHour": 3, "who": "commander"', '"maxTurns": 150, "maxPerHour": 3, "who": "commander"'), YML],
  ['enlarger 150 turns', ROLES.replace('"maxTurns":50,"maxPerHour":9', '"maxTurns":150,"maxPerHour":9'), YML],
  ['enlargers do not talk', ROLES.replace('WORK TOGETHER AND MESSAGE EACH OTHER', 'WORK ALONE'), YML],
  ['no read of the peers first', ROLES.replace('never file a unit a peer has filed or announced', 'file what you like'), YML],
  ['no progress report', ROLES.replace('After every 5 filings', 'At the end'), YML],
  ['busywork allowed', ROLES.replace('Never file renames', 'File renames'), YML],
  ['peer chatter wakes enlargers', ROLES.replace('"enlarger": "enlarger"', '"enlarger": "enlarger", "enlargers": "enlarger"'), YML],
  ['enlargers queue behind each other', ROLES, YML.replace(" || needs.route.outputs.role == 'enlarger'", '')],
  ['no second-trio guard', ROLES.replace('enlargers already on it', 'ok'), YML],
  ['enlarger dropped from the dispatch roles', ROLES, YML.replace(', enlarger]', ']')],
];
const real = verdict(ROLES, YML, routeComment); let caught = 0;
for (const [n, t, y] of BREAKS) { if (verdict(t, y, routeComment).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`queuedeepcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
