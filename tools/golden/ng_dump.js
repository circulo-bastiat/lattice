// ng_dump.js — MC-Lite noise golden vector, step 1 of 1.
//
// Takes a golden dump of Mojang's OWN noise stack out of the real 1.18.2 server jar, so that
// tools/noisecheck.mjs can stop grading MC-Lite against itself.
//
// Route: official Mojang server mappings -> obfuscated names -> plain Java reflection against
// the jar the pregen already verified. No decompiler, no remapper, no third-party mapping set.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const WORK = path.join(HERE, 'ngwork');
const JAR = path.join(HERE, 'server.jar');
const JAR_SHA1 = 'c8f83c5655308435b3dcf03c06d9fe8740a77469';
const INNER = path.join(HERE, 'pregen', 'versions', '1.18.2', 'server-1.18.2.jar');
const LIBDIR = path.join(HERE, 'pregen', 'libraries');
const MAP_SHA1 = 'e562f588fea155d96291267465dc3323bfe1551b';
const MAP_URL = 'https://piston-data.mojang.com/v1/objects/' + MAP_SHA1 + '/server.txt';
const MAP = path.join(WORK, 'server.txt');

const say = (s) => console.log('[ng] ' + s);
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

(async function main() {
  fs.mkdirSync(WORK, { recursive: true });

  // ── 0. the jars, hashed ────────────────────────────────────────────────────────────────
  if (!fs.existsSync(JAR)) { say('FATAL: no server.jar at ' + JAR); process.exit(2); }
  const jarSha = sha1(fs.readFileSync(JAR));
  say('server.jar sha1 ' + jarSha + (jarSha === JAR_SHA1 ? '  VERIFIED' : '  *** MISMATCH ***'));
  if (jarSha !== JAR_SHA1) process.exit(2);
  if (!fs.existsSync(INNER)) { say('FATAL: no inner jar at ' + INNER); process.exit(2); }
  const innerSha = sha1(fs.readFileSync(INNER));
  say('server-1.18.2.jar (bundled) sha1 ' + innerSha);

  const jv = spawnSync('java', ['-version'], { encoding: 'utf8' });
  const javaLine = ((jv.stderr || '') + (jv.stdout || '')).trim().split(/\r?\n/)[0];
  say('java: ' + javaLine);

  // ── 1. the official mappings ───────────────────────────────────────────────────────────
  let mapTxt = null;
  if (fs.existsSync(MAP)) {
    const b = fs.readFileSync(MAP);
    if (sha1(b) === MAP_SHA1) { mapTxt = b.toString('utf8'); say('mappings already present and SHA-1 verified'); }
  }
  if (mapTxt === null) {
    say('downloading ' + MAP_URL);
    const res = await fetch(MAP_URL);
    if (!res.ok) { say('FATAL: HTTP ' + res.status); process.exit(2); }
    const buf = Buffer.from(await res.arrayBuffer());
    const h = sha1(buf);
    say('mappings ' + buf.length + ' bytes, sha1 ' + h + (h === MAP_SHA1 ? '  VERIFIED' : '  *** MISMATCH ***'));
    if (h !== MAP_SHA1) process.exit(2);
    fs.writeFileSync(MAP, buf);
    mapTxt = buf.toString('utf8');
  }

  // ── 2. parse the ProGuard mapping ──────────────────────────────────────────────────────
  //   "net.minecraft.Foo -> abc:"    then indented   "int bar -> a"  /  "12:20:void baz(int) -> b"
  const byDeobf = new Map(), bySimple = new Map();
  {
    let cur = null;
    for (const raw of mapTxt.split(/\r?\n/)) {
      if (!raw || raw.charCodeAt(0) === 35) continue;
      if (raw[0] !== ' ' && raw[0] !== '\t') {
        const m = /^(.+?) -> (.+):$/.exec(raw);
        if (!m) continue;
        cur = { deobf: m[1], obf: m[2], lines: [] };
        byDeobf.set(m[1], cur);
        const simple = m[1].slice(m[1].lastIndexOf('.') + 1);
        if (!bySimple.has(simple)) bySimple.set(simple, []);
        bySimple.get(simple).push(cur);
      } else if (cur) cur.lines.push(raw.trim());
    }
  }
  say('mapping parsed: ' + byDeobf.size + ' classes');

  const obfType = (t) => {
    let arr = '';
    while (t.endsWith('[]')) { arr += '[]'; t = t.slice(0, -2); }
    const e = byDeobf.get(t);
    return (e ? e.obf : t) + arr;
  };
  const parseMembers = (entry) => {
    if (entry.parsed) return entry.parsed;
    const fields = new Map(), methods = [];
    for (const line of entry.lines) {
      const m = /^(?:\d+:\d+:)?(\S+) (\S+?)(?:\((.*)\))? -> (\S+)$/.exec(line);
      if (!m) continue;
      if (m[3] === undefined) fields.set(m[2], { obf: m[4], type: m[1] });
      else {
        const args = m[3].length ? m[3].split(',') : [];
        methods.push({ name: m[2], obf: m[4], ret: m[1], args, obfArgs: args.map(obfType) });
      }
    }
    return (entry.parsed = { fields, methods });
  };

  const problems = [];
  const cls = (simple, pkgHint) => {
    let cands = bySimple.get(simple) || [];
    if (cands.length > 1 && pkgHint) cands = cands.filter((c) => c.deobf.indexOf(pkgHint) >= 0);
    if (cands.length !== 1) { problems.push('class ' + simple + ': ' + cands.length + ' candidates [' + cands.map((c) => c.deobf).join(' ') + ']'); return null; }
    return cands[0];
  };

  // ── 3. resolve every name we are going to reflect on ───────────────────────────────────
  const WANT = {
    RandomSource: ['RandomSource', null],
    BitRandomSource: ['BitRandomSource', null],
    PositionalRandomFactory: ['PositionalRandomFactory', null],
    XoroshiroRandomSource: ['XoroshiroRandomSource', null],
    Xoroshiro128PlusPlus: ['Xoroshiro128PlusPlus', null],
    LegacyRandomSource: ['LegacyRandomSource', null],
    WorldgenRandom: ['WorldgenRandom', null],
    ImprovedNoise: ['ImprovedNoise', null],
    PerlinNoise: ['PerlinNoise', null],
    NormalNoise: ['NormalNoise', null],
    NoiseParameters: ['NormalNoise$NoiseParameters', null],
    SimplexNoise: ['SimplexNoise', null],
    PerlinSimplexNoise: ['PerlinSimplexNoise', null],
    Biome: ['Biome', 'level.biome'],
    Mth: ['Mth', null],
    BuiltinRegistries: ['BuiltinRegistries', null],
    Registry: ['Registry', 'net.minecraft.core.Registry'],
    ResourceLocation: ['ResourceLocation', null],
    Bootstrap: ['Bootstrap', null],
    SharedConstants: ['SharedConstants', null],
  };
  const P = [];               // lines for names.properties
  const resolved = {};
  const OPTIONAL_CLASSES = new Set(['BitRandomSource', 'Bootstrap', 'SharedConstants', 'WorldgenRandom']);
  for (const key of Object.keys(WANT)) {
    const before = problems.length;
    const e = cls(WANT[key][0], WANT[key][1]);
    if (e) { resolved[key] = e; P.push('class.' + key + '=' + e.obf); }
    else if (OPTIONAL_CLASSES.has(key)) { problems.length = before; say('  (optional class ' + key + ' not resolved)'); }
  }
  say('classes resolved: ' + Object.keys(resolved).map((k) => k + '=' + resolved[k].obf).join(' '));

  const method = (ckey, mname, arity, label, argFilter) => {
    const e = resolved[ckey]; if (!e) return;
    let ms = parseMembers(e).methods.filter((m) => m.name === mname && m.args.length === arity);
    if (argFilter) ms = ms.filter(argFilter);
    if (ms.length !== 1) { problems.push('method ' + ckey + '.' + mname + '/' + arity + ': ' + ms.length + ' candidates [' + ms.map((m) => m.args.join(',')).join(' | ') + ']'); return; }
    P.push('m.' + ckey + '.' + (label || mname + arity) + '=' + ms[0].obf + '|' + ms[0].obfArgs.join(','));
  };
  const optMethod = (ckey, mname, arity, label, argFilter) => {
    const e = resolved[ckey]; if (!e) return;
    let ms = parseMembers(e).methods.filter((m) => m.name === mname && m.args.length === arity);
    if (argFilter) ms = ms.filter(argFilter);
    if (ms.length === 1) P.push('m.' + ckey + '.' + (label || mname + arity) + '=' + ms[0].obf + '|' + ms[0].obfArgs.join(','));
    else say('  (optional method ' + ckey + '.' + mname + '/' + arity + ' -> ' + ms.length + ' candidates, skipped)');
  };
  const field = (ckey, fname, label) => {
    const e = resolved[ckey]; if (!e) return;
    const f = parseMembers(e).fields.get(fname);
    if (!f) { problems.push('field ' + ckey + '.' + fname + ' not in mapping'); return; }
    P.push('f.' + ckey + '.' + (label || fname) + '=' + f.obf);
  };
  const ctor = (ckey, arity, label, argFilter) => {
    const e = resolved[ckey]; if (!e) return;
    let ms = parseMembers(e).methods.filter((m) => m.name === '<init>' && m.args.length === arity);
    if (argFilter) ms = ms.filter(argFilter);
    if (ms.length !== 1) { problems.push('ctor ' + ckey + '/' + arity + ': ' + ms.length + ' candidates [' + ms.map((m) => m.args.join(',')).join(' | ') + ']'); return; }
    P.push('k.' + ckey + '.' + label + '=' + ms[0].obfArgs.join(','));
  };

  const optCtor = (ckey, arity, label, argFilter) => {
    const e = resolved[ckey]; if (!e) return;
    let ms = parseMembers(e).methods.filter((m) => m.name === '<init>' && m.args.length === arity);
    if (argFilter) ms = ms.filter(argFilter);
    if (ms.length === 1) P.push('k.' + ckey + '.' + label + '=' + ms[0].obfArgs.join(','));
    else say('  (optional ctor ' + ckey + '/' + arity + ' -> ' + ms.length + ' candidates, skipped)');
  };
  // ⚠ RandomSource's draws may be DECLARED on a super-interface (BitRandomSource) rather than on
  // RandomSource itself. Look in both, and record which class the name was found on.
  const rsMethod = (mname, arity, label) => {
    for (const owner of ['RandomSource', 'BitRandomSource']) {
      const e = resolved[owner]; if (!e) continue;
      const ms = parseMembers(e).methods.filter((m) => m.name === mname && m.args.length === arity);
      if (ms.length === 1) { P.push('m.RandomSource.' + label + '=' + ms[0].obf + '|' + ms[0].obfArgs.join(',')); return; }
    }
    problems.push('RandomSource method ' + mname + '/' + arity + ' not resolvable');
  };
  rsMethod('nextInt', 0, 'nextInt0');
  rsMethod('nextInt', 1, 'nextInt1');
  rsMethod('nextLong', 0, 'nextLong0');
  rsMethod('nextDouble', 0, 'nextDouble0');
  rsMethod('nextFloat', 0, 'nextFloat0');
  rsMethod('forkPositional', 0, 'forkPositional0');
  optMethod('RandomSource', 'nextIntBetweenInclusive', 2, 'nextIntBetweenInclusive2');
  method('PositionalRandomFactory', 'fromHashOf', 1, 'fromHashOf1', (m) => m.args[0] === 'java.lang.String');
  method('PositionalRandomFactory', 'at', 3, 'at3');
  // ⚠ 1.18.2's XoroshiroRandomSource does not HOLD the two words: it delegates to a
  // `Xoroshiro128PlusPlus`, whose two 64-bit fields are found by TYPE and whose order is
  // settled empirically inside NoiseDump rather than guessed.
  field('XoroshiroRandomSource', 'randomNumberGenerator', 'delegate');
  field('LegacyRandomSource', 'seed', 'seed');
  {
    const e = resolved.Xoroshiro128PlusPlus;
    const longs = [];
    if (e) for (const [name, f] of parseMembers(e).fields) if (f.type === 'long') longs.push([name, f.obf]);
    if (longs.length !== 2) problems.push('Xoroshiro128PlusPlus has ' + longs.length + ' long fields, expected 2: ' + JSON.stringify(longs));
    else {
      say('  xoroshiro words: ' + longs.map((l) => l[0] + '->' + l[1]).join(' '));
      P.push('f.Xoroshiro128PlusPlus.w0=' + longs[0][1]);
      P.push('f.Xoroshiro128PlusPlus.w1=' + longs[1][1]);
      P.push('meta.xoroWordNames=' + longs.map((l) => l[0] + ':' + l[1]).join(' '));
    }
  }
  method('ImprovedNoise', 'noise', 3, 'noise3');
  field('ImprovedNoise', 'xo'); field('ImprovedNoise', 'yo'); field('ImprovedNoise', 'zo');
  method('PerlinNoise', 'getValue', 3, 'getValue3');
  optMethod('PerlinNoise', 'create', 3, 'createArr', (m) => m.args[2] === 'double[]');
  optMethod('PerlinNoise', 'create', 3, 'createList', (m) => /DoubleList$/.test(m.args[2]));
  field('PerlinNoise', 'noiseLevels');
  field('PerlinNoise', 'lowestFreqInputFactor');
  field('PerlinNoise', 'lowestFreqValueFactor');
  method('NormalNoise', 'getValue', 3, 'getValue3');
  optMethod('NormalNoise', 'maxValue', 0, 'maxValue0');
  optMethod('NormalNoise', 'create', 3, 'createArr', (m) => m.args[2] === 'double[]');
  optMethod('NormalNoise', 'create', 2, 'createParams');
  field('NormalNoise', 'valueFactor');
  field('NormalNoise', 'first');
  field('NormalNoise', 'second');
  method('PerlinSimplexNoise', 'getValue', 3, 'getValue3');
  field('PerlinSimplexNoise', 'noiseLevels');
  field('PerlinSimplexNoise', 'highestFreqInputFactor');
  field('PerlinSimplexNoise', 'highestFreqValueFactor');
  field('SimplexNoise', 'xo'); field('SimplexNoise', 'yo'); field('SimplexNoise', 'zo');
  field('Biome', 'TEMPERATURE_NOISE');
  field('Biome', 'FROZEN_TEMPERATURE_NOISE');
  field('Biome', 'BIOME_INFO_NOISE');
  method('Mth', 'getSeed', 3, 'getSeed3');
  // ⚠ 1.18.2's server jar does NOT ship data/minecraft/worldgen/noise/*.json — the sixty
  // parameter sets live in code, in BuiltinRegistries.NOISE, and are only exported by the data
  // generator. Reading them out of the registry is therefore both the only route and the honest
  // one: the amplitudes the golden values were computed from come from the game itself.
  field('BuiltinRegistries', 'NOISE');
  method('Registry', 'get', 1, 'getByLocation', (m) => /ResourceLocation$/.test(m.args[0]));
  // D-235: walked to enumerate all sixty noise parameter sets rather than typing a list out.
  optMethod('Registry', 'keySet', 0, 'keySet0');
  ctor('ResourceLocation', 1, 'string', (m) => m.args[0] === 'java.lang.String');
  field('NoiseParameters', 'firstOctave');
  field('NoiseParameters', 'amplitudes');
  optMethod('Bootstrap', 'bootStrap', 0, 'bootStrap0');
  optMethod('SharedConstants', 'tryDetectVersion', 0, 'tryDetectVersion0');
  ctor('XoroshiroRandomSource', 1, 'long');
  ctor('LegacyRandomSource', 1, 'long');
  optCtor('WorldgenRandom', 1, 'src');
  ctor('ImprovedNoise', 1, 'src');
  ctor('PerlinSimplexNoise', 2, 'srcList', (m) => m.args[1] === 'java.util.List');
  ctor('NoiseParameters', 2, 'intList', (m) => /DoubleList$/.test(m.args[1]));

  if (problems.length) {
    say('NAME RESOLUTION PROBLEMS:');
    for (const p of problems) say('  ! ' + p);
    for (const key of Object.keys(resolved)) {
      const mem = parseMembers(resolved[key]);
      say('  -- ' + key + ' (' + resolved[key].obf + ') fields: ' +
          [...mem.fields].map(([n, f]) => f.type + ' ' + n).join(' | '));
      say('  -- ' + key + ' methods: ' +
          mem.methods.map((m) => m.name + '(' + m.args.map((a) => a.slice(a.lastIndexOf('.') + 1)).join(',') + ')').join(' | ').slice(0, 1800));
    }
  }
  P.push('meta.jarSha1=' + jarSha);
  P.push('meta.innerJarSha1=' + innerSha);
  P.push('meta.mappingsSha1=' + MAP_SHA1);
  P.push('meta.mappingsUrl=' + MAP_URL);
  P.push('meta.java=' + javaLine.replace(/[\\:=]/g, ' '));
  fs.writeFileSync(path.join(WORK, 'names.properties'), P.join('\n') + '\n');
  say('names.properties written: ' + P.length + ' entries');
  if (problems.length) { say('FATAL: refusing to run with unresolved names'); process.exit(3); }

  // ── 4. classpath, compile, run ─────────────────────────────────────────────────────────
  const jars = [INNER];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p); else if (f.name.endsWith('.jar')) jars.push(p);
    }
  })(LIBDIR);
  say('classpath: ' + jars.length + ' jars');
  const CP = jars.join(';');
  const CLASSES = path.join(WORK, 'classes');
  fs.mkdirSync(CLASSES, { recursive: true });

  // ── 4b. THE BYTECODE ITSELF (D-235) ────────────────────────────────────────────────────
  //
  // ⚠ A golden VALUE proves what the game computes; it does not say WHY. D-229's bug was an
  // arithmetic width — `int * int` wrapping at 32 bits before being widened to long — and the
  // only place that fact is written down is the bytecode: `imul` then `i2l` is a 32-bit
  // multiply, `i2l` then `lmul` is a 64-bit one. So the dumper also disassembles the classes
  // whose expressions MC-Lite ports, and the disassembly travels back beside the dump. It is
  // evidence, not input: nothing in the golden file is derived from it.
  const CANDIDATE_JAVAP = [['PATH', 'javap']];
  {
    // ⚠ 'java' on Dan's PC is Oracle's javapath SHIM, and that directory holds java.exe and
    // nothing else — which is why "beside java" found no javap and eleven empty files got
    // written. 'javac' resolves to the real JDK bin, so ask for that one too, and for javap
    // by name in its own right.
    const whereIs = (exe) => {
      const w = spawnSync(process.platform === 'win32' ? 'where' : 'which', [exe], { encoding: 'utf8' });
      return ((w.stdout || '').split(/\r?\n/)[0] || '').trim();
    };
    for (const exe of ['javap', 'javac', 'java']) {
      const line = whereIs(exe);
      if (line) CANDIDATE_JAVAP.push(['beside ' + exe + ' (' + line + ')', path.join(path.dirname(line), 'javap')]);
    }
    if (process.env.JAVA_HOME) CANDIDATE_JAVAP.push(['JAVA_HOME', path.join(process.env.JAVA_HOME, 'bin', 'javap')]);
    // ⚠ and the one that actually works: ASK THE JVM where it lives. `where javap` and
    // `where javac` both come back empty on this PC; `java -XshowSettings:properties` prints
    // java.home, and javap is beside it in bin/.
    {
      const v = spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8' });
      const m = /java\.home\s*=\s*(.+)/.exec((v.stderr || '') + (v.stdout || ''));
      if (m) CANDIDATE_JAVAP.push(['java.home (' + m[1].trim() + ')', path.join(m[1].trim(), 'bin', 'javap')]);
    }
  }
  const JAVAP = path.join(WORK, 'javap');
  fs.mkdirSync(JAVAP, { recursive: true });
  const WIDTH_CLASSES = ['Mth', 'BitRandomSource', 'RandomSource', 'XoroshiroRandomSource',
    'Xoroshiro128PlusPlus', 'LegacyRandomSource', 'WorldgenRandom', 'PositionalRandomFactory',
    'ImprovedNoise', 'PerlinNoise', 'PerlinSimplexNoise'];
  for (const key of WIDTH_CLASSES) {
    const e = resolved[key];
    if (!e) { say('javap: ' + key + ' unresolved, skipped'); continue; }
    // ⚠ `javap` is not necessarily on PATH even when `java` and `javac` are (it was not, the
    // first time this ran, and it failed SILENTLY into eleven empty files). Try both, and say
    // which worked and what the other one did.
    let jp = null, via = '';
    for (const [label, exe] of CANDIDATE_JAVAP) {
      jp = spawnSync(exe, ['-p', '-c', '-cp', CP, e.obf], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      via = label;
      if (!jp.error && jp.status === 0 && (jp.stdout || '').length > 0) break;
    }
    const txt = (jp.stdout || '') + (jp.stderr || '');
    if (!txt.length) say('  javap ' + key + ' produced nothing: via=' + via + ' status=' + jp.status + ' error=' + (jp.error && jp.error.code));
    fs.writeFileSync(path.join(JAVAP, key + '.' + e.obf.replace(/\$/g, '_') + '.txt'), txt);
    say('javap ' + key + ' (' + e.obf + '): ' + txt.length + ' bytes');
  }

  const jc = spawnSync('javac', ['-nowarn', '-cp', CP, '-d', CLASSES, path.join(HERE, 'NoiseDump.java')], { encoding: 'utf8' });
  if (jc.stdout) process.stdout.write(jc.stdout);
  if (jc.stderr) process.stdout.write(jc.stderr);
  if (jc.status !== 0) { say('FATAL: javac exited ' + jc.status); process.exit(4); }
  say('compiled');

  // ⚠ the JSON goes to a FILE, not to stdout: touching `Biome` can start log4j, and a logger
  // writing one line into stdout would corrupt the dump.
  const out = path.join(WORK, 'noise-golden-1.18.2.json');
  const run = spawnSync('java', ['-cp', CLASSES + ';' + CP, 'ngdump.NoiseDump', path.join(WORK, 'names.properties'), out],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stdout.write(run.stderr);
  if (run.status !== 0) { say('FATAL: java exited ' + run.status); process.exit(5); }
  if (!fs.existsSync(out)) { say('FATAL: java wrote no dump'); process.exit(5); }
  const json = fs.readFileSync(out, 'utf8');
  say('dump: ' + out + '  ' + json.length + ' bytes  sha256 ' +
      crypto.createHash('sha256').update(json).digest('hex').slice(0, 16));
  let nvals = 0;
  try { for (const c of JSON.parse(json).cases) nvals += (c.values || []).length; } catch (e) { say('WARNING: output is not valid JSON: ' + e.message); }
  say('cases carry ' + nvals + ' golden values');
  // ⚠ NOT echoed any more (D-235). With all sixty noises the dump is several hundred KB and
  // the job output is not the channel it comes home on — ngwork/ is a synced folder.
  say('the dump and ngwork/javap/*.txt are in ' + WORK + ' — copy them to mclite/tools/golden/');
})();
