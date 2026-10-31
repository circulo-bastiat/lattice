// tools/docrefcheck.mjs - #2636 (Dan, 4 Oct 2026: "kill stale"): the four front-door documents may only name files and
// go.mjs commands that exist. A renamed file or a removed command now fails the lander instead of rotting for weeks
// (4 Oct audit: RUN.md pointed at a wrong SETUP-PC.cmd path; INFRA-V2.md at `go.mjs chain`, deleted long before).
// Checks repo-relative paths under tools/ src/ docs/ .github/ and `go.mjs <command>`; generated and Projects-level files are skipped.
// Anti-vacuity: it must find real references, and a dead path / dead command injected into a document must be flagged.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = ['RUN.md', 'README.md', 'CLAUDE.md', 'FOR-DAN.md'];
const read = (p) => readFileSync(ROOT + p, 'utf8');
const go = read('tools/go.mjs');
const docs = Object.fromEntries(DOCS.map((d) => [d, read(d)]));
const PATH = /^(tools|src|docs|\.github)\/[\w.\-\/]+\.(mjs|js|json|md|yml|cmd|sh|ps1)$/;
export function scan(text, exists, goSrc) {
  const bad = []; let refs = 0;
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const t = m[1].replace(/[.,;:]+$/, '');
    if (PATH.test(t)) { refs++; if (!exists(t)) bad.push(`missing file ${t}`); }
  }
  for (const m of text.matchAll(/go\.mjs (\w[\w-]*)/g)) {
    const c = m[1]; refs++;   // a command is a key of go.mjs's CMDS table (shorthand `check,` or `prep:` or quoted)
    const span = goSrc.slice(goSrc.indexOf('const CMDS = {'), goSrc.indexOf('if (!CMDS[cmd])'));
    if (!new RegExp(`(^|[\\s,{])['"]?${c}['"]?\\s*[:,}]`).test(span)) bad.push(`go.mjs has no command ${c}`);
  }
  return { bad, refs };
}
const exists = (p) => existsSync(ROOT + p);
let refs = 0; const real = [];
for (const [d, t] of Object.entries(docs)) { const r = scan(t, exists, go); refs += r.refs; r.bad.forEach((b) => real.push(`${d}: ${b}`)); }
const BREAKS = [
  ['dead file path', () => scan('see `tools/zz_gone_2636.mjs`', exists, go).bad.length > 0],
  ['dead go.mjs command', () => scan('run `node tools/go.mjs zzgone`', exists, go).bad.length > 0],
  ['dead .github path', () => scan('`.github/workflows/zz_gone.yml`', exists, go).bad.length > 0],
  ['file exists check disabled is noticed', () => scan('`tools/go.mjs`', () => false, go).bad.length > 0],
];
let caught = 0;
for (const [n, f] of BREAKS) { if (f()) { caught++; console.log(`  ✓ break caught: ${n}`); } else console.log(`  ✗ break NOT caught: ${n}`); }
if (refs < 20) real.push(`only ${refs} references found (the scan is vacuous)`);
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`docrefcheck: ${caught} breaks caught (of ${BREAKS.length}); ${refs} references checked`);
console.log(` assertions passed .... ${refs - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
