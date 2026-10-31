#!/usr/bin/env node
// envgapcheck.mjs - 21 Oct (Dan: "there should never be an infrastructure/environment gap again"). tools/infra/envgap.mjs: a worker run that says its workspace lacks
// something is classified (data / server / doc / premise) from REAL hand-off sentences of 20-21 Oct, becomes ONE provisioning issue, and holds the issue; a claim of
// files on master is verified. Cases, wiring in launch.mjs / go.mjs / queuegate.mjs, then anti-vacuity on envgap.mjs and the wiring.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { eg: rd('./infra/envgap.mjs'), launch: rd('./brain/launch.mjs'), go: rd('./go.mjs'), gate: rd('./infra/queuegate.mjs') };
const load = async (s, name) => { const d = mkdtempSync(join(tmpdir(), 'egc-')); const f = join(d, name); writeFileSync(f, s); return import('file://' + f.replace(/\\/g, '/') + '?' + Math.random()); };
async function verdict(S) {
  const bad = []; const t = async (n, f) => { let r = false; try { r = !!(await f()); } catch { r = false; } if (!r) bad.push(n); };
  let M; try { M = await load(S.eg, 'envgap.mjs'); } catch (e) { return ['envgap.mjs does not load: ' + e.message]; }
  const k = (s) => (M.classifyBlocker(s) || {}).kind;
  // real sentences from the 26 partial hand-offs of 20-21 Oct
  await t('#832 audio objects absent -> data', () => k('blocked again, no code change. The 8 chicken .ogg objects are still absent from .mcsnd/objects (hashes in index-1.18.json). Stage the 8 raw chicken objects over the file bridge') === 'data');
  await t('#8971 runloot 0 tables -> data', () => k("R1: runloot.mjs --fire-only ran 328s but reported '0 tables' and wrote no golden file") === 'data');
  await t('#8760 no real-server harness -> server', () => k('Probe.java path dump still owed - Probe.java is only an RNG probe with no server classes, so it needs a real-server harness that this run cannot build') === 'server');
  await t('#9249 player-hunger scene -> server', () => k('It needs a player-hunger scene (food 0, per-difficulty floor) in SeedAgent first.') === 'server');
  await t('#6964 decision note missing -> doc', () => k('docs/decisions/6964-blaze-target-parity.md cited by earlier hand-offs is not in this workspace') === 'doc');
  await t('#1053 work never landed -> premise', () => k('Earlier hand-offs claim textures/skinKey/withertexcheck landed, but neither tools/withertexcheck.mjs nor a stage exists on master here, so none of it landed') === 'premise');
  await t("#8627 'fish' is not a vanilla id -> premise", () => k("no work: 'fish' is not a vanilla entity id; the matrix row looks bogus") === 'premise');
  await t('an ordinary landed run is NOT a gap', () => M.classifyBlocker('I fixed the vacuity failure and queued PR #9296 for the lander. vacuitycheck passes, 3 breaks caught.') === null);
  await t('a RED rerun is NOT a gap', () => M.classifyBlocker('lockstep-slime passes on current master, so I closed #9308 as already fixed and changed no code.') === null);
  await t('empty / undefined text is not a gap', () => M.classifyBlocker('') === null && M.classifyBlocker(undefined) === null);
  await t('the kind decides the label the queue already excludes', () => M.classifyBlocker('needs a real-server harness').label === 'needs-java' && M.classifyBlocker('The 8 .ogg objects are absent from .mcsnd/objects').label === 'needs-data');
  await t('one gap issue per (kind, issue): reuse an open one', () => { const p = M.planGap({ kind: 'data', issue: 832, issues: [{ number: 9400, title: M.gapTitle('data', 832), state: 'open' }] }); return p.op === 'reuse' && p.number === 9400; });
  await t('a different ISSUE with the same kind is a new gap', () => M.planGap({ kind: 'data', issue: 833, issues: [{ number: 9400, title: M.gapTitle('data', 832), state: 'open' }] }).op === 'create');
  await t('another kind or issue, or a closed one, is a new gap', () => M.planGap({ kind: 'server', issue: 832, issues: [{ number: 9400, title: M.gapTitle('data', 832), state: 'open' }] }).op === 'create' && M.planGap({ kind: 'data', issue: 832, issues: [{ number: 9400, title: M.gapTitle('data', 832), state: 'closed' }] }).op === 'create');
  await t('the gap body tells how to provision it for EVERY workspace and to grow the manifest', () => { const b = M.gapBody({ kind: 'data', issue: 832, what: 'x' }); return /EVERY worker workspace/.test(b) && /MANIFEST/.test(b) && /#832/.test(b) && /env-gap/.test(b); });
  await t('claimedPaths finds tools/src/docs/golden paths', () => M.claimedPaths('landed in tools/withertexcheck.mjs and src/07j_x.js, see docs/decisions/6964-a.md and golden/mob-xp.json; also tools/foo').join() === 'tools/withertexcheck.mjs,src/07j_x.js,docs/decisions/6964-a.md,golden/mob-xp.json');
  await t('unverifiedClaims returns only the missing ones', () => M.unverifiedClaims('tools/a.mjs and tools/b.mjs', (p) => p === 'tools/a.mjs').join() === 'tools/b.mjs');
  await t('a message with no file claim has nothing to verify', () => M.unverifiedClaims('passes on master, ran the suite', () => false).length === 0);
  await t('preflight lists what a workspace lacks', () => { const m = M.preflight((p) => p !== '.decomp'); return m.length === 1 && m[0].path === '.decomp'; });
  await t('the manifest names the golden each of furnace/growth/hopper refcheck reads, and go.mjs prep syncs goldens', () => ['furnace', 'growth', 'hopper'].every((n) => M.MANIFEST.some((x) => x.path === `golden/${n}-timing.json`)) && /syncGolden\(dir\)/.test(S.go));
  await t('the manifest names the seven #7704 refcheck goldens', () => ['block-drops','button-timing','comparator-readout','column-growth','dispense-timing','enchanting','fluid-timing'].every((n) => M.MANIFEST.some((x) => x.path === `golden/${n}.json`)));
  await t('the manifest names .decomp and the stage registry', () => M.MANIFEST.some((x) => x.path === '.decomp') && M.MANIFEST.some((x) => x.path === 'tools/stages.d'));
  // wiring
  await t('launch.mjs: classify -> plan -> open the gap issue -> label + hold -> tell the commander', () => /classifyBlocker\(res\.result \|\| ''\)/.test(S.launch) && /planGap\(\{ kind: c\.kind, issue: issueNo, issues: open \}\)/.test(S.launch) && /labels: \['infra', 'severe', 'env-gap'\]/.test(S.launch) && /labels: \['env-gap', 'blocked', c\.label\]/.test(S.launch) && /post\('commander', `env gap/.test(S.launch));
  await t('launch.mjs: runs before the burn accounting and skips an issue already held', () => S.launch.indexOf('classifyBlocker(res.result') < S.launch.indexOf('// #125: no PR and no new code') && /l\.name === 'env-gap'/.test(S.launch));
  await t('go.mjs: --already-fixed refuses a claim of files that do not exist', () => /unverifiedClaims\(msg, \(p\) => existsSync\(join\(ROOT, p\)\)\)/.test(S.go) && /--already-fixed refused: --msg names/.test(S.go));
  await t('the Gate M filter never hides an env-gap issue', async () => { const G = await load(S.gate, 'queuegate.mjs'); return G.inGate({ labels: [{ name: 'env-gap' }] }) === true && G.inGate({ labels: [{ name: 'infra' }] }) === false; });
  return bad;
}
const real = await verdict(SRC); let caught = 0;
const m = (k, a, b) => ({ ...SRC, [k]: SRC[k].replace(a, b) });
const BREAKS = [
  ['data rule gone', m('eg', "label: 'needs-data', re:", "label: 'needs-data', re0:")],
  ['server rule gone', m('eg', "label: 'needs-java', re:", "label: 'needs-java', re0:")],
  ['doc rule gone', m('eg', "doc: { label: 'needs-commander', re:", "doc: { label: 'needs-commander', re0:")],
  ['premise rule gone', m('eg', 'none of it landed', 'zzz7')],
  ['everything is a gap', m('eg', "const t = String(text || '').replace(/\\s+/g, ' ');", "const t = 'needs a real-server harness';")],
  ['a closed gap is reused', m('eg', "i.title === t && i.state === 'open'", 'i.title === t')],
  ['no dedupe by issue', m('eg', 'export const gapTitle = (kind, issue) => `ENV GAP (${kind}): workers cannot do #${issue} until this is provisioned`;', 'export const gapTitle = (kind) => `ENV GAP (${kind}): workers cannot do anything`;')],
  ['claims not verified', m('eg', '.filter((p) => !exists(p))', '.filter(() => false)')],
  ['preflight finds nothing', m('eg', 'MANIFEST.filter((m) => !has(m.path))', 'MANIFEST.filter(() => false)')],
  ['launch never classifies', m('launch', 'classifyBlocker(res.result', 'classifyBlockerX(res.result')],
  ['launch no longer holds the issue', m('launch', "labels: ['env-gap', 'blocked', c.label]", "labels: [c.label]")],
  ['go.mjs accepts unverified claims', m('go', 'unverifiedClaims(msg, (p)', 'unverifiedClaimsX(msg, (p)')],
  ['gate hides env-gap', m('gate', " || lab(i, 'env-gap')", '')],
];
for (const [n, S] of BREAKS) { const r = await verdict(S); if (r.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`envgapcheck: ${real.length ? 'FAILED' : 'ok'}, ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
