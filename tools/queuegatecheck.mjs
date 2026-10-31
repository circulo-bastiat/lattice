#!/usr/bin/env node
// queuegatecheck.mjs - proves tools/infra/queuegate.mjs: while a `gate` issue is open, nothing past the mob phases is
// handed out (Dan, 30 Sept: "we dont move on until its perfect"). ANTI-VACUITY: broken copies must be caught.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const SRC = fileURLToPath(new URL('./infra/queuegate.mjs', import.meta.url));
const I = (n, ms, labels = []) => ({ number: n, milestone: ms ? { title: ms } : null, labels: labels.map((name) => ({ name })) });
const list = [I(1, '01 BUGS — open bugs'), I(2, '03 G17 — Entities'), I(3, '07 G18b — mob AI'), I(4, '12 G19d — EATING'),
  I(5, '21 G27 — THE NETHER'), I(6, '18 G24 — FARMING', ['mobs']), I(7, null)];
let N = 0;
function run(Q) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const gated = Q.gateFilter(list, [...list, I(99, '01 BUGS', ['gate', 'tracking'])]).map((i) => i.number);
  ok(JSON.stringify(gated) === '[1,2,3,6]', `gate open: only bugs, G17*, G18* and 'mobs' issues (got ${gated})`);
  const late = [I(4, '12 G19d — EATING'), I(5, '21 G27 — THE NETHER'), I(7, null)];
  ok(Q.gateFilter(late, late).length === late.length, 'no gate label and zero open G17*/G18*: the whole queue');
  ok(Q.gateFilter(late, [...late, I(60, '08 G18c — x')]).length === 0, 'no gate label but one open G18c issue: later phases hidden');
  ok(Q.gateFilter(late, [...late, I(61, '03 G17 — lockstep')]).length === 0, 'an open G17 lockstep issue holds the gate');
  ok(Q.gateFilter(late, [...late, { ...I(62, '08 G18c — x'), pull_request: {} }]).length === late.length, 'a PR in G18c does not hold the gate');
  ok(Q.gateFilter(late, [...late, { ...I(98, null, ['gate']), pull_request: {} }]).length === late.length, 'a PR labelled gate is not a gate');
  const dep = (n, ms, body) => ({ ...I(n, ms), body });
  const dl = [dep(70, '03 G17 — x', 'Depends on: #71'), dep(71, '12 G19d — y', 'Depends on: #72'), dep(72, '21 G27 — z'), dep(73, '21 G27 — w')];
  ok(JSON.stringify(Q.gateFilter(dl, [...dl, I(99, '01 BUGS', ['gate', 'tracking'])]).map((i) => i.number)) === '[70,71,72]', 'an out-of-gate dependency of an in-gate issue passes the gate, transitively; an unrelated one stays hidden');
  const dp = [I(80, '12 G19d — y'), I(81, '21 G27 — z')], dpAll = [...dp, dep(82, '03 G17 — x', 'Depends on: #80'), { ...dep(83, '03 G17 — x', 'Depends on: #81'), labels: [{ name: 'blocked' }] }, I(99, '01 BUGS', ['gate', 'tracking'])];
  ok(JSON.stringify(Q.gateFilter(dp, dpAll).map((i) => i.number)) === '[80]', '#9126: the in-gate dependent is NOT in the list (claimFilter dropped it) yet its dependency passes; a blocked dependent pulls nothing in');
  ok(Q.gateFilter([I(90, null, ['red'])], [I(90, null, ['red']), I(99, '01 BUGS', ['gate', 'tracking'])]).length === 1, 'a red issue passes an open gate');
  const child = (par) => ({ number: 50, milestone: null, labels: Q.inheritLabels(par).map((name) => ({ name })) });
  ok(Q.inGate(child(I(40, null, ['mobs', 'opus']))), 'a child of a mobs parent is in the gate');
  ok(!Q.inGate(child(I(41, null))), 'a child of an unlabelled parent is not in the gate');
  ok(JSON.stringify(Q.inheritLabels(I(42, null, ['mobs', 'opus', 'severe', 'dan', 'bug', 'blocked', 'tracking', 'land', 'gate']))) === '["mobs","opus","severe","dan","bug"]', 'inherits all but blocked/tracking/land/gate');
  // 22 Oct (Dan): units that do not depend on mobs are labelled `mobfree` and pass an open gate, in milestone order; at 91/91 the computed gate lifts
  const GT = I(99, '01 BUGS', ['gate', 'tracking']), mf = [I(10, '21 G27 — THE NETHER', ['mobfree']), I(11, '21 G27 — THE NETHER'), I(12, '12 G19d — EATING', ['mobfree'])];
  ok(JSON.stringify(Q.gateFilter(mf, [...mf, GT]).map((i) => i.number)) === '[10,12]', 'a mobfree issue passes an open gate, an unlabelled G27 one does not');
  ok(Q.inGate(child(I(43, null, ['mobfree']))), 'a child of a mobfree parent is mobfree (inherits the label)');
  const open2 = [...mf, I(60, '08 G18c — x')], proven = Object.assign([...open2], { allProven: true });
  ok(Q.gateFilter(mf, open2).length === 2, 'computed gate (an open G18c issue), matrix not proven: only the mobfree ones');
  ok(Q.gateFilter(mf, proven).length === 3 && !Q.gateOpen(proven), 'computed gate with allProven: the whole queue opens');
  ok(Q.gateFilter(mf, Object.assign([...mf, GT], { allProven: true })).length === 2, 'allProven does not lift a hand gate issue');
  return f;
}
const fails = run(await import(pathToFileURL(SRC).href)), total = N, src = readFileSync(SRC, 'utf8');
const BREAKS = [['the gate is ignored', 'if (!gateOpen(issues)) return list;', 'return list;'],
  ['later phases leak through', "/\\bG1[78][a-z]?\\b/", "/\\bG\\d+[a-z]?\\b/"],
  ['children inherit nothing', "filter((n) => !/", "filter((n) => true || !/"],
  ['the gate never lifts', "!i.pull_request && lab(i, 'gate')", 'true'],
  ['dependencies stay hidden', 'return list.filter((i) => inGate(i) || need.has(i.number));', 'return list.filter(inGate);'],
  ['red hidden', " || lab(i, 'red')", ''],
  ['computed rule dropped', 'phaseOpen(issues).length > 0', 'false'],
  ['mobfree not in the gate', " || lab(i, 'mobfree')", ''],
  ['allProven ignored', ' && !issues.allProven', ''],
  ['allProven lifts the hand gate too', '!!handGate(issues) ||', '!!handGate(issues) && !issues.allProven ||']];
let caught = 0;
for (const [name, from, to] of BREAKS) {
  if (!src.includes(from)) { fails.push(`break "${name}": queuegate.mjs no longer contains ${from}`); continue; }
  const d = mkdtempSync(join(tmpdir(), 'qg-')), p = join(d, 'q.mjs'); writeFileSync(p, src.split(from).join(to));
  if (run(await import(pathToFileURL(p).href)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
  rmSync(d, { recursive: true, force: true });
}
console.log(`queuegatecheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !x.startsWith('break')).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
