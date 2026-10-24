// tools/claimfiltercheck.mjs - #8981: runs tools/infra/claimfilter.mjs on fixture issues; each rule is broken in turn and must be caught.
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = new URL('./infra/', import.meta.url);
const L = (...n) => n.map((name) => ({ name }));
const I = (number, labels = [], body = '', extra = {}) => ({ number, labels: L(...labels), body, ...extra });
async function verdict(mod) {
  const bad = [], { claimFilter, branchTaken } = mod;
  const issues = [I(1), I(2, ['tracking']), I(3, [], '', {}), I(10, [], 'Depends on: #1'), I(11, [], 'Depends on: #2'), I(12, [], 'Depends on: #999'),
    I(13, [], 'Builds on: #1'), I(14, ['blocked']), I(15, ['pc-gpu']), I(16, ['needs-pc']), I(17, ['tracking']), I(18, [], 'x', { pull_request: {} }), I(19, [], 'Depends on: #18'), I(20, ['needs-java']), I(21, ['opus']), I(22, ['opus', 'needs-java'])];
  const ok = (n, vm = true) => claimFilter(issues, { vm }).some((i) => i.number === n);
  const want = (c, m) => { if (!c) bad.push(m); };
  want(!ok(10), 'Depends on an open normal issue must be excluded');
  want(ok(11), 'Depends on a tracking umbrella must be claimable');
  want(ok(12), 'Depends on a closed issue must be claimable');
  want(ok(13), 'Builds on must be claimable');
  want(!ok(14), 'blocked must be excluded');
  want(!ok(15) && !ok(16), 'pc-gpu / needs-pc must be excluded for a vm worker');
  want(ok(15, false), 'pc-gpu must stay claimable off the vm');
  want(ok(19), 'Depends on a pull request must be claimable');
  want(!ok(20) && ok(20, false), 'needs-java must be excluded for a vm worker and claimable off the vm');
  const pool = (opus, vm = true) => claimFilter(issues, { vm, opus }).map((i) => i.number);
  want(!pool(false).includes(21) && !pool(false).includes(22), 'the Sonnet pool must not claim `opus` issues');
  want(pool(true).includes(21) && !pool(true).includes(1) && !pool(true).includes(22), 'the Opus pool claims only `opus` issues (and still no needs-java on the vm)');
  const rev = new Set(); rev.rebase = new Set();
  want(branchTaken('work/5-a', { age: 0.1, message: 'wip' }, rev, 3), 'a fresh held branch must be taken');
  want(!branchTaken('work/5-a', { age: 0.1, message: 'handoff: released' }, rev, 3), 'a released branch must be claimable');
  want(!branchTaken('work/5-a', { age: 9, message: 'wip' }, rev, 3), 'a stale branch must be claimable');
  return bad;
}
const src = readFileSync(new URL('claimfilter.mjs', dir), 'utf8');
const BREAKS = [
  ['open dependency ignored', (s) => s.replace('.some((d) => openNums.has(d))', '.some((d) => false)')],
  ['tracking counts as open dependency', (s) => s.replace("!i.pull_request && !lab(i, 'tracking')).map", '!i.pull_request).map')],
  ['pull request counts as open dependency', (s) => s.replace("issues.filter((i) => !i.pull_request && !lab(i, 'tracking')).map", "issues.filter((i) => !lab(i, 'tracking')).map")],
  ['blocked claimable', (s) => s.replace("!lab(i, 'blocked') && ", '')],
  ['needs-pc / pc-gpu claimable', (s) => s.replace("(lab(i, 'needs-pc') || lab(i, 'pc-gpu') || lab(i, 'needs-java'))", 'false')],
  ['needs-java claimable on the vm', (s) => s.replace(" || lab(i, 'needs-java')", '')],
  ['opus pool mixed with the rest', (s) => s.replace("lab(i, 'opus') === opus", 'true')],
  ['held branch claimable', (s) => s.replace("return !!head && isHeld(", "return false && isHeld(")],
  ['released branch held', (s) => s.replace('isHeld({ age: head.age', 'isHeld({ age: head.age, message: "", x: 0').replace('message: head.message, bouncedFree', 'bouncedFree')],
];
const tmp = mkdtempSync(join(tmpdir(), 'cf-'));
copyFileSync(new URL('heldnow.mjs', dir), join(tmp, 'heldnow.mjs'));
let n = 0;
const load = async (s) => { const f = join(tmp, `cf${n++}.mjs`); writeFileSync(f, s); return import(pathToFileURL(f).href); };
const real = await verdict(await load(src)); let caught = 0;
for (const [name, mk] of BREAKS) { const b = mk(src); if (b !== src && (await verdict(await load(b))).length) { caught++; console.log(' ✓ break caught:', name); } else console.log(' NOT CAUGHT:', name); }
for (const x of real) console.log(' FAIL:', x);
console.log(`claimfiltercheck: ${real.length} failed; ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
