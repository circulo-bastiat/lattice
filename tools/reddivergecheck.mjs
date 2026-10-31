// reddivergecheck (#9933, commander 24 Oct): the full run is the JUDGE of a RED issue. Prelaunch (#7683) and "already passes" hand-offs
// must never close, block or burn an issue the full run re-reddened after the last answer; repeated contradictions are `env-diverges`.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { handoffVerdict, stuckByHandoffs } from './infra/handoffstuck.mjs';
import { launchInstead } from './infra/prelaunch.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const rd = (f) => readFileSync(join(HERE, f), 'utf8');
const red = (sha = 'abc1234') => ({ user: { login: 'github-actions[bot]' }, body: `The full suite on master at ${sha} has \`soundcheck\` red. Filed by the full suite itself (#1912).` });
const pre = () => ({ body: '**Hand-off** (2026-10-22T00:58Z) <!-- outcome:partial-handoff -->\n\nprelaunch (#7683): soundcheck already pass on master e11df90e9; closed before any session started' });
const fixed = () => ({ body: '**Already fixed on master** (closed by a worker via `done --already-fixed`): soundcheck passes on current master' });
const work = () => ({ body: '<!-- brain-run 1 worker #9337 model=sonnet --> RED soundcheck: full-suite check red on master' });
// the real shape of #9337 (21-22 Oct): worker closes, judge re-reds, prelaunch closes x3
const cases = [
  ['a red newer than the last answer is fresh: launch, never close', [work(), fixed(), red()], 'fresh', 'fresh'],
  ['a first red with no answers yet is fresh', [red()], 'fresh', 'fresh'],
  ['no judge comment at all: the old rule decides (ok here)', [work(), fixed()], 'ok', ''],
  ['one answer after the red: ok (the next red decides)', [red(), pre()], 'ok', ''],
  ['two prelaunch answers since the last red: env-diverges', [red(), pre(), pre()], 'diverges', 'diverges'],
  ['two red -> passes cycles in a row, then a third red: env-diverges', [red(), pre(), red('b'), fixed(), red('c')], 'diverges', 'diverges'],
  ['#9337 as it stood on 22 Oct (red, closed, red, prelaunch x3): env-diverges', [work(), fixed(), red(), work(), fixed(), red('b'), pre(), pre(), pre()], 'diverges', 'diverges'],
];
let fails = 0, n = 0;
const ok = (a, b, label) => { n++; if (a !== b) { fails++; console.log('FAIL', label, JSON.stringify(a), '!=', JSON.stringify(b)); } };
const run = (v = handoffVerdict, l = launchInstead) => { for (const [t, cs, want, wantLaunch] of cases) { ok(v(cs), want, t); ok(l(cs), wantLaunch, t + ' (prelaunch)'); } };
run();
// the wiring: go.mjs must consult the verdict BEFORE the blocked rule and label env-diverges, never blocked, for a contradiction
const SRC = { go: rd('go.mjs'), pre: rd('infra/prelaunch.mjs') };
const wired = (S) => /handoffVerdict\(cs\)/.test(S.go) && /hv === 'diverges'[\s\S]{0,400}labels: \['env-diverges'\]/.test(S.go) && /hv !== 'fresh' && stuckByHandoffs\(cs\)/.test(S.go)
  && /launchInstead\(await gh\('GET'/.test(S.pre) && /return console\.log\(`prelaunch: the full run still reds/.test(S.pre);
ok(wired(SRC), true, 'go.mjs and prelaunch.mjs consult the verdict');
// anti-vacuity: break each rule and see it caught
const breaks = [
  ['rule 1 removed: prelaunch never launches instead', () => run(handoffVerdict, () => ''), true],
  ['verdict never says fresh', () => run(() => 'ok', launchInstead), true],
  ['verdict never says diverges', () => run((cs) => (handoffVerdict(cs) === 'diverges' ? 'ok' : handoffVerdict(cs)), launchInstead), true],
  ['go.mjs blocks before it asks the verdict', () => ok(wired({ ...SRC, go: SRC.go.replace("hv !== 'fresh' && stuckByHandoffs(cs)", 'stuckByHandoffs(cs)') }), true, 'w'), true],
  ['prelaunch does not read the comments', () => ok(wired({ ...SRC, pre: SRC.pre.replace('launchInstead(await gh(', 'launchInstead(await (') }), true, 'w'), true],
];
let caught = 0;
for (const [, f] of breaks) { const f0 = fails; const real = console.log; console.log = () => {}; try { f(); } catch { fails++; } console.log = real; if (fails > f0) { caught++; fails = f0; } }
void stuckByHandoffs;
console.log(`${n} assertions, ${fails} failures, ${caught} breaks caught (of ${breaks.length})`);
process.exit(fails || caught < breaks.length ? 1 : 0);
