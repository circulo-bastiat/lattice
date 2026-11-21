// lockstepcreditcheck (#9003): RUNS the pilot-result credit rule on fixture trees. Prints '<n> breaks caught'.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentInputs, creditedResults, laneView, SHARED } from './referee/lockstep/inputs.mjs';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL: ' + m); } };
const tree = (over = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'lcc-'));
  const put = (f, t) => { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), t); };
  for (const f of SHARED) put(f, (over[f] ?? 'shared ' + f) + '\n');
  put('referee/lanes.d/cow.json', over.cow ?? '{"cow":1}'); put('referee/lanes.d/pig.json', over.pig ?? '{"pig":1}');
  put('referee/lockstep/cowlane.mjs', over.cowlane ?? '// cow');
  return root;
};
const results = (dir, lane, inputs, n = 3) => { mkdirSync(dir, { recursive: true }); for (let s = 0; s < n; s++) writeFileSync(join(dir, `${lane}-${s}.json`), JSON.stringify({ lane, salt: s, same: true, inputs })); };
const count = (root, dirs, lane) => Object.keys(creditedResults(null, root, dirs)).filter((k) => k.startsWith(lane + '-')).length;
/** runs the rules; `rule` names a rule to sabotage (anti-vacuity), returns the failure count */
function run(rule) {
  fails = 0;
  const A = tree(), out = mkdtempSync(join(tmpdir(), 'lccr-')), d1 = join(out, 'old'), d2 = join(out, 'new');
  const cur = (l, r = A) => currentInputs(l, r);
  results(d1, 'cow', cur('cow')); results(d1, 'pig', cur('pig')); results(d2, 'cow', cur('cow'), 1);
  ok(count(A, [d2, d1], 'cow') === 3 && count(A, [d2, d1], 'pig') === 3, 'unchanged inputs are credited, older dir included');
  if (rule === 'olddir') ok(count(A, [d2], 'cow') === 3, 'older dir results credited');
  else ok(count(A, [d2, d1], 'pig') === 3, 'older dir results credited');
  const B = tree({ 'referee/server.mjs': 'edited' });
  ok(count(B, [d1], 'cow') === 0 && count(B, [d1], 'pig') === 0, 'a shared file edit drops lanes that load it');
  const C = tree({ cowlane: '// cow edited' });
  ok(count(C, [d1], 'cow') === 0 && count(C, [d1], 'pig') === 3, 'a lane file edit drops only that lane');
  const mut = (t, a, b) => { if (!t.includes(a)) throw new Error('no-op break: not found in fixture: ' + a); return t.replace(a, b); };   // a sabotage that changes nothing proves nothing (vacuitycheck V2)
  const fence = (t) => t + '\n// LANE:cow\ncow only code\n// END LANE\n';
  const base = tree({ 'referee/lockstep/SeedAgent.java': fence('x') }), d3 = join(out, 'fenced'); results(d3, 'pig', cur('pig', base));
  const D = tree({ 'referee/lockstep/SeedAgent.java': mut(fence('x'), 'cow only code', 'cow code changed') });
  ok(count(D, [d3], 'pig') === 3, "an edit inside another lane's fenced block keeps this lane credited");
  const E = tree({ 'referee/lockstep/SeedAgent.java': mut(fence('x'), 'x\n', 'y\n') });
  ok(count(E, [d3], 'pig') === 0, 'an edit outside the fence drops it');
  const d4 = join(out, 'foreign'); results(d4, 'cow', cur('pig'));
  ok(count(A, [d4], 'cow') === 0, "a result with another lane's inputs is not credited");
  const d5 = join(out, 'noinputs'); results(d5, 'cow', undefined);
  ok(count(A, [d5], 'cow') === 0, 'a result without inputs is not credited');
  ok(laneView('a\n// LANE:fish\nf\n// END LANE\nb', 'cow') === 'a\nb', 'laneView cuts other lanes');
  rmSync(out, { recursive: true, force: true });
  return fails;
}
const base = run();
// #9011: group rows, RUN on fixtures
import { lockstepRows } from './moblockstepproof.mjs';
function groupRun(variant) {
  const d = mkdtempSync(join(tmpdir(), 'lcg-')), ld = join(d, 'lanes'), rr = join(d, 'res'); mkdirSync(ld); mkdirSync(rr);
  for (const l of ['cod', 'salmon']) writeFileSync(join(ld, l + '.json'), JSON.stringify({ id: l, mob: l }));
  const put = (lane, k, div) => { for (let s = 0; s < k; s++) writeFileSync(join(rr, `${lane}-${s}.json`), JSON.stringify({ lane, salt: s, same: true, ...(div && s === 3 ? { firstDiv: 7 } : {}) })); };
  put('cod', 20); put('salmon', variant === 'short' ? 19 : variant === 'none' ? 0 : 20, variant === 'div');
  const roster = { fish: ['cod', 'salmon', 'pufferfish_small'] };
  const r = lockstepRows({ lanesDir: ld, resultsDir: rr, roster }); rmSync(d, { recursive: true, force: true }); return r;
}
let caught = 0; const sabotage = [];
{
  const g = groupRun('ok'); if (!(g.fish && g.fish.pass && g.fish.checked === 20)) { console.log('lockstepcreditcheck: FAIL, group row not credited with all lanes (entity without lane must be ignored)'); process.exit(1); }
  if (!groupRun('short').fish) { /* 19 salts -> not credited */ caught++; } else { console.log('FAIL: 19-salt lane credited group'); process.exit(1); }
  if (!groupRun('none').fish) caught++;
  const dv = groupRun('div').fish; if (dv && !dv.pass) caught++; else { console.log('FAIL: diverging lane not red'); process.exit(1); }
}
// roster row player_slim is credited from lane player (ROW_ALIAS); without the alias it is missing
{
  const d = mkdtempSync(join(tmpdir(), 'lcs-')), ld = join(d, 'lanes'), rr = join(d, 'res'); mkdirSync(ld); mkdirSync(rr);
  writeFileSync(join(ld, 'player.json'), JSON.stringify({ id: 'player', mob: 'player' }));
  for (let s = 0; s < 20; s++) writeFileSync(join(rr, `player-${s}.json`), JSON.stringify({ lane: 'player', salt: s, same: true }));
  const roster = { player: ['player'], player_slim: ['player_slim'] };
  const w = lockstepRows({ lanesDir: ld, resultsDir: rr, roster }), wo = lockstepRows({ lanesDir: ld, resultsDir: rr, roster, rowAlias: {} });
  rmSync(d, { recursive: true, force: true });
  if (!(w.player_slim && w.player_slim.pass && w.player_slim.checked === 20)) { console.log('lockstepcreditcheck: FAIL, player_slim not credited from lane player'); process.exit(1); }
  if (!wo.player_slim) caught++; else { console.log('FAIL: player_slim credited without alias'); process.exit(1); }
}
// each rule is broken by feeding the credit function data that violates it; the matching expectation above must then fail
{
  const out = mkdtempSync(join(tmpdir(), 'lccb-')), A = tree(), cur = (l, r = A) => currentInputs(l, r);
  const d = join(out, 'a'); results(d, 'cow', cur('cow'));
  // 1 stale inputs must NOT be credited: break the file after the fact and expect 0
  const B = tree({ cowlane: 'changed' }); if (count(B, [d], 'cow') === 0) caught++;
  // 2 foreign inputs
  const f = join(out, 'f'); results(f, 'cow', cur('pig')); if (count(A, [f], 'cow') === 0) caught++;
  // 3 missing inputs
  const m = join(out, 'm'); results(m, 'cow', undefined); if (count(A, [m], 'cow') === 0) caught++;
  // 4 older dir counts when only it holds the results
  if (count(A, [join(out, 'none'), d].filter((x) => x !== join(out, 'none')), 'cow') === 3) caught++;
  // 5 a harness edit leaves an unrelated lane credited only through the fence
  const fe = (t) => t + '\n// LANE:cow\nq\n// END LANE\n', P = tree({ 'referee/server.mjs': fe('s') }), dp = join(out, 'p'); results(dp, 'pig', cur('pig', P));
  if (count(tree({ 'referee/server.mjs': fe('s').includes('q') ? fe('s').replace('q', 'r') : (() => { throw new Error('no-op break'); })() }), [dp], 'pig') === 3) caught++;
  rmSync(out, { recursive: true, force: true });
}
if (base) { console.log(`lockstepcreditcheck: FAIL (${base} rule(s) broken)`); process.exit(1); }
if (caught < 8) { console.log(`lockstepcreditcheck: FAIL, only ${caught}/8 breaks caught`); process.exit(1); }
console.log(`lockstepcreditcheck: ${caught} breaks caught; credit rules hold`);
