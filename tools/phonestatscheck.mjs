#!/usr/bin/env node
// phonestatscheck.mjs - Dan, 10 Oct: the phone app shows each worker's MODEL and a finished run's tokens/USD/turns, and has a Stats tab.
// Node only (no browser): the pure parsing in phone-web/runs.js against the REAL bus line the brain writes, plus source checks on app.js/index.html/launch.mjs.
// ANTI-VACUITY: every break below must be caught ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const T = fileURLToPath(new URL('.', import.meta.url)), rd = (p) => readFileSync(join(T, p), 'utf8');
const SRC = { runs: rd('phone-web/runs.js'), app: rd('phone-web/app.js'), html: rd('phone-web/index.html'), tabs: rd('phone-web/tabs.js'), launch: rd('brain/launch.mjs'), roles: rd('brain/roles.json'), deploy: rd('phone-web/deploy.mjs'), cmd: rd('../DEPLOY-PHONE.cmd') };
const NOW = Date.parse('2026-10-10T23:50:00Z'), at = (m) => new Date(NOW - m * 60e3).toISOString();
// the real line the brain wrote at 23:28Z (Haiku, 17 turns) and the Sonnet one at 23:02Z, plus a failed run with no usage bracket
const L = (t) => `to: log\nfrom: brain\n\n${t}`;
const CM = [
  { created_at: at(22), body: L('brain: worker run ended (ok, 17 turns, pro) [usage claude-haiku-5-5 in 30 out 10164 cw 38875 cr 559669 $0.37; total $0.37; 1 min; pro 5h 24->24%, week 40->40% (reading 1 min old); ; trim tools=Bash,Read,Edit,Write; plugins ponytail=off] - PR #4996 is re-queued') },
  { created_at: at(48), body: L('brain: worker run ended (ok, 3 turns, pro) [usage claude-sonnet-5-5 in 6 out 528 cw 17356 cr 27067 $0.08; total $0.08; 0 min; pro 5h 20->20%, week 39->39% (reading 3 min old); ; trim tools=Bash,Read,Edit,Write; plugins ponytail=off] - blazeghastcheck is green') },
  { created_at: at(5), body: L('brain: fixer run ended (exit 1, 2 turns, pro) - could not start') },
  { created_at: at(60 * 30), body: L('brain: worker run ended (ok, 9 turns, max) [usage claude-sonnet-5-5 in 1 out 1 cw 1 cr 1 $9.99; total $9.99; 1 min; max 5h 1->2%] - too old for 24 h') },
];
function logic(S, d) {
  const f = [], ok = (c, m) => { if (!c) f.push(m); };
  writeFileSync(join(d, 'runs.cjs'), S.runs); const Runs = createRequire(import.meta.url)(join(d, 'runs.cjs'));
  const day = Runs.ended(CM, NOW, 24 * 3600e3), hour = Runs.ended(CM, NOW), h = day.find((e) => e.model === 'claude-haiku-5-5');
  ok(day.length === 3 && hour.length === 3, `ended(): 3 runs in range, got ${day.length}/${hour.length}`);
  ok(Runs.ended(CM, NOW, 90 * 60e3).length === 3 && Runs.ended(CM, NOW, 10 * 60e3).length === 1, 'ended() honours its window');
  ok(h && h.tin === 30 && h.tout === 10164 && h.cw === 38875 && h.cr === 559669 && h.cost === 0.37 && h.turns === 17 && h.acct === 'pro' && h.from5h === 24 && h.to5h === 24 && h.minutes === 1, 'the Haiku line is parsed to model/tokens/USD/turns/account/5h');
  ok(h && h.text === 'PR #4996 is re-queued' && h.ok === true, 'the human text after the bracket is kept');
  const fx = day.find((e) => e.role === 'fixer'); ok(fx && fx.ok === false && fx.cost === 0 && fx.turns === 2 && fx.model === '', 'a run with no usage bracket still lists, with zero numbers');
  const st = Runs.stats(day);
  ok(st.runs === 3 && st.ok === 2 && Math.abs(st.cost - 0.45) < 1e-9 && st.turns === 22, 'stats() totals');
  ok(st.byModel['claude-haiku-5-5'].runs === 1 && st.byModel['claude-sonnet-5-5'].runs === 1 && st.byModel.unknown.runs === 1, 'stats() groups by model (unknown for no numbers)');
  const sj = Runs.stats(day, true);   // #5031: junk (no numbers, or <7 turns and <$0.10) is left out of totals, by-model and by-role, and reported
  ok(sj.runs === 1 && sj.byModel['claude-haiku-5-5'].runs === 1 && !sj.byModel.unknown && !sj.byModel['claude-sonnet-5-5'] && sj.junk.runs === 2 && Math.abs(sj.junk.cost - 0.08) < 1e-9, 'stats(list, true) leaves junk runs out and counts them');
  ok(Runs.stats(day).junk.runs === 0, 'stats(list) without the flag counts every run, as before');
  ok(st.byRole.worker.runs === 2 && st.byRole.fixer.runs === 1, 'stats() groups by role');
  ok(Math.abs(st.byModel['claude-haiku-5-5'].perTurn - 0.37 / 17) < 1e-9 && st.tokens === 30 + 10164 + 38875 + 559669 + 6 + 528 + 17356 + 27067, 'stats() per-turn and token sums');
  ok(Runs.fmtTok(559669) === '560k' && Runs.fmtTok(1234) === '1.2k' && Runs.fmtTok(2300000) === '2.3M' && Runs.fmtTok(42) === '42' && Runs.fmtTok(0) === '0', 'fmtTok');
  ok(Runs.modelName('claude-haiku-5-5') === 'Haiku 5.5' && Runs.modelName('claude-sonnet-5-5') === 'Sonnet 5.5' && Runs.modelName('') === '' && Runs.modelName('gpt-x') === 'gpt-x', 'modelName');
  const mb = Runs.markerBody(9, 'worker', 4, 'T', 'claude-haiku-5-5'), mk = Runs.parseMarkers([{ body: mb }])['9'];
  ok(mb === '<!-- brain-run 9 worker #4 model=claude-haiku-5-5 -->\nT' && mk && mk.model === 'claude-haiku-5-5' && mk.issue === 4 && mk.title === 'T', 'the marker round-trips the model');
  const old = Runs.parseMarkers([{ body: '<!-- brain-run 8 worker #3 -->\nOld' }])['8']; ok(old && old.model === '' && old.title === 'Old', 'an old marker without a model still parses');
  const mt = Runs.markerBody(11, 'tester', 0, 'test slot: mob cow', 'claude-sonnet-5-5'), tk = Runs.parseMarkers([{ body: mt }])['11'];
  ok(mt === '<!-- brain-run 11 tester model=claude-sonnet-5-5 -->\ntest slot: mob cow' && tk && tk.role === 'tester' && tk.issue === 0 && tk.model === 'claude-sonnet-5-5' && tk.title === 'test slot: mob cow', 'a tester/fixer marker (no issue) round-trips with its model');
  const cs = Runs.cards([{ id: 9, display_title: 'brain worker @pro', run_started_at: at(2) }], [], [], { 9: mk });
  ok(cs[0] && cs[0].model === 'claude-haiku-5-5', 'a running card carries its model');
  return f;
}
function source(S) {
  const f = [], ok = (c, m) => { if (!c) f.push(m); };
  ok(/worker #\$\{issueNo\} model=\$\{MODEL\} -->/.test(S.launch), 'launch.mjs does not put the model in the brain-run marker');
  ok(/Runs\.modelName\(c\.model\)/.test(S.app) && (S.app.match(/Runs\.modelName\(c\.model\)/g) || []).length >= 2, 'run cards (home + detail) do not show the model');
  ok(/Tokens and cost appear when this run ends/.test(S.app), 'a live card does not say tokens arrive at the end');
  ok(/\$\{endStat\(d\)\}/.test(S.app) && /Runs\.fmtTok\(d\.tin \+ d\.tout \+ d\.cw \+ d\.cr\)/.test(S.app) && /d\.cost\.toFixed\(2\)/.test(S.app), 'finished runs do not show tokens + USD');
  ok(/Runs\.stats\(stat\.list, true\)/.test(S.app) && /small runs/.test(S.app), 'the Stats tab counts junk runs (#5031)');
  ok(/Runs\.ended\(out, Date\.now\(\), 24 \* 3600e3\)/.test(S.app), 'the Stats tab does not read 24 h of run-ended lines');
  ok(/h === '#\/stats'\) \{ route\.at = 'stats'/.test(S.app), 'no #/stats route');
  ok(/id: 'stats', label: 'Runs'[^\n]*hash: '#\/stats'/.test(S.tabs), 'no Stats tab in the nav');
  ok(/<h2>By model<\/h2>/.test(S.app) && /<h2>By kind of run<\/h2>/.test(S.app) && /<h2>Usage<\/h2>/.test(S.app) && /<h2>Project<\/h2>/.test(S.app), 'the Stats tab lacks a section');
  ok(/meter\('Week'/.test(S.app.slice(S.app.indexOf('function drawStats'))), 'the Stats tab has no usage meters');
  ok((S.app.match(/<button class="alt rf" id="rf">/g) || []).length === 2 && /id="rf" style="margin:0 8px 6px 0"/.test(S.app), 'Home, Stats and Talk each have a Refresh button');
  ok(/function wireRefresh\(fn\)/.test(S.app) && (S.app.match(/wireRefresh\(async/g) || []).length === 3, 'each Refresh button is wired');
  ok(/wireRefresh\(async \(\) => \{ await load\(\); await loadHome\(true\)/.test(S.app) && /wireRefresh\(async \(\) => \{ stat\.err = ''; try \{ await loadStats\(\)/.test(S.app) && /wireRefresh\(async \(\) => \{ await load\(\); await busFeed\(\)/.test(S.app), 'a Refresh button does not reload its own screen');
  ok(/else if \(role !== 'worker' && CFG\.markerIssue && process\.env\.GITHUB_RUN_ID\)/.test(S.launch) && /\/issues\/\$\{CFG\.markerIssue\}\/comments/.test(S.launch) && /brain-run \$\{process\.env\.GITHUB_RUN_ID\} \$\{role\} model=\$\{MODEL\} -->/.test(S.launch), 'launch.mjs does not mark tester/fixer/commander/chore runs on the housekeeping issue');
  ok(/git', \['push', '-q', '-f', `https:\/\/x-access-token:\$\{token\(\)\}@github\.com\/\$\{PAGES\}\.git`, 'main'\]/.test(S.deploy) && /PAGES = 'owner\/mclite-phone'/.test(S.deploy) && /'FETCH_HEAD', 'tools\/phone-web'/.test(S.deploy), 'deploy.mjs does not publish the landed master to the mclite-phone repo');
  ok(/x-access-token:\[\^@\]\+@/.test(S.deploy) && /--dry/.test(S.deploy), 'deploy.mjs may print the token or has no --dry');
  ok(/node tools\\phone-web\\deploy\.mjs/.test(S.cmd), 'DEPLOY-PHONE.cmd does not run deploy.mjs');
  ok(/"markerIssue": [1-9]\d*,/.test(S.roles), 'roles.json has no markerIssue');
  ok(/\['worker', 'tester', 'fixer', 'commander', 'chore'\]\.includes\(Runs\.roleOf\(x\)\)/.test(S.app), 'the app only looks up markers for workers');
  ok((S.app.match(/E\(c\.title \|\| c\.runTitle\)/g) || []).length === 2, 'a card without an issue does not show its marker title');
  return f;
}
const run = (S) => { const d = mkdtempSync(join(tmpdir(), 'pstat-')); try { return [...logic(S, d), ...source(S)]; } catch (e) { return [`threw: ${e.message}`]; } finally { rmSync(d, { recursive: true, force: true }); } };
const BREAKS = [
  ['junk runs are counted (#5031)', (S) => ({ ...S, runs: S.runs.replace('if (dropJunk && isJunk(e))', 'if (false && isJunk(e))') })],
  ['the Stats tab does not drop junk (#5031)', (S) => ({ ...S, app: S.app.replace('Runs.stats(stat.list, true)', 'Runs.stats(stat.list)') })],
  ['ended ignores the window', (S) => ({ ...S, runs: S.runs.replace('const out = [], span = win || 3600e3;', 'const out = [], span = 3600e3;') })],
  ['usage bracket not parsed', (S) => ({ ...S, runs: S.runs.replace('usage (\\S+) in', 'usageX (\\S+) in') })],
  ['cache read dropped from tokens', (S) => ({ ...S, runs: S.runs.replace('const tok = e.tin + e.tout + e.cw + e.cr;', 'const tok = e.tin + e.tout + e.cw;') })],
  ['perTurn removed', (S) => ({ ...S, runs: S.runs.replace('g.perTurn = g.turns ? g.cost / g.turns : 0;', 'g.perTurn = 0;') })],
  ['stats not grouped by model', (S) => ({ ...S, runs: S.runs.replace("byModel[e.model || 'unknown'] || (byModel[e.model || 'unknown'] = blank())", "byModel.all || (byModel.all = blank())") })],
  ['marker drops the model', (S) => ({ ...S, runs: S.runs.replace("model: m[4] || '', ", '') })],
  ['markerBody drops the model', (S) => ({ ...S, runs: S.runs.replace("${model ? ` model=${model}` : ''}", '') })],
  ['card drops the model', (S) => ({ ...S, runs: S.runs.replace("model: mark ? mark.model || '' : '',", '') })],
  ['fmtTok broken', (S) => ({ ...S, runs: S.runs.replace('n >= 1e4 ? `${Math.round(n / 1e3)}k`', 'n >= 1e4 ? `${n}`') })],
  ['launcher marker has no model', (S) => ({ ...S, launch: S.launch.replace(' model=${MODEL} -->', ' -->') })],
  ['cards show no model', (S) => ({ ...S, app: S.app.replace(/\$\{c\.model \? `<span class="acct model">[^`]*`[^}]*\}/g, '') })],
  ['no live-card note', (S) => ({ ...S, app: S.app.replace('Tokens and cost appear when this run ends', 'x') })],
  ['finished runs show no numbers', (S) => ({ ...S, app: S.app.replace('${endStat(d)}', '') })],
  ['stats reads one hour', (S) => ({ ...S, app: S.app.replace('Runs.ended(out, Date.now(), 24 * 3600e3)', 'Runs.ended(out, Date.now())') })],
  ['no stats route', (S) => ({ ...S, app: S.app.replace("h === '#/stats'", "h === '#/statsx'") })],
  ['no stats tab', (S) => ({ ...S, tabs: S.tabs.replace("hash: '#/stats'", "hash: '#/x'") })],
  ['home has no refresh button', (S) => ({ ...S, app: S.app.replace('<button class="alt rf" id="rf">&#8635; Refresh</button><button class="alt rf" id="gear"', '<button class="alt rf" id="gear"') })],
  ['talk refresh unwired', (S) => ({ ...S, app: S.app.replace('wireTalk(); wireRefresh(async () => { await load(); await busFeed(); drawBus(); });', 'wireTalk();') })],
  ['stats refresh does not reload', (S) => ({ ...S, app: S.app.replace("wireRefresh(async () => { stat.err = ''; try { await loadStats(); }", "wireRefresh(async () => { stat.err = ''; try { await 0; }") })],
  ['launcher marks only workers', (S) => ({ ...S, launch: S.launch.replace("else if (role !== 'worker' && CFG.markerIssue", "else if (false && CFG.markerIssue") })],
  ['roles.json has no marker issue', (S) => ({ ...S, roles: S.roles.replace('"markerIssue": 5003,', '') })],
  ['app looks up worker markers only', (S) => ({ ...S, app: S.app.replace("['worker', 'tester', 'fixer', 'commander', 'chore'].includes(Runs.roleOf(x))", "Runs.roleOf(x) === 'worker'") })],
  ['issue-less marker not parsed', (S) => ({ ...S, runs: S.runs.replace("(\\w[\\w-]*)(?: #(\\d+))?(?: model=", "(\\w[\\w-]*) #(\\d+)(?: model=") })],
  ['title ignored without an issue', (S) => ({ ...S, app: S.app.split('E(c.title || c.runTitle)').join('E(c.runTitle)') })],
  ['deploy pushes elsewhere', (S) => ({ ...S, deploy: S.deploy.replace("PAGES = 'owner/mclite-phone'", "PAGES = 'owner/mclite'") })],
  ['deploy builds a stale checkout', (S) => ({ ...S, deploy: S.deploy.replace("'FETCH_HEAD', 'tools/phone-web'", "'HEAD', 'tools/phone-web'") })],
  ['deploy leaks the token', (S) => ({ ...S, deploy: S.deploy.replace('/x-access-token:[^@]+@/g', '/zzz/g') })],
  ['cmd does not deploy', (S) => ({ ...S, cmd: S.cmd.replace('deploy.mjs', 'x.mjs') })],
  ['no by-model section', (S) => ({ ...S, app: S.app.replace('<h2>By model</h2>', '') })],
  ['no usage meters on stats', (S) => ({ ...S, app: S.app.replace("${meter('Week', a.week, a.weekResets ? 'resets in ' + Home.resetsIn(a.weekResets, now) : '')}${meter('5 hours', a.win, a.winResets ? 'resets in ' + Home.resetsIn(a.winResets, now) : '')}</div>`).join('') : '<p class=\"empty\">Usage is not available yet.</p>';\n  const red = home.reds ? home.reds.length : '?'", "</div>`).join('') : '';\n  const red = home.reds ? home.reds.length : '?'") })],
];
const real = run(SRC); let caught = 0;
for (const [n, mk] of BREAKS) { const m = mk(SRC); const changed = JSON.stringify(m) !== JSON.stringify(SRC); if (changed && run(m).length) caught++; else console.log(changed ? ' NOT CAUGHT:' : ' NO-OP BREAK:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`phonestatscheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
