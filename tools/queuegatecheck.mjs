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
  const child = (par) => ({ number: 50, milestone: null, labels: Q.inheritLabels(par).map((name) => ({ name })) });
  ok(Q.inGate(child(I(40, null, ['mobs', 'opus']))), 'a child of a mobs parent is in the gate');
  ok(!Q.inGate(child(I(41, null))), 'a child of an unlabelled parent is not in the gate');
  ok(JSON.stringify(Q.inheritLabels(I(42, null, ['mobs', 'opus', 'severe', 'dan', 'bug', 'blocked', 'tracking', 'land', 'gate']))) === '["mobs","opus","severe","dan","bug"]', 'inherits all but blocked/tracking/land/gate');
  return f;
}
const fails = run(await import(pathToFileURL(SRC).href)), total = N, src = readFileSync(SRC, 'utf8');
const BREAKS = [['the gate is ignored', 'gateOpen(issues) ? list.filter(inGate) : list', 'list'],
  ['later phases leak through', "/\\bG1[78][a-z]?\\b/", "/\\bG\\d+[a-z]?\\b/"],
  ['children inherit nothing', "filter((n) => !/", "filter((n) => true || !/"],
  ['the gate never lifts', "!i.pull_request && lab(i, 'gate')", 'true'],
  ['computed rule dropped', 'phaseOpen(issues).length > 0', 'false']];
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
