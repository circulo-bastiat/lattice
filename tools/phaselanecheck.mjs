#!/usr/bin/env node
// phaselanecheck.mjs - #3948 PHASE LANE: one worker takes phase issues in order, smartly chosen; its hold and gate are its own.
// ANTI-VACUITY: every rule is also run against a broken copy and must be caught ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const SRCP = fileURLToPath(new URL('./infra/phaselane.mjs', import.meta.url)), SRC = rd('./infra/phaselane.mjs'), GO = rd('./go.mjs'), BRAIN = rd('./brain/brain.mjs'), YML = rd('../.github/workflows/brain.yml'), LAUNCH = rd('./brain/launch.mjs');
const ROLES = JSON.parse(rd('./brain/roles.json'));
const I = (n, ms, labels = [], body = '') => ({ number: n, milestone: ms ? { title: ms } : null, labels: labels.map((name) => ({ name })), body });
const num = (i) => i.milestone.title;
const order = (l) => [...l].sort((a, b) => num(a).localeCompare(num(b), 'en', { numeric: true }) || a.number - b.number).map((i) => i.number);
const queue = () => [I(1, '01 BUGS — open'), I(2, '06 G18a — mobs'), I(3, '03 G17 — entities', [], 'G17: ✅ all of it'), I(4, '03 G17 — entities', ['tracking']),
  I(5, '03 G17 — entities', [], 'Depends on: #9'), I(6, '03 G17 — entities', [], '◐ OWED: ChunkMap'), I(7, '04 G17d — x', ['needs-pc']), I(8, '00 INFRA — x'), I(10, '04 G17d — y', [], 'plain'), I(9, '03 G17 — z', ['blocked'])];
