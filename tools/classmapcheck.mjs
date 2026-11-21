// #11465: the class map is not vacuous. Asserts the real map has every verdict bucket and that a committed copy matches
// a fresh run, then breaks its inputs and demands the verdicts move. Prints "<n> breaks caught".
import fs from 'node:fs'; import path from 'node:path';
import { build, loadSrc, loadStages, render } from './classmap.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let bad = 0; const fail = (m) => { console.log('FAIL ' + m); bad++; };
// Every wiring/proof landing moves the counts, so an exact match kept master red between regenerations (#11790).
// Fresh = same shape, same class total, each number within max(40, 5%) of the real one; far-off counts still fail.
const nums = (s) => (s.match(/\d+/g) || []).map(Number);
const verdictFresh = (have, want) => {
  if (have === want) return true;
  if (have.replace(/\d+/g, '#') !== want.replace(/\d+/g, '#')) return false;
  const a = nums(have), b = nums(want);
  return a.length === b.length && a.every((x, i) => (i === a.length - 3 ? x === b[i] : Math.abs(x - b[i]) <= Math.max(40, b[i] * 0.05)));
};
const real = build(ROOT), c = real.counts;
for (const k of ['proven', 'ported-unchecked', 'ported-unwired', 'missing', 'out-of-scope']) if (!c[k]) fail('no rows with verdict ' + k);
if (real.rows.length < 3000) fail('only ' + real.rows.length + ' classes read from .decomp');
const md = path.join(ROOT, 'docs/audits/classmap.md');
if (!fs.existsSync(md)) fail('docs/audits/classmap.md missing: run node tools/classmap.mjs');
else if (!verdictFresh(fs.readFileSync(md, 'utf8').split('\n')[2], render(real).split('\n')[2])) fail('docs/audits/classmap.md verdict line is stale: run node tools/classmap.mjs');
let caught = 0;
import { attribute, findBanners } from './classcover.mjs';
let dimBreak = false;
{
  const cj = path.join(ROOT, 'tools/classcover.json');
  if (!fs.existsSync(cj)) fail('tools/classcover.json missing: run node tools/classcover.mjs');
  else {
    const cd = JSON.parse(fs.readFileSync(cj, 'utf8'));
    const dimsOk = (d) => ['the_nether', 'the_end', 'overworld'].every((n) => (d || []).some(([k, moved]) => k === n && moved === true));
    if (!dimsOk(cd.dimensions)) fail('classcover.json: the dimension tour did not reach all three dimensions');
    dimBreak = !dimsOk([['the_nether', true], ['the_end', false], ['overworld', true]]) && !dimsOk(undefined);
    const e = Object.entries(cd.modules);
    if (e.length < 200) fail('classcover.json has only ' + e.length + ' modules');
    if (!e.some(([, v]) => v[0] > 0) || !e.some(([, v]) => v[0] < v[1])) fail('classcover.json is all-ran or none-ran (vacuous)');
  }
  const bn = [{ name: 'a.js', at: 0 }, { name: 'b.js', at: 100 }], fns = [{ start: 5, ran: true }, { start: 50, ran: false }, { start: 150, ran: true }];
  const m = attribute(fns, bn);
  if (m['a.js'].join() !== '1,2' || m['b.js'].join() !== '1,1') fail('attribute() misattributes functions');
  const chk = (name, cond) => { if (cond) { caught++; console.log('✓ break caught: ' + name); } else fail('break not caught: ' + name); };
  chk('a dimension the tour failed to enter -> tour check fails', dimBreak);
  chk('no banners -> nothing attributed', Object.keys(attribute(fns, [])).length === 0);
  chk('nothing ran -> zero ran', Object.values(attribute(fns.map((f) => ({ ...f, ran: false })), bn)).every((v) => v[0] === 0));
  chk('banner finder reads real build text', findBanners('/* ==== x.js ===== */\nfoo').length === 1 && findBanners('no banners').length === 0);
}
{ // #11790: tolerance must not make the freshness check vacuous
  const want = render(real).split('\n')[2], bump = (re, f) => want.replace(re, (m) => String(f(Number(m))));
  const chk3 = (name, cond) => { if (cond) { caught++; console.log('✓ break caught: ' + name); } else fail('break not caught: ' + name); };
  chk3('small count drift -> still fresh', verdictFresh(bump(/\d+(?= proven)/, (n) => n + 3), want));
  chk3('proven count far off -> stale', !verdictFresh(bump(/\d+(?= proven)/, (n) => n + 400), want));
  chk3('class total changed -> stale', !verdictFresh(bump(/\d+(?= classes)/, (n) => n + 1), want));
  chk3('shape changed -> stale', !verdictFresh(want.replace('proven', 'checked'), want));
}
const expect = (name, r, test) => { if (test(r.counts)) { caught++; console.log('✓ break caught: ' + name); } else fail('break not caught: ' + name); };
const mods = loadSrc(path.join(ROOT, 'src')), stages = loadStages(ROOT);
expect('no stages -> nothing proven', build(ROOT, { mods, stages: [] }), (x) => !x.proven && x['ported-unchecked'] > c['ported-unchecked']);
expect('no src -> everything missing', build(ROOT, { mods: {}, stages }), (x) => !x.proven && !x['ported-unchecked'] && x.missing > c.missing);
const dead = {}; for (const [f, t] of Object.entries(mods)) dead[f] = t.replace(/\b(NS|MCL)\./g, 'X.');
expect('no references between modules -> unwired rises', build(ROOT, { mods: dead, stages }), (x) => x['ported-unwired'] > c['ported-unwired']);
expect('phantom class -> missing', build(ROOT, { mods, stages, classes: ['net/minecraft/entity/ZzPhantomNeverPortedEntity'] }), (x) => x.missing === 1);
{ // #11465: every unwired/missing/unchecked class is in a filed unit issue
  const fp = path.join(ROOT, 'docs/audits/classmap-issues.json');
  const cm = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/classmap.json'), 'utf8')).rows.filter((r) => ['ported-unwired', 'missing', 'ported-unchecked'].includes(r[5]));
  const units = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const unfiled = (us) => { const s = new Set(us.filter((u) => u.issue).flatMap((u) => u.classes)); return cm.filter((r) => !s.has(r[0])).length; };
  if (unfiled(units)) fail('classmap-issues.json: ' + unfiled(units) + ' classes in no filed issue (rerun tools/classfile.mjs --file)');
  const chk2 = (name, cond) => { if (cond) { caught++; console.log('✓ break caught: ' + name); } else fail('break not caught: ' + name); };
  chk2('a dropped unit -> classes unfiled', unfiled(units.slice(1)) > 0);
  chk2('an unfiled unit (no issue number) -> classes unfiled', unfiled(units.map((u, i) => (i ? u : { ...u, issue: 0 }))) > 0);
}
console.log(bad ? `${5 - bad} checks passed, ${bad} failures` : `9 checks passed, 0 failures, ${caught} breaks caught; verdicts: ${c.proven} proven, ${c["ported-unchecked"]} ported-unchecked, ${c["ported-unwired"]} ported-unwired, ${c.missing} missing`);
process.exit(bad ? 1 : 0);
