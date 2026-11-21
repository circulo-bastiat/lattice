#!/usr/bin/env node
// nbtport11743check.mjs — #11743: net/minecraft/nbt (src/02n_nbt.js). Typed tags, StringNbtReader/Writer, NbtTextFormatter,
// NbtOrderedStringFormatter, NbtIo binary round trip + size tracker, NbtScanner collectors, NbtOps, and the real entry
// point (/data get, which prints through NbtTextFormatter). Each behaviour is then cut by patching NS.Nbt.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
function load(patch) {
  const NS = {}; globalThis.MCL = NS;
  for (const f of ['00_ns.js', '01_util.js', '02i_text.js', '02n_nbt.js']) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
  if (patch) patch(NS.Nbt);
  return NS;
}
function scenario(patch) {
  const NS = load(patch), N = NS.Nbt, f = [];
  const chk = (c, m) => { if (!c) f.push(m); };
  const t = (fn) => { try { return fn(); } catch (e) { return 'ERR ' + e.message; } };
  const P = (s) => t(() => N.toSnbt(N.parse(s)));
  chk(P('{a:1b,b:2s,c:3,d:4L,e:1.5f,f:2.5d,g:"x"}') === '{a:1b,b:2s,c:3,d:4L,e:1.5f,f:2.5d,g:"x"}', 'typed suffixes round-trip: ' + P('{a:1b,b:2s,c:3,d:4L,e:1.5f,f:2.5d,g:"x"}'));
  chk(P('{z:1,a:true,m:false}') === '{a:1b,m:0b,z:1}', 'writer sorts keys; true/false are bytes: ' + P('{z:1,a:true,m:false}'));
  chk(P('{b:[B;1b,2b],i:[I;1,2],l:[L;1L,2L]}') === '{b:[B;1B,2B],i:[I;1,2],l:[L;1L,2L]}', 'primitive arrays: ' + P('{b:[B;1b,2b],i:[I;1,2],l:[L;1L,2L]}'));
  chk(P('{n:300b}') === '{n:"300b"}', 'out-of-range byte falls to a string: ' + P('{n:300b}'));
  chk(P('{k:1.0}') === '{k:1.0d}', 'implicit double');
  chk(/argument.nbt.list.mixed/.test(P('{l:[1,"a"]}')), 'mixed list refused: ' + P('{l:[1,"a"]}'));
  chk(/argument.nbt.array.mixed/.test(P('{l:[I;1,2L]}')), 'mixed array refused');
  chk(/argument.nbt.trailing/.test(P('{a:1} x')), 'trailing data refused');
  chk(N.escape("it's") === '"it\'s"' && N.escape('say "hi"') === "'say \"hi\"'", 'NbtString.escape picks the other quote');
  chk(N.javaFloat(1) === '1.0' && N.javaDouble(1e7) === '1.0E7' && N.javaFloat(0.1) === '0.1', 'Java float formatting');
  const c = t(() => N.parse('{Pos:[1.0d,2.0d],Name:"Bob",n:{x:1b},A:[B;1b,2b]}'));
  chk(t(() => N.prettyText(c)) === '{Pos: [1.0d, 2.0d], Name: "Bob", n: {x: 1b}, A: [B; 1B, 2B]}', 'NbtTextFormatter single line: ' + t(() => N.prettyText(c)));
  const runs = t(() => NS.Text.runs(new N.NbtTextFormatter('', 0).apply(N.parse('{a:1b}')), null));
  chk(Array.isArray(runs) && runs.some((r) => r.style && r.style.color === 'gold'), 'formatter colours numbers gold');
  const big = t(() => N.parse('{x:[1,2,3,4,5,6,7,8,9]}'));
  chk(new N.NbtTextFormatter('  ', 0).apply(big) && NS.Text.plain(new N.NbtTextFormatter('  ', 0).apply(big)).includes('\n    9'), 'long list goes multi-line with a prefix');
  const st = t(() => N.parse('{palette:[{Name:"a"}],size:[1,2,3],DataVersion:1,zed:2,data:[{nbt:{q:1},pos:[0,0,0],state:0}]}'));
  const ord = t(() => new N.NbtOrderedStringFormatter().apply(st));
  chk(ord.indexOf('DataVersion') < ord.indexOf('size') && ord.indexOf('size') < ord.indexOf('data') && ord.indexOf('data') < ord.indexOf('palette') && ord.indexOf('palette') < ord.indexOf('zed'), 'ordered formatter: structure key order: ' + ord);
  chk(/pos: \[0, 0, 0\], state: 0, nbt:/.test(ord.replace(/\s+/g, ' ')) , 'ordered formatter: data entry order pos,state,nbt');
  const src = t(() => N.parse('{a:1b,s:"x",l:[1L,2L],i:[I;5,6],d:{e:-2.5d,f:3.5f}}'));
  const bin = t(() => N.write(src));
  const back = t(() => N.read(bin));
  chk(back && back.type === 10 && N.equals(src, back), 'NbtIo write/read round trip');
  chk(bin[0] === 10 && bin[1] === 0 && bin[2] === 0, 'NbtIo root = type 10 + empty name');
  chk(/Root tag/.test(t(() => N.read(Uint8Array.from([1, 0, 0, 5])))), 'non-compound root refused');
  chk(/too big/.test(t(() => N.read(bin, new N.NbtTagSizeTracker(10)))), 'NbtTagSizeTracker limit');
  const q = [new N.NbtScanQuery('d', 6, 'e'), new N.NbtScanQuery(8, 's')];
  const sel = new N.SelectiveNbtCollector(q); t(() => N.scan(bin, sel));
  const sr = sel.getRoot();
  chk(N.toSnbt(sr) === '{d:{e:-2.5d},s:"x"}', 'SelectiveNbtCollector keeps only queried: ' + N.toSnbt(sr));
  const ex = new N.ExclusiveNbtCollector([new N.NbtScanQuery(8, 's')]); t(() => N.scan(bin, ex));
  chk(ex.getRoot() && !N.toSnbt(ex.getRoot()).includes('s:"x"') && N.toSnbt(ex.getRoot()).includes('a:1b'), 'ExclusiveNbtCollector drops queried: ' + t(() => N.toSnbt(ex.getRoot())));
  const O = N.NbtOps;
  chk(N.toSnbt(O.mergeToList(O.empty(), N.int(1))) === '[1]', 'NbtOps.mergeToList from empty');
  chk(O.mergeToList(N.string('x'), N.int(1)) === null, 'NbtOps.mergeToList refuses non-list');
  chk(N.toSnbt(O.mergeToMap(N.compound(), N.string('k'), N.int(1))) === '{k:1}', 'NbtOps.mergeToMap');
  chk(O.getStringValue(N.int(1)) === null && O.getStringValue(N.string('s')) === 's', 'NbtOps.getStringValue');
  return f;
}
const base = scenario();
let breaks = 0; const fails = base.map((m) => 'baseline: ' + m);
const cut = (name, patch) => { const f = scenario(patch); if (f.length) breaks++; else fails.push('cut not caught: ' + name); };
cut('parsePrimitive all strings', (N) => { N.parsePrimitive = (w) => N.string(w); });
cut('escape always double', (N) => { N.escape = (s) => '"' + s + '"'; });
cut('read drops size tracker', (N) => { const r = N.read; N.read = (u) => r(u); });
cut('write wrong root', (N) => { const w = N.write; N.write = (t) => { const b = w(t); b[0] = 9; return b; }; });
cut('scan selects everything', (N) => { N.NbtTreeNode.prototype.isTypeEqual = () => true; });
cut('prettyText compact', (N) => { N.prettyText = (t) => N.toSnbt(t); });
cut('ordered = sorted', (N) => { const O = N.NbtOrderedStringFormatter; N.NbtOrderedStringFormatter = function () { const o = new N.StringNbtWriter(); this.apply = (t) => o.apply(t); }; void O; });
cut('mergeToList accepts strings', (N) => { N.NbtOps.mergeToList = (l, v) => N.list([v]); });
cut('javaFloat plain', (N) => { N.javaFloat = (v) => String(v); N.javaDouble = (v) => String(v); });

// the real entry point: /data get prints through NbtTextFormatter
{
  const { loadEngine } = await import('./loadsrc.mjs');
  const src = readFileSync(join(ROOT, 'src/15g_commands.js'), 'utf8');
  if (!/NS\.Nbt\.prettyText/.test(src)) fails.push('15g_commands snbtStr does not call NS.Nbt.prettyText (unwired)');
}
console.log(`${breaks} breaks caught; ${fails.length} failures; ${base.length === 0 ? "baseline clean" : "baseline dirty"}`);
if (fails.length) { for (const f of fails.slice(0, 12)) console.log('  FAIL ' + f); console.log('\nFAIL nbtport11743check'); process.exit(1); }
console.log('PASS nbtport11743check — 30 assertions, 0 failures, ' + breaks + ' breaks caught');