let N = 0;
function run(Q, go = GO, brain = BRAIN, yml = YML, launch = LAUNCH, cfg = ROLES) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const dep = (l, all) => l.filter((i) => !/Depends on: #(\d+)/.test(i.body) || !all.some((j) => j.number === Number(/Depends on: #(\d+)/.exec(i.body)[1])));
  const all = queue(), lane = order(Q.laneFilter(dep(all, all)));
  ok(JSON.stringify(lane) === '[6,10,2]', `lane claim order: G17 before G18, bugs/infra/blocked/needs-pc excluded, done/tracking/dependent skipped (got ${lane})`);
  ok(!Q.laneFilter([I(1, '01 BUGS')]).length && !Q.laneFilter([I(1, '00 INFRA')]).length && !Q.laneFilter([I(1, null)]).length, 'bugs, infra and milestone-less issues are not phase issues');
  ok(!Q.laneCandidate(I(1, '03 G17', ['env-fault'])) && !Q.laneCandidate(I(1, '03 G17', ['pc-gpu'])), 'env-fault / pc-gpu are skipped');
  ok(Q.laneCandidate(I(1, '03 G17', [], '✅ part one\n◐ part two')), 'a half-done issue is still claimable');
  // go.mjs wiring: the lane's list, the gate, the unchanged order for everyone else
  ok(/MCLITE_LANE === 'phase'[\s\S]{0,400}?if \(lane\) list\.splice\(0, list\.length, \.\.\.laneFilter\(list\)\)/.test(go), 'go.mjs queue() does not filter to phase issues for MCLITE_LANE=phase');
  ok(/lane && passGate \? list : gateFilter\(list, issues\)/.test(go), 'the gate is not obeyed with passGate false / not ignored with true, or it is ignored for non-lane workers');
  ok(/fill\.phaseLane\.passGate/.test(go), 'go.mjs does not read roles.json fill.phaseLane.passGate');
  ok(/list\.sort\(\(a, b\) => ms\(a\)\.localeCompare\(ms\(b\), 'en', \{ numeric: true \}\)/.test(go), 'queue order (milestone number ascending) changed');
  ok(cfg.fill.phaseLane.workers === 1 && cfg.fill.phaseLane.passGate === false && cfg.fill.phaseLane.why, 'roles.json fill.phaseLane must be {workers: 1, passGate: false, why}');
  ok(/SMART CHOICE[\s\S]*OWED[\s\S]*decomp[\s\S]*Depends on[\s\S]*already-fixed/.test(cfg.fill.phaseLane.prompt || ''), 'the lane prompt lacks the smart-unit / already-fixed instructions');
  ok(/forced === 'phase'[\s\S]{0,100}?MCLITE_LANE = 'phase'/.test(launch) && /phaseLane \|\| \{\}\)\.prompt/.test(launch), 'launch.mjs does not pass MCLITE_LANE / the lane prompt');
  ok(/"\$ACCOUNT" = phase \] && export MCLITE_LANE=phase/.test(yml), 'brain.yml does not set MCLITE_LANE=phase for the @phase run');
  // hold markers independent: brain.yml names the marker by account (phase -> noclaim-phase); fill() reads each on its own
  ok(/noclaim-"\$\{ACCOUNT:-default\}"/.test(yml), 'the no-claim marker is not per run (noclaim-phase vs noclaim-default)');
  ok(/noClaimHold\('default', now\)\) \{[^}]*n = t;/.test(brain) && !/noClaimHold\('default'[^\n]*LANE/.test(brain), "a lane hold holds the bug workers (or the default hold is gone)");
  ok(/laneHeld = noClaimHold\(LANE, now\)[\s\S]{0,300}?laneSlots\(CFG, [^\n]*laneHeld\)[\s\S]{0,200}?noClaimEnd\(LANE\)/.test(brain), 'the lane hold is not its own marker that reports when it ends (no waker can be armed)');
  // the brain dispatches exactly one lane worker, inside the total
  const t = (...x) => x, c = { fill: { phaseLane: { workers: 1 } } };
  ok(Q.laneSlots(c, t('brain worker', 'brain tester'), false) === 1, 'no lane worker running: dispatch one');
  ok(Q.laneSlots(c, t('brain worker', 'brain worker @phase'), false) === 0, 'a lane worker is running (or waiting): dispatch none');
  ok(Q.laneSlots(c, t('brain worker @phase'), true) === 0 && Q.laneSlots(c, t(), true) === 0, 'held lane: dispatch none');
  ok(Q.laneSlots({ fill: {} }, t(), false) === 0 && Q.laneSlots({ fill: { phaseLane: { workers: 0 } } }, t(), false) === 0, 'lane not configured: dispatch none');
  ok(/for \(let i = t; i < n; i\+\+, lane = 0\)[^\n]*account: LANE/.test(brain) && /m\[1\] !== LANE/.test(brain), 'fill() dispatches more than one lane worker, or adds the lane on top of the total');
  return f;
}
const fails = run(await import(pathToFileURL(SRCP).href)), total = N;
const mod = (from, to) => (s) => { if (!s.includes(from)) throw new Error(`no such text: ${from}`); return s.split(from).join(to); };
const BREAKS = [  // [name, file, mutation]
  ['bugs leak into the lane', 'src', mod("!/^(00 INFRA|01 BUGS)/.test(ms(i))", 'true')],
  ['already-done issues are taken', 'src', mod('!doneOnMaster(i) && ', '')],
  ['done = any ✅ mark', 'src', mod('&& !/[◐☐⬜]|\\bOWED\\b/i.test(b)', '')],
  ['blocked / needs-pc not skipped', 'src', mod("['needs-pc', 'pc-gpu', 'env-fault', 'blocked', 'tracking']", '[]')],
  ['two lane workers', 'src', mod('!runTitles.some(isLaneRun) ? 1 : 0', '1')],
  ['a held lane still dispatches', 'src', mod('&& !held &&', '&&')],
  ['the lane is not filtered in go.mjs', 'go', mod("lane) list.splice(0, list.length, ...laneFilter(list))", 'false) list.splice(0, list.length, ...laneFilter(list))')],
  ['passGate ignored', 'go', mod('lane && passGate ? list', 'false ? list')],
  ['everyone ignores the gate', 'go', mod('lane && passGate ? list', 'passGate ? list')],
  ['queue order changed', 'go', mod("ms(a).localeCompare(ms(b), 'en', { numeric: true })", 'ms(b).localeCompare(ms(a), \'en\', { numeric: true })')],
  ['lane hold is the shared marker', 'brain', mod('noClaimHold(LANE, now)', "noClaimHold('default', now)")],
  ['lane hold reports no end', 'brain', mod('noClaimEnd(LANE)', '0')],
  ['lane counted on top of the total', 'brain', mod('m[1] !== LANE', 'true')],
  ['lane dispatched every iteration', 'brain', mod('i++, lane = 0)', 'i++)')],
  ['no env for the lane', 'yml', mod('export MCLITE_LANE=phase', 'true')],
  ['one marker for all', 'yml', mod('noclaim-"${ACCOUNT:-default}"', 'noclaim-default')],
  ['lane not told in launch', 'launch', mod("env.MCLITE_LANE = 'phase'", 'void 0')],
];
let caught = 0;
for (const [name, file, m] of BREAKS) {
  const d = mkdtempSync(join(tmpdir(), 'pl-')); let r;
  try {
    let Q = await import(pathToFileURL(SRCP).href), go = GO, brain = BRAIN, yml = YML, launch = LAUNCH;
    if (file === 'src') { const p = join(d, 'p.mjs'); writeFileSync(p, m(SRC)); Q = await import(pathToFileURL(p).href); }
    else if (file === 'go') go = m(GO); else if (file === 'brain') brain = m(BRAIN); else if (file === 'yml') yml = m(YML); else launch = m(LAUNCH);
    r = run(Q, go, brain, yml, launch);
  } catch (e) { r = [`broken: ${e.message}`]; fails.push(`break "${name}": ${e.message}`); }
  rmSync(d, { recursive: true, force: true });
  if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
}
console.log(`phaselanecheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !x.startsWith('break')).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
