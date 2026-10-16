// tools/watchdogcheck.mjs - #2702: vmwatch.decide() restarts only when every brain runner is down 2 ticks (or >=5 of 10 for 15 min), within the guards.
// Anti-vacuity: mutated copies of vmwatch.mjs must all be caught.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./infra/vmwatch.mjs', import.meta.url), 'utf8');
const load = (s) => import('data:text/javascript;base64,' + Buffer.from(s.replace(/^import .*$/gm, '').replace("import.meta.dirname", "''")).toString('base64'));
const M = 60e3, T = 1e9;
const O = (o) => ({ now: T, online: 0, total: 10, restartPending: false, freeGB: 100, vmOff: false, ...o });
const verdicts = async (s) => {
  const { decide } = await load(s.replace(/^export const jobs.*$/m, '').replace(/^const jobs[\s\S]*$/m, ''));
  const bad = [], chk = (c, m) => { if (!c) bad.push(m); };
  const r1 = decide({}, O({}));
  chk(!r1.restart, 'restarted on the first all-down tick');
  const r2 = decide(r1.state, O({ now: T + 5 * M }));
  chk(r2.restart, 'no restart after 2 all-down ticks');
  chk(!decide(r2.state, O({ now: T + 10 * M, })).restart && !decide({ allDownTicks: 5, lastRestart: T }, O({ now: T + 44 * M })).restart, 'cooldown ignored');
  chk(decide({ allDownTicks: 5, lastRestart: T }, O({ now: T + 46 * M })).restart, 'cooldown never ends');
  chk(!decide({ allDownTicks: 5 }, O({ restartPending: true })).restart, 'restarted with a restart pending');
  chk(!decide({ allDownTicks: 5 }, O({ freeGB: 3 })).restart, 'restarted with low disk');
  chk(!decide({ allDownTicks: 5 }, O({ vmOff: true })).restart, 'restarted an Off VM');
  chk(!decide({ allDownTicks: 1 }, O({ online: 1 })).restart && decide({ allDownTicks: 1 }, O({ online: 1 })).state.allDownTicks === 0, 'one online runner did not reset the count');
  chk(decide({ partialSince: T - 16 * M }, O({ online: 5 })).restart, 'partial outage (5 of 10, 16 min) ignored');
  chk(!decide({ partialSince: T - 10 * M }, O({ online: 5 })).restart, 'partial outage restarted early');
  chk(!decide({ partialSince: T - 20 * M }, O({ online: 6 })).restart, 'only 4 of 10 down restarted');
  chk(decide({}, O({ online: 5 })).state.partialSince === T, 'partial clock not started');
  return bad;
};
const BREAKS = [
  ['one tick restarts', (s) => s.replace('ALL_DOWN_TICKS = 2', 'ALL_DOWN_TICKS = 1')],
  ['cooldown ignored', (s) => s.replace('if (st.lastRestart !== null &&', 'if (false &&')],
  ['pending ignored', (s) => s.replace('if (o.restartPending)', 'if (false)')],
  ['disk gate ignored', (s) => s.replace('o.freeGB < MIN_FREE_GB', 'false')],
  ['Off VM ignored', (s) => s.replace('if (o.vmOff)', 'if (false)')],
  ['count never resets', (s) => s.replace('o.online === 0 ? st.allDownTicks + 1 : 0', 'st.allDownTicks + (o.online === 0 ? 1 : 0)')],
  ['partial threshold 6', (s) => s.replace('PARTIAL_OF = 5', 'PARTIAL_OF = 6')],
  ['partial never fires', (s) => s.replace('>= PARTIAL_MIN * 60e3', '>= 1e15')],
];
const real = await verdicts(src);
let caught = 0;
for (const [name, mut] of BREAKS) { const m = mut(src); if (m !== src && (await verdicts(m)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`watchdogcheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${12 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
