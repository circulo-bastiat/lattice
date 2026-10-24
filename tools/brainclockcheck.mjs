// tools/brainclockcheck.mjs - #8958 (Dan, 19 Oct: "a permanent solution"). The fill's clock must not depend on GitHub cron (throttled to hours on this
// account; brain.yml's */5 never fired and the fill sat at 0 workers for 7 h). Guards: tick.sh runs health --if-due + fill and stamps tick.json;
// vm-setup.sh installs a systemd timer firing every <= 5 min; a stale stamp raises `tick-stale`. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { findings } from './brain/route.mjs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SRC = { tick: rd('./brain/tick.sh'), setup: rd('./brain/vm-setup.sh'), brain: rd('./brain/brain.mjs'), yml: rd('../.github/workflows/brain.yml') };
const verdict = (S) => {
  const bad = [];
  if (!/brain\.mjs health --if-due/.test(S.tick)) bad.push('tick.sh does not run `health --if-due`');
  if (!/brain\.mjs fill/.test(S.tick)) bad.push('tick.sh does not run `fill`');
  if (!/flock -n/.test(S.tick)) bad.push('tick.sh has no lock (two ticks would overlap)');
  if (!/fetch .*origin master/.test(S.tick)) bad.push('tick.sh does not refresh its clone of master');
  if (!/actions\/variables/.test(S.tick) || !/FILL_WORKERS_MAX/.test(S.tick)) bad.push('tick.sh does not read the FILL_* repo variables');
  if (!/tick\.json/.test(S.tick)) bad.push('tick.sh does not stamp ~/.brain/tick.json');
  if (!/&& bash -n "\$DIR\/tools\/brain\/tick\.sh"; then/.test(S.tick)) bad.push('tick.sh would install a master copy that does not parse (the clock would stop for good)');
  { const r = spawnSync('bash', ['-n'], { input: S.tick, encoding: 'utf8' }); if (r.status !== 0 && !r.error) bad.push('tools/brain/tick.sh does not parse: ' + String(r.stderr).slice(0, 120)); }
  if (!/! cmp -s "\$DIR\/tools\/brain\/tick\.sh" "\$0" && bash -n[^\n]*; then\n\s+cp "\$DIR\/tools\/brain\/tick\.sh" "\$0\.new"[^\n]*TICK_UPDATED=1 exec "\$0"/.test(S.tick)) bad.push('tick.sh does not replace its installed copy with master\'s and re-run (#9665: changes to it never ran)');
  if (!/brain-tick\.timer/.test(S.setup) || !/systemctl enable --now brain-tick\.timer/.test(S.setup)) bad.push('vm-setup.sh does not install and enable brain-tick.timer');
  const m = /OnUnitInactiveSec=(\d+)min/.exec(S.setup);
  if (!m || +m[1] > 5) bad.push('the timer does not fire every <= 5 min');
  if (!/snap\.tickAgeMin/.test(S.brain)) bad.push('health does not read the tick stamp');
  // #8966: the brain's own health mails (to: commander/fixer, from: brain) are what wake those roles; the route `if:` must not skip them
  const rif = /^\s+if: "?(.*github\.event_name != 'issue_comment'.*)$/m.exec(S.yml)?.[1] || '';
  if (!rif) bad.push('brain.yml has no route if:');
  if (/from: brain/.test(rif)) bad.push("brain.yml's route if: skips `from: brain` mail, so no health alert ever wakes the commander or fixer (#8966)");
  if (!/to: commander/.test(rif) || !/to: fixer/.test(rif)) bad.push('the route if: does not route to: commander / to: fixer');
  return bad;
};
const BREAKS = [
  ['tick drops health', (S) => ({ ...S, tick: S.tick.replace('brain.mjs health --if-due', 'true') })],
  ['tick drops fill', (S) => ({ ...S, tick: S.tick.replace('brain.mjs fill', 'true') })],
  ['tick drops the lock', (S) => ({ ...S, tick: S.tick.replace('flock -n', 'true') })],
  ['tick stops refreshing master', (S) => ({ ...S, tick: S.tick.replace('origin master', 'origin x') })],
  ['tick ignores the repo variables', (S) => ({ ...S, tick: S.tick.replace(/actions\/variables/g, 'x') })],
  ['tick.sh itself does not parse', (S) => ({ ...S, tick: S.tick + '\nif then fi\n' })],
  ['tick installs a master copy that does not parse (#9665)', (S) => ({ ...S, tick: S.tick.replace(' && bash -n "$DIR/tools/brain/tick.sh"; then', '; then') })],
  ['tick never updates its installed copy (#9665)', (S) => ({ ...S, tick: S.tick.replace('TICK_UPDATED=1 exec "$0"', 'true') })],
  ['tick drops its stamp', (S) => ({ ...S, tick: S.tick.replace(/tick\.json/g, 'x') })],
  ['setup never enables the timer', (S) => ({ ...S, setup: S.setup.replace('systemctl enable --now brain-tick.timer', 'true') })],
  ['timer fires hourly', (S) => ({ ...S, setup: S.setup.replace('OnUnitInactiveSec=2min', 'OnUnitInactiveSec=60min') })],
  ['route if: skips from: brain', (S) => ({ ...S, yml: S.yml.replace("(contains(github.event.comment.body, 'to: commander')", "!contains(github.event.comment.body, 'from: brain') && (contains(github.event.comment.body, 'to: commander')") })],
  ['health ignores the stamp', (S) => ({ ...S, brain: S.brain.replaceAll('snap.tickAgeMin', 'snap.zzz') })],
];
const real = verdict(SRC); let caught = 0;
const f = (age) => findings({ now: Date.now(), tickAgeMin: age, runners: [], mail: [], diskFreeGB: 50 }, { health: {} }).some((x) => x.key === 'tick-stale');
if (!f(25)) real.push('a 25-min-old stamp does not raise tick-stale');
if (f(2)) real.push('a fresh stamp raises tick-stale');
if (f(null)) real.push('a missing stamp (not on the VM) raises tick-stale');
for (const [n, mk] of BREAKS) { const m = mk(SRC); if (verdict(m).length) { caught++; console.log(' ✓ break caught:', n); } else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`brainclockcheck: ${12 + 3 - real.length} assertions, ${real.length} failed; ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
