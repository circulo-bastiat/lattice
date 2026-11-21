// tools/importscheck.mjs - a function that another tools/ module exports must be IMPORTED before this file calls it.
// 22 Oct: launch.mjs called classifyBlocker/planGap/gapBody (tools/infra/envgap.mjs) with no import. The call sat inside a try/catch that only logs, so
// the whole env-gap hold (#9376) was a ReferenceError at runtime for a day while envgapcheck (a text regex) and brainsyntaxcheck (node --check) stayed green.
// Scans tools/brain, tools/infra and tools/go.mjs: strings and comments are blanked, then every call to a name another file exports must be imported,
// declared or a parameter in the calling file.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['tools/brain', 'tools/infra'];
export function blank(src) {                       // code with comments and string text blanked; ${...} inside templates stays code
  let o = '', i = 0, n = src.length; const st = [];  // st: stack of template-brace depths
  let prev = '';                                    // last significant char, to tell a regex literal from a division
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') o += '\n'; i++; } i += 2; continue; }
    if (c === "'" || c === '"') { const q = c; o += q; i++; while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } o += q; i++; prev = q; continue; }
    if (c === '`') { o += '`'; i++; while (i < n && src[i] !== '`') { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '$' && src[i + 1] === '{') { o += '${'; i += 2; let dep = 1; let code = ''; while (i < n && dep) { if (src[i] === '{') dep++; else if (src[i] === '}') { dep--; if (!dep) break; } code += src[i]; i++; } o += blank(code) + '}'; i++; continue; } if (src[i] === '\n') o += '\n'; i++; } o += '`'; i++; prev = '`'; continue; }
    if (c === '/' && /[(,=:[!&|?{};]|^$/.test(prev) ) { o += '/'; i++; let cls = false; while (i < n && (src[i] !== '/' || cls) && src[i] !== '\n') { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; } o += '/'; i++; while (/[a-z]/.test(src[i] || '')) i++; prev = '/'; continue; }
    o += c; if (!/\s/.test(c)) prev = c; i++;
  }
  return o;
}
const ID = '[A-Za-z_$][\\w$]*';
export function exportsOf(code) {
  const out = new Set();
  for (const m of code.matchAll(new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+(${ID})`, 'g'))) out.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) for (const p of m[1].split(',')) { const nm = p.trim().split(/\s+as\s+/).pop(); if (nm) out.add(nm); }
  return out;
}
export function localNames(code) {                 // imported, declared, destructured, parameters, catch bindings
  const s = new Set(); const add = (t) => { for (const p of t.split(',')) { const nm = p.replace(/=.*$/s, '').replace(/^\s*\.\.\./, '').trim().split(/\s*:\s*/).pop().trim(); if (new RegExp(`^${ID}$`).test(nm)) s.add(nm); } };
  for (const m of code.matchAll(/import\s*([^;]*?)\s*from\s*['"]/gs)) { const h = m[1]; const b = h.match(/\{([^}]*)\}/s); if (b) for (const p of b[1].split(',')) { const nm = p.trim().split(/\s+as\s+/).pop(); if (nm) s.add(nm); } const rest = h.replace(/\{[^}]*\}/s, ''); const ns = rest.match(/\*\s*as\s+(\S+)/); if (ns) s.add(ns[1]); const df = rest.replace(/\*\s*as\s+\S+/, '').replace(/,/g, ' ').trim(); if (df && new RegExp(`^${ID}$`).test(df)) s.add(df); }
  for (const m of code.matchAll(new RegExp(`(?:function\\*?|class)\\s+(${ID})`, 'g'))) s.add(m[1]);
  for (const m of code.matchAll(new RegExp(`(?:const|let|var)\\s+(${ID})`, 'g'))) s.add(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s*([[{][^=]*?[\]}])\s*=/gs)) add(m[1].replace(/[[\]{}]/g, ','));
  for (const m of code.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) add(m[1].replace(/[[\]{}]/g, ','));
  for (const m of code.matchAll(new RegExp(`(${ID})\\s*=>`, 'g'))) s.add(m[1]);
  for (const m of code.matchAll(new RegExp(`catch\\s*\\(\\s*(${ID})`, 'g'))) s.add(m[1]);
  for (const m of code.matchAll(new RegExp(`[({,]\\s*(${ID})\\s*(?=[,})]|=(?!=))`, 'g'))) s.add(m[1]);   // destructured / defaulted parameters: ({ gh, now = Date.now() }) and (run, log)
  return s;
}
export function missing(files) {                   // files: { 'tools/brain/x.mjs': source }  ->  [ 'file: name(...) at line N ...' ]
  const code = {}; const exp = {}; const all = new Map();
  for (const [f, s] of Object.entries(files)) { code[f] = blank(s); exp[f] = exportsOf(code[f]); for (const nm of exp[f]) { if (!all.has(nm)) all.set(nm, []); all.get(nm).push(f); } }
  const bad = [];
  for (const [f, c] of Object.entries(code)) {
    const mine = localNames(c);
    for (const [nm, from] of all) {
      if (mine.has(nm) || exp[f].has(nm)) continue;
      const re = new RegExp(`(?<![.\\w$])${nm.replace(/\$/g, '\\$')}\\s*\\(`, 'g'); let m, lines = [];
      while ((m = re.exec(c))) { const before = c.slice(Math.max(0, m.index - 12), m.index); if (/(?:function\*?|class|new)\s*$/.test(before) && !/new\s*$/.test(before)) continue; lines.push(c.slice(0, m.index).split('\n').length); }
      if (lines.length) bad.push(`${f}: ${nm}() called at line ${lines.slice(0, 3).join(',')} but not imported (exported by ${from[0]})`);
    }
  }
  return bad;
}
export function load() {
  const files = {};
  for (const d of DIRS) for (const f of readdirSync(join(ROOT, d)).filter((x) => x.endsWith('.mjs') && !/\.brainrunscheck-/.test(x))) { try { files[`${d}/${f}`] = readFileSync(join(ROOT, d, f), 'utf8'); } catch {} }
  files['tools/go.mjs'] = readFileSync(join(ROOT, 'tools/go.mjs'), 'utf8');
  return files;
}
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/importscheck.mjs')) {
  const files = load(); const bad = missing(files);
  for (const b of bad) console.log(' \u2717 ' + b);
  // anti-vacuity: the scanner must catch the real mistake and must stay quiet on the legitimate shapes
  let caught = 0, wrong = 0; const fx = (src) => missing({ 'a.mjs': 'export function f() {}', 'b.mjs': src });
  const must = [
    ['the real launch.mjs without its envgap import', () => missing({ ...files, 'tools/brain/launch.mjs': files['tools/brain/launch.mjs'].replace(/^import \{ classifyBlocker[^\n]*\n/m, '') }).some((x) => /launch\.mjs: classifyBlocker/.test(x))],
    ['a bare call, no import', () => fx('f();').length === 1],
    ['a call inside a try/catch that only logs', () => fx('try { f(1); } catch (e) { console.log(e.message); }').length === 1],
    ['a call in a template expression', () => fx('const x = `${f(1)}`;').length === 1],
  ];
  const quiet = [
    ['imported', () => fx("import { f } from './a.mjs'; f();").length === 0],
    ['imported with an alias', () => fx("import { f as g } from './a.mjs'; g();").length === 0 && fx("import { f as g } from './a.mjs'; f();").length === 1],
    ['an injected parameter with a default', () => fx('export async function s({ f, now = Date.now() }) { await f(); }').length === 0],
    ['a plain parameter', () => fx('const w = (f, log) => f();').length === 0],
    ['a local declaration', () => fx('function f() {} f();').length === 0],
    ['a call in a comment or a string', () => fx("// f();\nconst s = 'f()';\n/* f() */").length === 0],
    ['a method call', () => fx('x.f();').length === 0],
  ];
  for (const [n, t] of must) { if (t()) caught++; else { wrong++; console.log(' NOT CAUGHT: ' + n); } }
  for (const [n, t] of quiet) { if (t()) caught++; else { wrong++; console.log(' FALSE ALARM / MISS: ' + n); } }
  console.log(`importscheck: ${Object.keys(files).length} files, ${bad.length} unimported call(s), ${caught} breaks caught (of ${must.length + quiet.length})`);
  process.exit(bad.length || wrong ? 1 : 0);
}
