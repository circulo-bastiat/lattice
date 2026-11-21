#!/usr/bin/env node
// utilclasses11762check.mjs — #11762: src/02q_utilclasses.js (net/minecraft/util ports).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(ROOT + 'src/02q_utilclasses.js', 'utf8');
function load(code) { const M = {}; new Function('MCL', code)(M); return M.UtilClasses; }
function scenario(U) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  chk(U.Arm.LEFT.getOpposite() === U.Arm.RIGHT && U.Arm.RIGHT.getOpposite() === U.Arm.LEFT && U.Arm.fromMainHand('left') === U.Arm.LEFT, 'Arm');
  const B = U.BooleanBiFunction, tt = [[0,0],[0,1],[1,0],[1,1]].map(([a,b]) => [!!a, !!b]);
  const row = (fn) => tt.map(([a, b]) => fn(a, b) ? 1 : 0).join('');
  chk(row(B.AND) === '0001' && row(B.OR) === '0111' && row(B.ONLY_FIRST) === '0010' && row(B.ONLY_SECOND) === '0100', 'bool basic');
  chk(row(B.NOT_OR) === '1000' && row(B.NOT_AND) === '1110' && row(B.NOT_SAME) === '0110' && row(B.SAME) === '1001', 'bool 2');
  chk(row(B.CAUSES) === '1101' && row(B.CAUSED_BY) === '1011' && row(B.NOT_FIRST) === '1100' && row(B.NOT_SECOND) === '1010', 'bool 3');
  chk(row(B.FIRST) === '0011' && row(B.SECOND) === '0101' && row(B.TRUE) === '1111' && row(B.FALSE) === '0000', 'bool 4');
  const g = new Map([['a', new Set(['b', 'c'])], ['b', new Set(['c'])]]), out = [];
  chk(U.TopologicalSorts.sort(g, new Set(), new Set(), (x) => out.push(x), 'a') === false && out.join() === 'c,b,a', 'topo order ' + out);
  const cyc = new Map([['a', new Set(['b'])], ['b', new Set(['a'])]]);
  chk(U.TopologicalSorts.sort(cyc, new Set(), new Set(), () => {}, 'a') === true, 'topo cycle');
  const T = U.TypedActionResult;
  chk(T.success(1).getResult() === 'SUCCESS' && T.success(1, false).getResult() === 'CONSUME' && T.pass(2).getValue() === 2 && T.fail(3).getResult() === 'FAIL', 'typed');
  chk(U.WorldSavePath.LEVEL_DAT.toString() === '/level.dat' && U.WorldSavePath.ROOT.getRelativePath() === '.', 'save path');
  const m = U.MetricsData(); for (let i = 1; i <= 250; i++) m.pushSample(i);
  chk(m.getCurrentIndex() === 10 && m.getStartIndex() === 11, 'metrics ring ' + m.getCurrentIndex() + ',' + m.getStartIndex());
  const m2 = U.MetricsData(); [10, 20, 30].forEach((v) => m2.pushSample(v)); chk(m2.average(3) === 20 && m2.average(2) === 15, 'metrics avg');
  chk(m2.scaled(16666666, 100, 60) === 100, 'metrics scaled ' + m2.scaled(16666666, 100, 60));
  const a = U.ModStatus.create(0, 'x'), b = U.ModStatus.create(2, 'y'), c = a.combine(b);
  chk(c.confidence === 2 && c.getMessage() === 'Definitely; x; y' && c.isModded() && !a.isModded(), 'modstatus');
  chk(U.ModStatus.check('vanilla', () => 'vanilla', 'Client', true).confidence === 0 && U.ModStatus.check('vanilla', () => 'f', 'C', true).confidence === 2 && U.ModStatus.check('vanilla', () => 'vanilla', 'C', false).confidence === 1, 'modstatus check');
  const n = U.Nameable({ getName: () => 'N' }); chk(!n.hasCustomName() && n.getDisplayName() === 'N', 'nameable');
  const e = [{ asString: () => 'a' }, { asString: () => 'b' }], cd = U.StringIdentifiable.createCodec(e);
  chk(cd.decode('b') === e[1] && cd.decode(0) === e[0] && cd.encode(e[1]) === 'b', 'codec');
  let th = false; try { cd.decode(5); } catch (x) { th = true; } chk(th, 'codec bad ordinal');
  const d = U.ThrowableDeliverer(), e1 = new Error('1'); d.add(e1); d.add(new Error('2')); let got; try { d.deliver(); } catch (x) { got = x; }
  chk(got === e1 && got.suppressed.length === 1, 'deliverer');
  class A {} class Bc extends A {} const tf = U.TypeFilter.instanceOf(Bc); chk(tf.downcast(new Bc()) && tf.downcast(new A()) === null, 'typefilter');
  const mp = U.MaterialPredicate.create('STONE', (s) => s.m, (s) => s.air); chk(mp({ m: 'STONE' }) && !mp({ m: 'X' }) && !mp(null), 'material');
  const ap = U.MaterialPredicate.create('AIR', null, (s) => s.air); chk(ap({ air: true }) && !ap(null), 'material air');
  let t = 0, saved = []; const tm = U.TickDurationMonitor(() => t, 'srv', 100, (p, s) => saved.push(s));
  tm.endTick(); tm.nextProfiler(); t = 50; tm.endTick(); tm.nextProfiler(); t = 200; tm.endTick(); chk(saved.join() === '150', 'tick monitor ' + saved);
  const lines = []; const w = U.CsvWriter.makeHeader().addColumn('a').addColumn('b').startBody((s) => lines.push(s));
  w.printRow('x,y', null); chk(lines.join('') === 'a,b\r\n"x,y",[null]\r\n', 'csv ' + JSON.stringify(lines));
  th = false; try { w.printRow(1); } catch (x) { th = true; } chk(th, 'csv columns');
  const F = U.FileNameUtil;
  chk(F.isReserved('CON') && F.isReserved('com1.txt') && F.isReserved('x.') && !F.isReserved('World'), 'reserved');
  chk(F.getNextUniqueName((x) => false, 'a/b:c', '') === 'a_b_c', 'invalid chars');
  chk(F.getNextUniqueName((x) => x === 'New World' || x === 'New World (1)', 'New World', '') === 'New World (2)', 'unique counter');
  chk(F.getNextUniqueName((x) => x === 'W (3)', 'W (3)', '') === 'W (4)', 'counter parse');
  chk(F.getNextUniqueName(() => false, 'CON', '') === '_CON_', 'reserved wrap');
  chk(F.getNextUniqueName(() => false, 'x'.repeat(300), '.zip').length === 255, 'max length');
  chk(F.isNormal('a/b') && !F.isNormal('a/../b') && F.normalizeToPosix('a/../b') === 'b' && F.normalizeToPosix('a\\b/./c') === 'a/b/c' && F.getPosixFullPath('a/b/c.txt') === 'a/b/' && !F.isAllowedName('x/NUL/y'), 'paths');
  const J = U.JsonHelper, o = { s: 'x', i: 3.7, b: true, a: [], o: {} };
  chk(J.getString(o, 's') === 'x' && J.getInt(o, 'i') === 3 && J.getBoolean(o, 'b') && J.getInt(o, 'zz', 9) === 9 && J.hasJsonObject(o, 'o') && !J.hasJsonObject(o, 'a'), 'json');
  th = false; try { J.getString(o, 'i'); } catch (x) { th = true; } chk(th, 'json wrong type throws');
  th = false; try { J.getInt(o, 'zz'); } catch (x) { th = true; } chk(th, 'json missing throws');
  return f;
}
const base = scenario(load(src));
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const cuts = [
  (s) => s.replace("U.Arm.LEFT.getOpposite = function () { return U.Arm.RIGHT; }", "U.Arm.LEFT.getOpposite = function () { return U.Arm.LEFT; }"),
  (s) => s.replace("CAUSES: function (a, b) { return !a || b; }", "CAUSES: function (a, b) { return a || b; }"),
  (s) => s.replace("NOT_SAME: function (a, b) { return a !== b; }", "NOT_SAME: function (a, b) { return a === b; }"),
  (s) => s.replace("if (visiting.has(node)) return true;", ""),
  (s) => s.replace("visiting.delete(node); visited.add(node); out(node);", "visiting.delete(node); out(node);visited.add(node);".replace('out(node);visited', 'visited')),
  (s) => s.replace("swing === false ? tar('CONSUME', v)", "swing === false ? tar('SUCCESS', v)"),
  (s) => s.replace("['LEVEL_DAT', 'level.dat']", "['LEVEL_DAT', 'level.nbt']"),
  (s) => s.replace("else start = m.wrapIndex(w + 1);", "else start = w;"),
  (s) => s.replace("Math.trunc(1e9 / fps)", "(1e9 / fps) * 2"),
  (s) => s.replace("Math.max(c, o.confidence)", "Math.min(c, o.confidence)"),
  (s) => s.replace("return signed ? ms(0,", "return !signed ? ms(0,"),
  (s) => s.replace("if (!o.hasCustomName) o.hasCustomName = function () { return o.getCustomName() != null; };", "if (!o.hasCustomName) o.hasCustomName = function () { return true; };"),
  (s) => s.replace("t.suppressed.push(e)", "t = e"),
  (s) => s.replace("o instanceof c ? o : null", "o"),
  (s) => s.replace("return st != null && getMat(st) === mat;", "return st != null;"),
  (s) => s.replace("if (span >= overtime)", "if (span > overtime + 100)"),
  (s) => s.replace("/[\",\\r\\n]/.test(s)", "/[\\r\\n]/.test(s)"),
  (s) => s.replace("'[null]'", "''"),
  (s) => s.replace("if (arguments.length !== cols.length) throw", "if (false) throw"),
  (s) => s.replace("|CON|PRN", "|PRN").replace("(?:COM|CLOCK", "(?:COM|CLOCK").replace("COM|CLOCK\\$|CON|PRN", "COM|CLOCK\\$|PRN"),
  (s) => s.replace("name = '_' + name + '_';", ""),
  (s) => s.replace("n = parseInt(m[2], 10);", "n = 0;"),
  (s) => s.replace("name.substring(0, 255 - ext.length)", "name.substring(0, 256 - ext.length)"),
  (s) => s.replace("if (!exists(c)) return c;\n        n++;", "if (!exists(c)) return c;\n        n += 2;"),
  (s) => s.replace("{ if (s === '..') { if (parts.length) parts.pop(); }", "{ if (s === '..') { }"),
  (s) => s.replace("return Math.trunc(o[k]); },\n    getFloat", "return o[k]; },\n    getFloat"),
  (s) => s.replace("if (typeof o[k] !== 'string') throw jerr('a string', k, o[k]); return o[k]; },", "return o[k]; },"),
];
let caught = 0;
for (const c of cuts) { const s2 = c(src); if (s2 === src) { console.log('cut did not apply', c.toString()); process.exit(1); } let r; try { r = scenario(load(s2)).length; } catch (e) { r = 1; } if (r) caught++; else console.log('uncaught cut', c.toString()); }
if (caught !== cuts.length) { console.log('FAIL: only ' + caught + '/' + cuts.length); process.exit(1); }
console.log('PASS utilclasses11762check — ' + caught + ' breaks caught');
