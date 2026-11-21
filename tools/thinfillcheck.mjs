// #8897 R2: the thin-queue decision, and every rule when broken is caught.
import { decide, probeSlices, liveSlices, sliceReason, stepLaneGap, HOLD_MS, owedFiles, owedSlices, unsplitTrackers } from './infra/thinfill.mjs';
import { planStepLanes } from './infra/prooffeed.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const now = 1e12, b = { free: 5, thin: 40, markerAt: now - 1, lastRoundAt: 0, lastDecisionAt: 0, now };
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
ok(decide(b).act === 'prooffeed', 'prooffeed first');
const SL = [{ slice: 'S', evidence: ['a: no lane'], count: 1 }];
ok(decide({ ...b, filed: 0, slices: SL }).act === 'enlargers', 'enlargers when prooffeed filed nothing');
caught(decide({ ...b, markerAt: 0 }).act === 'none', 'no marker, no action');
caught(decide({ ...b, free: 40 }).act === 'none', 'deep queue, no action');
caught(decide({ ...b, filed: 3 }).act === 'none', 'prooffeed filed, no enlargers');
// #11331 (Dan, 9 Nov): need-based, no 6 h timer
caught(decide({ ...b, filed: 0, slices: SL, lastRoundAt: now - 600e3 }).act === 'none', 'a round within 45 min is held');
caught(decide({ ...b, filed: 0, slices: SL, lastRoundAt: now - 3600e3 }).act === 'enlargers', 'need present: a round 1 h after the last one starts (no 6 h timer)');
caught(decide({ ...b, filed: 0, slices: SL, lastRoundAt: 0, inFlight: true }).act === 'none', 'an enlarger run in flight: no second one');
caught(decide({ ...b, filed: 0, slices: SL, lastRoundAt: now - 7200e3, lastFiled: 0, sig: 'S:1', lastSig: 'S:1' }).act === 'none', 'last round filed 0 units and the evidence is unchanged: no round');
caught(decide({ ...b, filed: 0, slices: SL, lastRoundAt: now - 7200e3, lastFiled: 0, sig: 'S:2', lastSig: 'S:1' }).act === 'enlargers', 'evidence changed: a round starts');
caught(decide({ ...b, filed: 0, slices: SL, lastRoundAt: now - 7200e3, lastFiled: 4, sig: 'S:1', lastSig: 'S:1' }).act === 'enlargers', 'the last round filed units: a round starts');
caught(decide({ ...b, lastDecisionAt: now }).act === 'none', 'marker already handled');
// #10799 probes on a temp tree
const root = mkdtempSync(join(tmpdir(), 'thin-')), T = join(root, 'tools');
mkdirSync(join(T, 'referee', 'steplanes.d'), { recursive: true }); mkdirSync(join(T, 'mobproof'), { recursive: true });
const W = (f, o) => writeFileSync(join(T, f), JSON.stringify(o));
W('mobl3-mobs.json', { mobs: { cat: {}, cow: {}, pig: {}, fox: {} } }); W('referee/steplanes.d/cat_edge.json', { mob: 'cat' }); W('referee/steplanes.na.json', { _why: 'x', fox: 'no' });
W('mobproof/matrix.json', { rows: { cow: { model: 'green', drops: 'red' }, pig: { model: 'missing' } } }); W('finalgate.json', { areas: [{ id: 'worldgen', proof: 'V' }] });
let pr = probeSlices(root);
ok(pr.length === 2 && pr[0].count === 2 && pr[0].evidence.some((e) => e.startsWith('cow:')), 'step-lane gap probe: cow, pig');
ok(pr[1].evidence[0] === 'cow x drops: red', 'red matrix cell probe (MISSING is not work)');
ok(/EVIDENCE \(2\).*cow: no lane/.test(sliceReason(pr[0], 1, 2)), 'reason carries slice and evidence');
ok(decide({ ...b, filed: 0, slices: pr }).act === 'enlargers', 'gap -> enlargers');
caught(stepLaneGap(['cat', 'fox', 'cow'], ['cat'], { _why: 'x', fox: 'n' }).length === 1, 'lane and N/A rows both cover a mob');
W('mobl3-mobs.json', { mobs: { cat: {}, fox: {} } }); W('mobproof/matrix.json', { rows: {} });
caught(probeSlices(root).length === 0 && decide({ ...b, filed: 0, slices: probeSlices(root) }).why === 'no evidenced slice', 'no gap -> act none, no empty round');
// back-off
const hold = { [pr[0].slice]: { at: now - 3600e3, count: 2 } };
caught(liveSlices(pr, hold, now).length === 1, 'slice that filed 0 is held');
caught(liveSlices([{ ...pr[0], count: 3 }], hold, now).length === 1, 'released when its count changed');
caught(liveSlices(pr, hold, now + HOLD_MS + 1).length === 2, 'released after 24 h (epoch inside the marker)');
// prooffeed step-lane units
const gap = ['a', 'b', 'c', 'd', 'e', 'f', 'g'], ex = [{ title: 'step lane for b', body: '' }];
let u = planStepLanes(gap, ex);
ok(u.length === 1 && !u[0].title.includes(' b,') && u[0].body.includes('steplane-a'), 'units skip mobs an issue already covers');
caught(planStepLanes(gap.concat(Array.from({ length: 12 }, (_, i) => 'm' + i)), []).every((x) => (x.body.match(/^- /gm) || []).length <= 9 && /^- /m.test(x.body)), 'units are 3-9 mobs');
caught(planStepLanes(['a', 'b'], []).length === 0, 'fewer than 3 mobs: no unit');
// the constant SLICES must not come back
const fs = await import('node:fs'); const src = fs.readFileSync(new URL('./infra/thinfill.mjs', import.meta.url), 'utf8');
caught(!/export const SLICES\b/.test(src) && !/G17 whole-phase/.test(src), 'constant SLICES restored is caught');
// #11320: the enlargers own the owed work - trackers and OWED tables are probed, human sign-off rows are not, the prompt says so
const root2 = mkdtempSync(join(tmpdir(), 'thin2-')); mkdirSync(join(root2, 'src'), { recursive: true }); mkdirSync(join(root2, 'tools'), { recursive: true });
writeFileSync(join(root2, 'src', 'a.js'), '// OWED\nA.OWED = {};\n// OWED again\n'); writeFileSync(join(root2, 'src', 'b.js'), '// OWED\n'); writeFileSync(join(root2, 'src', 'c.gen.js'), 'OWED OWED OWED OWED');
writeFileSync(join(root2, 'tools', 'finalgate.json'), JSON.stringify({ areas: [{ id: 'audio', proof: 'C' }] })); writeFileSync(join(root2, 'tools', 'mobl3-mobs.json'), '{"mobs":{}}');
const TR = 'G26: STATISTICS (whole phase \u2014 split it into issues as the first step)', p2 = probeSlices(root2, { openTitles: [TR, 'G26b: one unit'] });
ok(p2.length === 2 && p2[0].evidence[0] === TR && p2[0].count === 1, 'unsplit whole-phase tracker probe comes first');
ok(p2[1].evidence[0] === 'src/a.js: 3 OWED lines' || p2[1].evidence[0] === 'src/a.js: 2 OWED lines', 'OWED probe lists files by size');
caught(owedFiles(root2).length === 2 && owedFiles(root2).every((x) => !/gen/.test(x.f)), 'generated data files are not OWED tables');
caught(probeSlices(root2).every((x) => !/final-gate/.test(x.slice)), 'human sign-off rows are not an enlarger slice');
caught(unsplitTrackers([TR, 'G26b: one unit']).length === 1, 'only whole-phase trackers count');
caught(owedSlices([{ f: 'x', n: 9 }, { f: 'y', n: 8 }, { f: 'z', n: 1 }], 2).map((s) => s.count).sort().join() === '9,9', 'OWED files are balanced over the slices');
caught(probeSlices(mkdtempSync(join(tmpdir(), 'thin3-')), { openTitles: [] }).length === 0, 'no src, no trackers: no slice');
const prompt = JSON.parse(fs.readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8')).roles.enlarger.prompt;
const need = [/OWN the owed work/, /DRIVE THE REAL PATH/, /WHOLE slice walked/, /left: </, /close the tracker with the proof/, /Call 41 is the report/, /y\/n question/, /ACK: the limit is call 46/, /Call 46 is ALWAYS your final handoff/, /Calls 1-40 are work/];
for (const re of need) { ok(re.test(prompt), 'enlarger prompt keeps ' + re); caught(!re.test(prompt.replace(re, '')), 'prompt without ' + re + ' is caught'); }
caught(!/zero is fine/.test(prompt), 'the old "zero is fine" rule stays out');
const brainSrc = fs.readFileSync(new URL('./brain/brain.mjs', import.meta.url), 'utf8');
caught(/await post\('enlarger-1', slices\.map\(/.test(brainSrc) && !/for \(let k = 0; k < slices\.length; k\+\+\) await post\(/.test(brainSrc) && !/post\(`enlarger-\$\{k \+ 1\}`/.test(brainSrc), 'ONE enlarger (Dan, 8 Nov): one mail to enlarger-1 carries every live slice, never one mail per slice (#11331)');
caught(/inFlight/.test(brainSrc) && /h\.thinRound = \{ at: now, slices, sig: base\.sig/.test(brainSrc), 'the brain tells decide() whether an enlarger run is in flight and what the last round filed (#11331)');
caught(owedSlices(owedFiles(root2)).length === 1, 'the OWED tables are one slice for the one enlarger');
caught(/the ONLY enlarger/.test(prompt) && !/ONE of THREE/.test(prompt), 'the prompt does not claim two peers');
console.log(`thinfillcheck: ${bad ? bad + ' FAILED' : 'ok'}, ${breaks} breaks caught`);
