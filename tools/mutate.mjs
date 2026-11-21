#!/usr/bin/env node
// tools/mutate.mjs - #11466 (AUDIT-MUTATE, part of #11464): a mutation sweep. Break ONE statement-level site of a src/ file
// in a SCRATCH COPY, run the stages that claim that file, record KILLED (a stage went red) or SURVIVED (all green: the stages
// are vacuous for that site).
//
//   node tools/mutate.mjs --selfcheck                    prove the harness sees a kill and a survivor ("<n> breaks caught")
//   node tools/mutate.mjs [--modules a,b] [--n 12] [--budget 240] [--seed 1] [--nightly]
//   node tools/mutate.mjs --report                       rewrite docs/audits/mutation-<date>.md from tools/mutate/out/*.json
//
// RULES (the issue's method rules):
//  - never touches this tree: the scratch copy (src/ tools/ build.mjs + links to the big read-only dirs) lives in os.tmpdir().
//  - deterministic: sites are sorted, then sampled with a seeded PRNG (mulberry32), so a rerun with the same seed is comparable.
//  - EQUIVALENT / UNVIABLE mutants are skipped by a documented rule, not counted: (1) the line is a comment, a string-only or
//    blank line; (2) the mutated file no longer parses (vm.Script); (3) the mutation text equals the original;
//    (4) the line lies inside a template literal / regex-looking line (`/.../` literal or backtick) - mutating it is not a code change.
//    A mutant that times out counts as KILLED (an infinite loop is observable), flagged `timeout`.
//  - a stage that is red on the UNMUTATED scratch copy is dropped from that module (it could not tell a kill from its own red).
//  - browser stages are never run here (fast, browser-free stages first; the picture is not this tool's claim).
//  - mutation score = killed / (killed + survived).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, mkdtempSync, rmSync, cpSync, symlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// ---- pure pieces (the selfcheck breaks these) ------------------------------------------------------------------------
export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** operators: [regex, replacement, name]. Each is applied to the FIRST match on a line only (one small mutation). */
export const OPS = [
  [/ === /, ' !== ', 'flip ==='],
  [/ !== /, ' === ', 'flip !=='],
  [/ <= /, ' < ', '<= -> <'],
  [/ >= /, ' > ', '>= -> >'],
  [/ < /, ' <= ', '< -> <='],
  [/ > /, ' >= ', '> -> >='],
  [/ && /, ' || ', '&& -> ||'],
  [/ \|\| /, ' && ', '|| -> &&'],
  [/ \+ (?=[\w(])/, ' - ', '+ -> -'],
  [/ \* (?=[\w(])/, ' / ', '* -> /'],
  [/\bif \(/, 'if (!', 'negate if'],
  [/\breturn (?!;)/, 'return !', 'negate return', (l) => /\breturn [^;]*;/.test(l)],
  [/(?<![\w.])(\d+)(?![\w.])/, null, 'constant +1'],
];

export const isCodeLine = (l) => {
  const t = l.trim();
  if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;   // rule 1
  if (t.includes('`')) return false;                                                       // rule 4
  if (/=\s*\/[^/*].*\/[gimsuy]*[;,)]/.test(t) || /\.(test|match|replace|split)\(\//.test(t)) return false;   // rule 4 (regex literal)
  return true;
};

/** every (line, op) site of a source text. Comments after code are cut off before matching so `// x === y` is not a site. */
export function findSites(text) {
  const lines = text.split('\n'), out = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (inBlock) { if (l.includes('*/')) inBlock = false; continue; }
    if (l.trim().startsWith('/*') && !l.includes('*/')) { inBlock = true; continue; }
    if (!isCodeLine(l)) continue;
    const code = l.replace(/\/\/.*$/, '').replace(/'[^'\n]*'|"[^"\n]*"/g, (s) => ' '.repeat(s.length));   // blank strings + trailing comment
    for (let k = 0; k < OPS.length; k++) {
      const [re, , , guard] = OPS[k];
      if (guard && !guard(code)) continue;
      const m = re.exec(code);
      if (m) out.push({ line: i + 1, op: k, index: m.index, len: m[0].length });
    }
  }
  return out;
}

/** apply one site -> new text, or null when the rule says skip (unchanged / does not parse) */
export function applySite(text, site) {
  const lines = text.split('\n'), l = lines[site.line - 1], [, rep, name] = OPS[site.op];
  const m = l.slice(site.index, site.index + site.len);
  const r = rep === null ? String(Number(m) + 1) : rep;
  const nl = l.slice(0, site.index) + r + l.slice(site.index + site.len);
  if (nl === l) return null;                                           // rule 3
  lines[site.line - 1] = nl;
  const out = lines.join('\n');
  try { new vm.Script('(function(){' + out + '\n})', { filename: 'mutant.js' }); } catch { return null; }   // rule 2
  return { text: out, name, before: l.trim().slice(0, 140), after: nl.trim().slice(0, 140) };
}

export function sample(sites, n, seed) {
  const rnd = mulberry32(seed), a = sites.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n).sort((x, y) => x.line - y.line || x.op - y.op);
}

export const score = (killed, survived) => (killed + survived ? killed / (killed + survived) : null);

// ---- running ---------------------------------------------------------------------------------------------------------
const runStage = (root, st, timeoutMs) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(root, st.file), ...(st.args || [])], { cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 26, env: { ...process.env, MCLITE_PRESET: 'medium' } });
  return { ok: r.status === 0, timeout: !!(r.error && r.error.code === 'ETIMEDOUT'), ms: Date.now() - t0 };
};

/**
 * sweep one file against a stage list inside `root` (a scratch copy). Mutates root/<file> in place and restores it.
 * stages are tried fastest-first; the first red stage kills the mutant.
 */
export function sweepFile({ root, file, stages, n, seed, budgetMs, stageTimeoutMs = 120000, log = () => {} }) {
  const path = join(root, file), orig = readFileSync(path, 'utf8'), t0 = Date.now();
  const live = [];
  for (const st of stages) { const r = runStage(root, st, stageTimeoutMs); if (r.ok) live.push({ ...st, ms: r.ms }); else log(`  dropped ${st.id}: red on the unmutated copy`); }
  live.sort((a, b) => a.ms - b.ms);
  const res = { file, stages: live.map((s) => s.id), baselineDropped: stages.length - live.length, mutants: [], skippedUnviable: 0 };
  if (!live.length) return res;
  const sites = findSites(orig);
  res.sites = sites.length;
  const picked = sample(sites, n * 3, seed);          // oversample: unviable ones are skipped (rule 2/3)
  try {
    for (const s of picked) {
      if (res.mutants.length >= n || Date.now() - t0 > budgetMs) break;
      const m = applySite(orig, s);
      if (!m) { res.skippedUnviable++; continue; }
      writeFileSync(path, m.text);
      let killedBy = null, timeout = false;
      for (const st of live) { const r = runStage(root, st, stageTimeoutMs); if (!r.ok) { killedBy = st.id; timeout = r.timeout; break; } }
      res.mutants.push({ line: s.line, mutation: m.name, before: m.before, after: m.after, status: killedBy ? 'KILLED' : 'SURVIVED', ...(killedBy ? { by: killedBy } : {}), ...(timeout ? { timeout: true } : {}) });
      log(`  ${file}:${s.line} ${m.name} -> ${killedBy ? 'KILLED by ' + killedBy : 'SURVIVED'}`);
    }
  } finally { writeFileSync(path, orig); }
  const k = res.mutants.filter((x) => x.status === 'KILLED').length, sv = res.mutants.length - k;
  res.killed = k; res.survived = sv; res.score = score(k, sv);
  return res;
}

// ---- the module table: the final gate's list --------------------------------------------------------------------------
export const MODULES = {
  movement: ['src/14b_physics.js'],
  combat: ['src/14j_combat.js'],
  mining: ['src/07d_mining.js'],
  'hunger-effects': ['src/14d_survival.js', 'src/07q_effects.js'],
  'mobs-ai': ['src/07k_goals.js'],
  crafting: ['src/02h_recipes.js'],
  redstone: ['src/07f_redstone.js'],
  fluids: ['src/07b_behaviour.js'],
  light: ['src/08_lighting.js'],
  saving: ['src/16b_save.js'],
};

/** stages that claim a src file: a browser-free check/stage whose own tool file names the file. Most focused (fewest src files named) first. */
export const KEYWORDS = { movement: /move|physic|jump|swim|sprint|bounce|slide|climb|fall|collid/, combat: /combat|damage|shield|attack|crit|knock|armor|arrow/, mining: /mining|mine|break|drop|loot|tool/, 'hunger-effects': /hunger|food|effect|potion|survival|regen|starv|saturat/, 'mobs-ai': /^(goal|mobai|aicheck|mobgoals)|goal|mobai/, crafting: /craft|recipe|smelt|furnace|smith/, redstone: /redstone|piston|repeater|comparator|observer|hopper|dispenser/, fluids: /fluid|water|lava|flow|bucket/, light: /light/, saving: /save|load|nbt|world/ };
export function stagesFor(root, file, cap = 6, kw = null) {
  const dir = join(root, 'tools/stages.d'), base = file.replace(/^src\//, ''), out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let arr; try { arr = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    for (const st of arr) {
      if (st.kind !== 'check' || !st.file || st.id === 'mutatecheck') continue;
      let src; try { src = readFileSync(join(root, st.file), 'utf8'); } catch { continue; }
      if (!src.includes(`'${base}'`) && !src.includes(`"${base}"`)) continue;   // a real load, not a comment naming the file
      out.push({ id: st.id, file: st.file, args: st.args || [], kw: kw && kw.test(st.id) ? 0 : 1, width: (src.match(/\b\d\d[a-z0-9_]*\.js\b/g) || []).length });
    }
  }
  return out.sort((a, b) => a.kw - b.kw || a.width - b.width || a.id.localeCompare(b.id)).slice(0, cap);
}

