#!/usr/bin/env node
// fullorderingcheck.mjs - #8195: tools/infra/full.mjs ran its #7765 block `if (!fault) try {...}` ABOVE `const fault = ...` and died with
// "ReferenceError: Cannot access 'fault' before initialization" at the end of EVERY full run from 03:42Z 16 Oct: no red issues, no master-red.
// node --check cannot see a temporal dead zone. This reads the top-level statements of every tools/infra/*.mjs script and fails when a
// statement READS a top-level const/let that is declared by a LATER statement. Function bodies are not scanned (a closure may run late);
// only the head line of a statement that holds an arrow/function, and the whole of a plain statement (if/try/const x = ...).
// ANTI-VACUITY: the old order of full.mjs and a hand-made case must each be caught ("<n> breaks caught").
import { readFileSync, readdirSync } from 'node:fs';
const strip = (l) => l.replace(/\/\*.*?\*\//g, '').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/, '');
export function problems(src, file = '?') {
  const lines = src.split('\n').map(strip), stmts = []; let depth = 0, cur = null;
  lines.forEach((l, i) => {
    if (depth === 0 && l.trim() && !/^\s/.test(l) && !/^[}\])]/.test(l)) { cur = { from: i, lines: [] }; stmts.push(cur); }
    if (cur) cur.lines.push(l);
    for (const ch of l) { if ('({['.includes(ch)) depth++; else if (')}]'.includes(ch)) depth = Math.max(0, depth - 1); }
  });
  const decl = new Map();   // name -> index of the statement that declares it
  stmts.forEach((s, k) => { const m = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(s.lines[0]); if (m && !decl.has(m[1])) decl.set(m[1], k); });
  const out = [];
  stmts.forEach((s, k) => {
    const text = s.lines.join('\n'), closure = /=>|\bfunction\b/.test(text), scan = closure ? s.lines[0] : text;
    const own = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(s.lines[0]);
    if (own && /=>|\bfunction\b/.test(s.lines[0])) return;   // `const f = () => ...`: the body runs when called, not now
    for (const [name, at] of decl) {
      if (at <= k || (own && own[1] === name)) continue;
      const head = own ? scan.slice(scan.indexOf('=')) : scan;
      if (new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(head)) out.push(`${file}:${s.from + 1} reads \`${name}\` before its declaration on line ${stmts[at].from + 1}`);
    }
  });
  return out;
}
const dir = new URL('./infra/', import.meta.url);
let bad = 0, scanned = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) { scanned++; for (const p of problems(readFileSync(new URL(f, dir), 'utf8'), 'tools/infra/' + f)) { bad++; console.log('FAIL ' + p); } }
const full = readFileSync(new URL('./infra/full.mjs', import.meta.url), 'utf8');
const mark = full.indexOf('// #7765'), endm = "} catch (e) { console.log('tia bookkeeping failed (not fatal): ' + e.message); }\n";
const blockEnd = full.indexOf(endm, mark) + endm.length;
const block = full.slice(mark, blockEnd);
const breaks = {
  'the #7765 block back above const fault (the 16 Oct crash)': problems(full.replace(block, '').replace(/^(const faultFile = )/m, block + '$1'), 'full.mjs'),
  'a plain top-level read before a const': problems('if (!x) go();\nconst x = 1;\n', 't.mjs'),
  'a read in a multi-line try block': problems('try {\n  use(y);\n} catch {}\nconst y = 2;\n', 't.mjs'),
};
let caught = 0;
for (const [k, v] of Object.entries(breaks)) { if (v.length) caught++; else { bad++; console.log(`FAIL break not caught: ${k}`); } }
const clean = [problems('const a = 1;\nconst f = () => b;\nconst b = 2;\n', 't.mjs'), problems('const a = 1;\nif (a) { go(a); }\n', 't.mjs')];
clean.forEach((v, i) => { if (v.length) { bad++; console.log(`FAIL false positive ${i}: ${v}`); } });
console.log(bad ? `fullorderingcheck: ${bad} FAILED` : `fullorderingcheck ok: ${scanned} infra scripts clean, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
