#!/usr/bin/env node
// phonehomecheck.mjs - #4979: the phone's Home screen and talk-to-runners logic (tools/phone-web/home.js) plus its wiring in app.js / index.html / build.mjs.
// ANTI-VACUITY: every break below (a wrong threshold, a dropped address check, an unwired tab...) must be caught ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const T = fileURLToPath(new URL('.', import.meta.url));
const rd = (p) => readFileSync(join(T, p), 'utf8');
const SRC = { home: rd('phone-web/home.js'), app: rd('phone-web/app.js'), html: rd('phone-web/index.html'), build: rd('phone-web/build.mjs') };
let N = 0;
function run(S) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const m = { exports: {} }; new Function('module', S.home)(m); const H = m.exports, now = Date.parse('2026-10-10T19:30:00Z'), at = (min) => new Date(now + min * 60e3).toISOString();
  ok([0, 1, 49, 100, 150].map(H.cells).join() === '0,1,10,20,20', 'cells: 0 empty, any use shows one square, 49% = 10, 100% and above = 20');
  ok(H.tone(69) === 'ok' && H.tone(70) === 'warn' && H.tone(89) === 'warn' && H.tone(90) === 'bad' && H.tone(100) === 'bad', 'tone: ok below 70, warn below 90, bad from 90');
  ok(H.resetsIn(at(173), now) === '2h 53m' && H.resetsIn(at(5 * 1440 + 11 * 60 + 5), now) === '5d 11h' && H.resetsIn(at(7), now) === '7m' && H.resetsIn(at(-1), now) === 'resetting now' && H.resetsIn(null, now) === '', 'resetsIn: hours, days, minutes, past, missing');
  ok(H.ago(at(-0.5), now) === 'just now' && H.ago(at(-11), now) === '11 min ago' && H.ago(at(-180), now) === '3 h ago' && H.ago('', now) === 'never', 'ago: just now, minutes, hours, never');
  const usage = JSON.stringify({ at: at(-2), accounts: { default: { ok: false, why: 'no login' }, pro: { ok: true, email: 'p@x', week: { pct: 30, resets_at: at(1000) }, window: { pct: 41, resets_at: at(170) }, readAt: at(-2) }, max: { ok: true, email: 'm@x', week: { pct: 100, resets_at: at(900) }, window: { pct: 0, resets_at: null }, readAt: at(-40) } } });
  const u = H.parseUsage(usage, now);
  ok(u.map((a) => a.key).join() === 'max,pro', 'usage: max then pro; the login-less default account is hidden');
  ok(u[0].week === 100 && u[0].win === 0 && u[0].stale === true && u[1].week === 30 && u[1].win === 41 && u[1].stale === false, 'usage: percentages read, a reading older than 15 minutes is marked stale');
  ok(H.parseUsage('not json', now).length === 0 && H.parseUsage(null, now).length === 0, 'usage: garbage or a missing variable gives an empty list, never a throw');
  ok(H.redChecks([{ title: 'RED mountcheck: full-suite check red on master' }, { title: 'INFRA (severe): x' }, { title: 'RED soundcheck: y', pull_request: {} }, { title: 'RED palettecheck: z' }]).join() === 'mountcheck,palettecheck', 'red checks: only open RED issues, never PRs');
  ok(H.landQueue([{ labels: [{ name: 'land' }] }, { labels: [{ name: 'needs-rebase' }] }, { labels: [] }]).length === 1, 'lander queue: only PRs labelled land');
  ok(JSON.stringify(H.runnerCount({ runners: [{ status: 'online' }, { status: 'offline' }, { status: 'online' }] })) === '{"online":2,"total":3}' && H.runnerCount(undefined) === null, 'runners: online/total, null when unreadable');
  ok(H.headline({ live: 2, red: 10, queue: 4, fill: '0' }) === '2 sessions running, master is red (10), 4 waiting to land, the fill is paused.' && H.headline({ live: 0, red: 0, queue: 0, fill: '3' }) === 'Nothing is running, master is green.' && H.headline({ live: 1, red: null, queue: 0, fill: null }) === '1 session running.', 'headline: plain sentence for red, green, unknown');
  const bus = H.parseBus([
    { id: 1, created_at: at(-9), body: 'to: log\nfrom: brain\n\nbrain: tester mail held' }, { id: 2, created_at: at(-8), body: 'to: log\nfrom: brain\n\nbrain: tester mail held' },
    { id: 3, created_at: at(-5), body: 'to: commander\nfrom: dan\n\nhello there' }, { id: 4, created_at: at(-7), body: '<!-- brain-run 1 worker #5 -->\nTitle' },
    { id: 5, created_at: at(-4), body: 'just a normal issue comment' }, { id: 6, created_at: at(-3), body: '<!-- dan-q 9 -->\nto: dan\nfrom: commander\noptions: A | B' }]);
  ok(bus.length === 2 && bus[0].from === 'dan' && bus[0].text === 'hello there' && bus[1].n === 2, 'bus: only real messages, newest first, the brain\'s repeated line folded into one with a count');
  ok(H.compose('#4979', ' hi\r\nthere ') === 'to: #4979\nfrom: dan\ntype: reply\n\nhi\nthere' && H.compose('Commander', 'x', 'urgent') === 'to: commander\nfrom: dan\ntype: urgent\n\nx', 'compose: the format sessions expect with a type (default reply), address lower-cased, text trimmed');
  ok(H.TYPES.map((t) => t.type).join() === 'reply,urgent,announce,info' && H.compose('all', 'x', 'announce').includes('type: announce') && H.compose('all', 'x', 'shout') === null && H.compose('all', 'x', 'info\nto: dan') === null, 'types: reply, urgent, announce, info; an unknown or injected type gives null');
  ok(H.parseBus([{ id: 1, created_at: at(-1), body: 'to: #5\nfrom: dan\ntype: urgent\n\nstop' }])[0].type === 'urgent' && H.parseBus([{ id: 1, created_at: at(-1), body: 'to: #5\nfrom: dan\ntype: urgent\n\nstop' }])[0].text === 'stop', 'bus: the type is read and kept out of the message text');
  ok(H.compose('commander', '   ') === null && H.compose('', 'x') === null && H.compose('commander\nto: all', 'x') === null && H.compose('a b!', 'x') === null && H.compose('#', 'x') === null, 'compose: empty text, empty or malformed address (no header injection) gives null');
  ok(H.compose('all', 'y'.repeat(5000)).length < 2100, 'compose: a very long message is cut');
  const ad = H.addresses([{ issue: 12, state: 'running', title: 'mobs', name: 'Worker' }, { issue: 12, state: 'running', title: 'mobs' }, { issue: 0, state: 'running' }, { issue: 7, state: 'queued' }]);
  ok(ad.map((a) => a.to).join() === 'commander,fixer,all,#12', 'addresses: commander, fixer, everyone, then each running issue once');
  ok(H.addressForRun({ issue: 5, role: 'worker' }) === '#5' && H.addressForRun({ issue: 0, role: 'commander' }) === 'commander' && H.addressForRun({ issue: 0, role: 'tester' }) === 'all', 'a run\'s message goes to its issue, else its role, else everyone');
  // wiring
  ok(/<script src="home\.js"><\/script>/.test(S.html) && /'home\.js'/.test(S.build), 'index.html loads home.js and the build ships it');
  ok(/<b>Talk<\/b>/.test(S.app) && /Tabs\.barHtml/.test(S.app), 'the tab bar has Home and Talk');
  ok(/h === '#\/bus'/.test(S.app) && /showBus\(\)/.test(S.app), 'app.js routes #/bus to the Talk screen');
  ok(/Message this session/.test(S.app) && /wireTalk\(\);\s*\n\}/.test(S.app), 'a run\'s detail has the message box and wires it');
  ok(/Home\.compose\(to, text, talk\.type\)/.test(S.app) && /data-ty=/.test(S.app) && /\.types button/.test(S.html) && /await postBus\(m\)/.test(S.app), 'sending goes through Home.compose and the bus');
  ok(/\$\{homeHtml\(\)\}\$\{runsHtml\(\)\}/.test(S.app), 'the Home block sits above the runs list');
  ok(/\$\{typePicker\(\)\}<small id="thint">\$\{E\(cur\.hint\)\}/.test(S.app) && /\$\{typePicker\(\)\}<small id="thint">\$\{E\(hint\)\}/.test(S.app), 'the type picker is on the Talk composer and on a run\'s message box');
  ok(/prefers-reduced-motion/.test(S.html) && /focus-visible/.test(S.html), 'reduced motion respected, keyboard focus visible');
  return f;
}
const fails = run(SRC), total = N;
const rep = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error(`no such text in ${k}: ${a}`); return { ...S, [k]: S[k].split(a).join(b) }; };
const BREAKS = [
  ['a used meter can show zero squares', rep('home', 'Math.max(1, Math.round', 'Math.max(0, Math.round')],
  ['warn starts at 80 not 70', rep('home', '>= 70 ? \'warn\'', '>= 80 ? \'warn\'')],
  ['bad starts at 95 not 90', rep('home', '>= 90 ? \'bad\'', '>= 95 ? \'bad\'')],
  ['a stale reading is never marked', rep('home', 'now - read > STALE_MS', 'false')],
  ['the login-less default account is shown', rep('home', "a.key !== 'default' || a.ok", 'true')],
  ['usage not sorted max then pro', rep('home', "const order = ['max', 'pro', 'default'];", "const order = ['default', 'pro', 'max'];")],
  ['reset time shows days as hours', rep('home', 'Math.floor(m / 1440)}d', 'Math.floor(m / 60)}d')],
  ['PRs counted as red checks', rep('home', '(issues || []).filter((i) => !i.pull_request)', '(issues || [])')],
  ['every labelled PR counts as landing', rep('home', "(l.name || l) === 'land'", 'true')],
  ['the headline hides a red master', rep('home', "red === 0 ? 'master is green' : `master is red (${red})`", "'master is green'")],
  ['repeated bus lines are not folded', rep('home', 'p.text === m.text', 'false')],
  ['bus shows run markers and questions', rep('home', "b.startsWith('<!-- brain-run ') || b.startsWith('<!-- dan-q ')", 'false')],
  ['bus not newest first', rep('home', 'ms(y.at) - ms(x.at));\n    const folded', 'ms(x.at) - ms(y.at));\n    const folded')],
  ['message lacks from: dan', rep('home', 'from: dan\\ntype: ${ty}', 'from: phone\\ntype: ${ty}')],
  ['address header injection allowed', rep('home', '/^(#\\d+|[a-z][a-z-]*)$/.test(a)', 'true')],
  ['empty message is sent', rep('home', 'if (!t || ', 'if (')],
  ['message length not capped', rep('home', '.trim().slice(0, MAXLEN)', '.trim()')],
  ['a queued issue is offered as an address', rep('home', "c.issue && c.state === 'running' && ", 'c.issue && ')],
  ['a tester message goes nowhere sensible', rep('home', ": 'all');\n  root.Home", ": '');\n  root.Home")],
  ['home.js not loaded', rep('html', '<script src="home.js"></script>', '')],
  ['build forgets home.js', rep('build', "'home.js', ", '')],
  ['no Talk entry', rep('app', '<b>Talk</b>', '<b>Chat</b>')],
  ['bus route dropped', rep('app', "h === '#/bus'", "h === '#/busx'")],
  ['run detail box not wired', rep('app', '  wireTalk();\n}', '}')],
  ['sending skips compose', rep('app', 'Home.compose(to, text, talk.type)', 'text')],
  ['the type is never sent', rep('app', 'Home.compose(to, text, talk.type)', 'Home.compose(to, text)')],
  ['an unknown type is accepted', rep('home', '|| !TYPES.some((x) => x.type === ty)', '')],
  ['the type header is dropped', rep('home', 'from: dan\\ntype: ${ty}\\n\\n${t}', 'from: dan\\n\\n${t}')],
  ['the type picker is missing', rep('app', '${typePicker()}<small id="thint">${E(cur.hint)}', '<small id="thint">${E(cur.hint)}')],
  ['Home block removed from the home screen', rep('app', '${homeHtml()}${runsHtml()}', '${runsHtml()}')],
  ['motion not reduced', rep('html', 'prefers-reduced-motion', 'prefers-x')],
];
let caught = 0;
for (const [name, mut] of BREAKS) {
  let r; try { r = run(mut(SRC)); } catch (e) { r = [`threw: ${e.message}`]; if (/no such text/.test(e.message)) fails.push(`break "${name}": ${e.message}`); }
  if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
}
console.log(`phonehomecheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !/^break/.test(x)).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