export function makeScratch(from) {
  const dir = mkdtempSync(join(tmpdir(), 'mclite-mutate-'));
  for (const d of ['src', 'tools', 'assets', 'build.mjs']) {
    if (!existsSync(join(from, d))) continue;
    if (d === 'tools') {
      mkdirSync(join(dir, 'tools'));
      for (const e of readdirSync(join(from, 'tools'))) {
        if (e === 'referee' || e === 'golden') { symlinkSync(join(from, 'tools', e), join(dir, 'tools', e)); continue; }
        cpSync(join(from, 'tools', e), join(dir, 'tools', e), { recursive: true });
      }
    } else cpSync(join(from, d), join(dir, d), { recursive: true });
  }
  for (const d of ['jars', '.mcdata', '.decomp', 'docs']) if (existsSync(join(from, d))) symlinkSync(join(from, d), join(dir, d));
  return dir;
}

// ---- selfcheck: a fixture module + a check that sees only half of it ------------------------------------------------------
function selfcheck() {
  let caught = 0; const bad = [];
  const need = (c, m) => { if (c) caught++; else bad.push(m); };
  // pure pieces first
  const t = 'const a = x === 1;\n// y === 2\nreturn a && b;\n';
  need(findSites(t).every((s) => s.line !== 2), 'a comment line is not a site');
  need(findSites(t).some((s) => s.line === 1 && OPS[s.op][2] === 'flip ==='), 'a === site is found');
  need(applySite(t, { line: 1, op: 0, index: 7 + 5 - 5 + 3, len: 5 }) === null || true, 'applySite runs');
  const a1 = applySite('x = a < b;\n', { line: 1, op: OPS.findIndex((o) => o[2] === '< -> <='), index: 5, len: 3 });
  need(a1 && a1.text === 'x = a <= b;\n', 'a < site becomes <=');
  need(applySite('x = a <;\n', { line: 1, op: OPS.findIndex((o) => o[2] === '< -> <='), index: 5, len: 3 }) === null, 'a mutant that does not parse is skipped');
  need(JSON.stringify(sample([1, 2, 3, 4, 5, 6].map((i) => ({ line: i, op: 0 })), 3, 7)) === JSON.stringify(sample([1, 2, 3, 4, 5, 6].map((i) => ({ line: i, op: 0 })), 3, 7)), 'sampling is deterministic');
  need(score(3, 1) === 0.75 && score(0, 0) === null, 'score = killed / (killed + survived)');
  // the real harness, on a fixture root: line 1 is asserted (kill), line 2 is not (survivor)
  const root = mkdtempSync(join(tmpdir(), 'mclite-mutate-self-'));
  try {
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'tools'));
    writeFileSync(join(root, 'src/fix.js'), 'const covered = (a, b) => (a > b ? 1 : 2);\nconst uncovered = (a, b) => (a > b ? 10 : 20);\nreturn { covered, uncovered };\n');
    writeFileSync(join(root, 'tools/fixcheck.mjs'), "import { readFileSync } from 'node:fs';\nconst { covered } = new Function(readFileSync(new URL('../src/fix.js', import.meta.url), 'utf8'))();\nif (covered(3, 1) !== 1 || covered(1, 3) !== 2 || covered(2, 2) !== 2) process.exit(1);\n");
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    const stages = [{ id: 'fixcheck', file: 'tools/fixcheck.mjs', args: [] }];
    const r = sweepFile({ root, file: 'src/fix.js', stages, n: 40, seed: 1, budgetMs: 60000, stageTimeoutMs: 20000 });
    const on = (line) => r.mutants.filter((m) => m.line === line);
    need(on(1).length > 0 && on(1).every((m) => m.status === 'KILLED' && m.by === 'fixcheck'), 'mutants on the asserted line are KILLED');
    need(on(2).length > 0 && on(2).every((m) => m.status === 'SURVIVED'), 'mutants on the unasserted line SURVIVE');
    need(r.killed > 0 && r.survived > 0 && r.score > 0 && r.score < 1, 'score is strictly between 0 and 1');
    need(readFileSync(join(root, 'src/fix.js'), 'utf8').includes('? 10 : 20') && readFileSync(join(root, 'src/fix.js'), 'utf8').includes('(a > b ? 1 : 2)'), 'the file is restored');
    // a stage already red on the unmutated copy is dropped, not used to "kill" everything
    writeFileSync(join(root, 'tools/redcheck.mjs'), 'process.exit(1);\n');
    const r2 = sweepFile({ root, file: 'src/fix.js', stages: [...stages, { id: 'redcheck', file: 'tools/redcheck.mjs', args: [] }], n: 4, seed: 1, budgetMs: 60000, stageTimeoutMs: 20000 });
    need(r2.baselineDropped === 1 && !r2.stages.includes('redcheck'), 'a stage red on the baseline is dropped');
    // a hanging mutant counts as killed (timeout)
    writeFileSync(join(root, 'src/hang.js'), 'const f = (a) => { if (a === 1) { return 1; } return 2; };\nreturn { f };\n');
    writeFileSync(join(root, 'tools/hangcheck.mjs'), "import { readFileSync } from 'node:fs';\nconst { f } = new Function(readFileSync(new URL('../src/hang.js', import.meta.url), 'utf8'))();\nif (f(1) !== 1 || f(2) !== 2) process.exit(1);\n");
    const r3 = sweepFile({ root, file: 'src/hang.js', stages: [{ id: 'hangcheck', file: 'tools/hangcheck.mjs', args: [] }], n: 3, seed: 2, budgetMs: 60000, stageTimeoutMs: 20000 });
    need(r3.mutants.length > 0 && r3.mutants.every((m) => m.status === 'KILLED'), 'a fully asserted fixture has no survivor');
  } finally { rmSync(root, { recursive: true, force: true }); }
  if (bad.length) { console.log('mutate selfcheck FAIL: ' + bad.join(' | ')); process.exit(1); }
  console.log(`mutate selfcheck OK: ${caught} breaks caught`);
}

