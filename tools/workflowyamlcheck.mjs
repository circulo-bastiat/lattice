// tools/workflowyamlcheck.mjs - 19 Oct (commander): brain.yml's `if:` held an unquoted `from: brain`; YAML reads ': ' inside a plain scalar as a
// nested mapping, GitHub refused the whole file (every push got a 0-job failed run, dispatch 422 'no workflow_dispatch trigger') and no worker
// started for 7 h. This check fails on any .github/workflows/*.yml line whose unquoted plain value contains ': ' (outside quotes, flow braces,
// block scalars). #8979 (Dan, 19 Oct: checks must run the real thing): it ALSO parses every file with a real YAML parser (python3 yaml, else ruby
// Psych; neither = it says so and runs the text scan only, never a silent pass) and asserts what the fill depends on: brain.yml triggers on
// issue_comment and workflow_dispatch (inputs role, reason, account), every job has runs-on (or uses) and steps. Anti-vacuity: it breaks its own data and asserts each break is caught.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const DIR = new URL('../.github/workflows/', import.meta.url);
// #9253: every role any code dispatches brain.yml with (ladder.mjs restart-fill sent 'waker' for days while the choice list had none: GitHub answered 422 and laddercheck's fake gh never noticed)
const CALLERS = ['tools/infra/ladder.mjs', 'tools/brain/brain.mjs'];
const callerRoles = () => { const out = new Map(); for (const f of CALLERS) for (const line of readFileSync(new URL('../' + f, import.meta.url), 'utf8').split('\n')) if (line.includes('brain.yml/dispatches') || /\bstartRole\(|\bstart\(\{/.test(line)) for (const m of line.matchAll(/\brole:\s*'([a-z]+)'/g)) out.set(m[1], f); return out; };
const scan = (name, text) => {
  const bad = []; let block = -1;
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, ''), ind = line.length - line.trimStart().length;
    if (block >= 0) { if (!line.trim() || ind > block) return; block = -1; }
    const m = /^(\s*)(?:- )?([A-Za-z0-9_.\/\-]+|"[^"]*"|'[^']*'):(?:\s+(.*))?$/.exec(line);
    if (!m || m[3] === undefined) return;
    let v = m[3].trim();
    if (/^[|>][+-]?\d*(\s+#.*)?$/.test(v)) { block = ind; return; }
    if (!v || /^["'\[{&*!#]/.test(v)) return;
    v = v.replace(/\s+#.*$/, '');
    if (/:(\s|$)/.test(v)) bad.push(`${name}:${i + 1}: unquoted value contains ': ' (YAML reads a nested mapping): ${v.slice(0, 70)}`);
  });
  return bad;
};

// ---- #8979: a REAL parse. PyYAML / Psych are YAML 1.1, so the `on` key comes back as boolean true.
const PARSERS = [
  ['python3', ['-c', 'import sys,json,yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))']],
  ['ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.safe_load(STDIN.read))']],
];
const ok = (n, a) => { const r = spawnSync(n, a, { input: 'a: 1\n', encoding: 'utf8' }); return r.status === 0 && /"a": ?1/.test(r.stdout || ''); };
const PARSER = PARSERS.find(([n, a]) => ok(n, a));
const parse = (text) => {
  if (!PARSER) return { skipped: true };
  const r = spawnSync(PARSER[0], PARSER[1], { input: text, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) return { error: String(r.stderr || r.error || 'parse failed').trim().split('\n').slice(-1)[0].slice(0, 160) };
  try { return { doc: JSON.parse(r.stdout) }; } catch (e) { return { error: 'parser output unreadable' }; }
};
const structure = (name, text) => {
  const bad = [], p = parse(text);
  if (p.skipped) return bad;
  if (p.error) return [`${name}: does not parse as YAML (${PARSER[0]}): ${p.error}`];
  const d = p.doc;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return [`${name}: top level is not a mapping`];
  const on = d.on !== undefined ? d.on : d.true;
  if (on === undefined || on === null) bad.push(`${name}: no \`on:\` triggers`);
  if (!d.jobs || typeof d.jobs !== 'object' || !Object.keys(d.jobs).length) bad.push(`${name}: no jobs`);
  for (const [j, v] of Object.entries(d.jobs || {})) {
    if (!v || typeof v !== 'object') { bad.push(`${name}: job ${j} is not a mapping`); continue; }
    if (!v.uses && !v['runs-on']) bad.push(`${name}: job ${j} has no runs-on`);
    if (!v.uses && !(Array.isArray(v.steps) && v.steps.length)) bad.push(`${name}: job ${j} has no steps`);
  }
  if (name === 'brain.yml' && on && typeof on === 'object') {
    for (const t of ['issue_comment', 'workflow_dispatch', 'schedule']) if (!(t in on)) bad.push(`brain.yml: no ${t} trigger (the fill and the mail routing need it; a dispatch without it 422s)`);
    const inp = (on.workflow_dispatch || {}).inputs || {};
    for (const k of ['role', 'reason', 'account']) if (!(k in inp)) bad.push(`brain.yml: workflow_dispatch has no input ${k}`);
    const opts = (inp.role || {}).options || [];
    for (const [role, f] of callerRoles()) if (!opts.includes(role)) bad.push(`brain.yml: ${f} dispatches role '${role}' but the workflow_dispatch role options are [${opts.join(', ')}] (GitHub answers 422)`);
    if (!/= waker \]; then[\s\S]*?brain\.mjs fill[\s\S]*?\n\s+else /.test(text)) bad.push("brain.yml: a role=waker dispatch does not run the fill");
  } else if (name === 'brain.yml') bad.push('brain.yml: `on:` is not a mapping');
  return bad;
};
const verdict = (files) => files.flatMap(([f, t]) => [...scan(f, t), ...structure(f, t)]);
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, readFileSync(new URL(f, DIR), 'utf8')]);
const real = verdict(files);
if (!PARSER) console.log(' YAML PARSER UNAVAILABLE (no python3 yaml, no ruby): text scan only, structure and parse checks NOT run');
const brain = (files.find(([f]) => f === 'brain.yml') || [])[1] || '';
const BREAKS = [   // [name, mutate brain.yml, needs a real parser]
  ['plain if containing to: commander', (t) => t.replace(/^(\s+if: )"(.*to: commander.*)"$/m, '$1$2'), false],
  ['plain value with ": "', (t) => t.replace('name: brain', 'name: brain: x'), false],
  ['key with unquoted ": " after list dash', (t) => t.replace('permissions:', 'permissions:\n  - foo: bar: baz'), false],
  ['workflow_dispatch deleted', (t) => t.replace(/^  workflow_dispatch:\n(?:    .*\n)+/m, ''), true],
  ['waker removed from the dispatch role options', (t) => t.replace(/(options: \[[^\]]*), waker\]/, '$1]'), true],
  ['waker dispatch no longer runs the fill', (t) => t.replace(/(= waker \]; then[\s\S]*?)node tools\/brain\/brain\.mjs fill \|\| true/, '$1true'), true],
  ['dispatch input role deleted', (t) => t.replace(/^      role: .*\n/m, ''), true],
  ['issue_comment trigger deleted', (t) => t.replace(/^  issue_comment:\n    types: \[created\]\n/m, ''), true],
  ['tab-indented key', (t) => t.replace('\n  issue_comment:', '\n\tissue_comment:'), true],
  ['route job loses runs-on', (t) => t.replace(/^    runs-on: .*\n/m, ''), true],
  ['unbalanced flow list', (t) => t.replace('types: [created]', 'types: [created'), true],
];
let caught = 0, need = 0;
for (const [n, mk, needsParser] of BREAKS) {
  if (needsParser && !PARSER) continue;
  need++; const b = mk(brain);
  if (b !== brain && verdict([['brain.yml', b]]).length) { caught++; console.log(' ✓ break caught:', n); } else console.log(' NOT CAUGHT:', n);
}
if (!files.length) real.push('no workflow files found');
for (const x of real) console.log(' FAIL:', x);
console.log(`workflowyamlcheck: ${files.length} files (${PARSER ? 'parsed with ' + PARSER[0] : 'text scan only'}), ${real.length} failed; ${caught} breaks caught (of ${need})`);
process.exit(real.length || caught < need ? 1 : 0);