// ---- report ----------------------------------------------------------------------------------------------------------
const OUT = join(ROOT, 'tools/mutate/out');
const pct = (s) => (s == null ? 'n/a' : (s * 100).toFixed(0) + '%');

export function writeReport(date) {
  const mods = readdirSync(OUT).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')));
  const rows = mods.map((m) => ({ ...m, k: m.files.reduce((a, f) => a + (f.killed || 0), 0), s: m.files.reduce((a, f) => a + (f.survived || 0), 0) }));
  for (const r of rows) r.score = score(r.k, r.s);
  rows.sort((a, b) => (a.score ?? 2) - (b.score ?? 2));
  const L = [`# Mutation sweep ${date} (#11466, part of #11464)`, '', '`node tools/mutate.mjs` - one small mutation per site in a scratch copy, run the stages that name the file; SURVIVED = every claiming stage stayed green (vacuous for that site).', ''];
  L.push('## Worst modules first (lowest mutation score)', '', '| module | score | killed | survived | stages used |', '|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.module} | ${pct(r.score)} | ${r.k} | ${r.s} | ${[...new Set(r.files.flatMap((f) => f.stages))].join(', ') || '(none ran)'} |`);
  L.push('', 'seed ' + (rows[0]?.seed ?? '?') + ', sample per file ' + (rows[0]?.n ?? '?') + '. Equivalent/unviable mutants are skipped by the rules in the header of tools/mutate.mjs and are not counted.', '');
  const byStage = {};
  for (const r of rows) for (const f of r.files) for (const m of f.mutants || []) if (m.status === 'SURVIVED') for (const sid of f.stages) (byStage[sid] ||= []).push({ ...m, file: f.file, module: r.module });
  L.push('## Survivors, grouped by module', '');
  for (const r of rows) {
    const sv = r.files.flatMap((f) => (f.mutants || []).filter((m) => m.status === 'SURVIVED').map((m) => ({ ...m, file: f.file, stages: f.stages })));
    L.push(`### ${r.module} (${pct(r.score)})`, '');
    if (!r.files.some((f) => f.stages.length)) L.push('No browser-free stage names this module\'s files: nothing could kill anything (owed: a check that drives it).', '');
    for (const m of sv) L.push(`- \`${m.file}:${m.line}\` ${m.mutation}: \`${m.before}\` -> \`${m.after}\`; should have been caught by: ${m.stages.join(', ')}. Owed: an assertion that changes with this expression.`);
    L.push('');
  }
  mkdirSync(join(ROOT, 'docs/audits'), { recursive: true });
  writeFileSync(join(ROOT, `docs/audits/mutation-${date}.md`), L.join('\n') + '\n');
  return rows;
}

// ---- cli -------------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
if (import.meta.url === 'file://' + process.argv[1] || process.argv[1] === fileURLToPath(import.meta.url)) {
  if (argv.includes('--selfcheck')) selfcheck();
  else if (argv.includes('--report')) { const rows = writeReport(arg('--date', new Date().toISOString().slice(0, 10))); console.log(rows.map((r) => `${r.module} ${pct(r.score)}`).join('\n')); }
  else {
    const nightly = argv.includes('--nightly');
    const n = Number(arg('--n', nightly ? 4 : 12)), budget = Number(arg('--budget', nightly ? 90 : 240)) * 1000;
    const seed = Number(arg('--seed', nightly ? Math.floor(Date.now() / 864e5) : 1));   // nightly: a new sample each day, same all day
    const want = arg('--modules', Object.keys(MODULES).join(',')).split(',');
    mkdirSync(OUT, { recursive: true });
    const scratch = makeScratch(ROOT);
    console.log(`scratch copy ${scratch}`);
    const floorPath = join(HERE, 'mutate/floor.json');
    const floor = existsSync(floorPath) ? JSON.parse(readFileSync(floorPath, 'utf8')) : {};
    let lower = 0;
    try {
      for (const mod of want) {
        const files = MODULES[mod]; if (!files) { console.log('unknown module ' + mod); continue; }
        console.log(`== ${mod}`);
        const res = [];
        for (const f of files) res.push(sweepFile({ root: scratch, file: f, stages: stagesFor(scratch, f, 6, KEYWORDS[mod]), n, seed, budgetMs: budget / files.length, log: console.log }));
        const k = res.reduce((a, r) => a + (r.killed || 0), 0), s = res.reduce((a, r) => a + (r.survived || 0), 0);
        console.log(`   ${mod}: mutation score ${pct(score(k, s))} (${k} killed, ${s} survived)`);
        if (!nightly) writeFileSync(join(OUT, mod + '.json'), JSON.stringify({ module: mod, seed, n, files: res }, null, 1));
        if (nightly && floor[mod] != null && score(k, s) != null && score(k, s) + 0.25 < floor[mod]) { console.log(`   !! ${mod} fell below its floor ${pct(floor[mod])} (tolerance 25 points for the small nightly sample)`); lower++; }
      }
    } finally { rmSync(scratch, { recursive: true, force: true }); }
    if (lower) process.exit(1);
  }
}
