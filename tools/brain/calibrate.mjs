// #7768 item 4: calibrate the reviewer on known outcomes. Cases = {pr, issue, truth: 'pass'|'mismatch'} (30 landed-and-kept = pass,
// 10 later reverted or bounced = mismatch); verdicts = {pr, model, verdict}. `score` prints precision/recall of `mismatch` per model tier.
//   node tools/brain/calibrate.mjs cases > cases.json      (gh: last 30 merged work/ PRs + 10 reverted/bounced)
//   node tools/brain/calibrate.mjs run cases.json verdicts.jsonl [haiku,sonnet]   (live; resumable)
//   node tools/brain/calibrate.mjs score cases.json verdicts.jsonl
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { buildInput, parseVerdict } from './reviewer.mjs';
import { execFileSync } from 'node:child_process';

export function score(cases, verdicts) {
  const truth = new Map(cases.map((c) => [c.pr, c.truth])), by = {};
  for (const v of verdicts) {
    if (!truth.has(v.pr)) continue;
    const s = (by[v.model] ||= { tp: 0, fp: 0, fn: 0, tn: 0, unclear: 0, n: 0 });
    s.n++;
    const t = truth.get(v.pr);
    if (v.verdict === 'unclear') { s.unclear++; if (t === 'mismatch') s.fn++; continue; }
    if (v.verdict === 'mismatch') t === 'mismatch' ? s.tp++ : s.fp++; else t === 'mismatch' ? s.fn++ : s.tn++;
  }
  for (const s of Object.values(by)) {
    s.precision = s.tp + s.fp ? s.tp / (s.tp + s.fp) : null;
    s.recall = s.tp + s.fn ? s.tp / (s.tp + s.fn) : null;
    s.agreement = s.n ? (s.tp + s.tn) / s.n : null;
  }
  return by;
}

// Cheapest tier whose agreement is within `tol` of the best tier. tiers ordered cheapest first.
export function pickModel(by, tiers = ['haiku', 'sonnet', 'opus'], tol = 0.05) {
  const have = tiers.filter((m) => by[m] && by[m].n);
  if (!have.length) return null;
  const best = Math.max(...have.map((m) => by[m].agreement));
  return have.find((m) => by[m].agreement >= best - tol);
}

export function format(by) {
  return Object.entries(by).map(([m, s]) => `${m}: n=${s.n} agreement=${(s.agreement * 100).toFixed(0)}% mismatch precision=${s.precision == null ? 'n/a' : (s.precision * 100).toFixed(0) + '%'} recall=${s.recall == null ? 'n/a' : (s.recall * 100).toFixed(0) + '%'} unclear=${s.unclear}`).join('\n');
}

const gh = (...a) => JSON.parse(execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 1 << 26 }));
export function collect() {
  const prs = gh('pr', 'list', '--state', 'merged', '--limit', '400', '--json', 'number,title,headRefName,labels,body');
  const issueOf = (p) => +((/^work\/(\d+)-/.exec(p.headRefName) || [])[1] || 0);
  const bad = (p) => /revert|bounce/i.test(p.title) || p.labels.some((l) => /revert|bounce/i.test(l.name));
  const mk = (p, truth) => ({ pr: p.number, issue: issueOf(p), truth });
  const w = prs.filter((p) => issueOf(p));
  const reverted = w.filter(bad).slice(0, 10).map((p) => mk(p, 'mismatch'));
  return [...w.filter((p) => !bad(p)).slice(0, 30).map((p) => mk(p, 'pass')), ...reverted];
}

// No gh on the runner: the same cases from git history. A `land #PR: #ISSUE: ...` commit is a landed PR; it is a mismatch when a later
// commit subject says revert/bounce/undo and names that PR (#PR or `land #PR`). `log` = [{sha, subject}] newest first.
export function collectGit(log, nPass = 30, nBad = 10) {
  const land = log.map((c) => { const m = /^land #(\d+): #(\d+)/.exec(c.subject); return m && { sha: c.sha, pr: +m[1], issue: +m[2] }; }).filter(Boolean);
  const bad = new Set();
  log.forEach((c, i) => { if (!/revert|bounce|undo/i.test(c.subject) || /^land #/.test(c.subject)) return;
    for (const m of c.subject.matchAll(/#(\d+)/g)) if (land.some((l) => l.pr === +m[1] && log.findIndex((x) => x.sha === l.sha) > i)) bad.add(+m[1]); });
  const mk = (l, truth) => ({ pr: l.pr, issue: l.issue, sha: l.sha, truth });
  return [...land.filter((l) => !bad.has(l.pr)).slice(0, nPass).map((l) => mk(l, 'pass')), ...land.filter((l) => bad.has(l.pr)).slice(0, nBad).map((l) => mk(l, 'mismatch'))];
}
export function gitLog() { return execFileSync('git', ['log', '--format=%H%x09%s', '-n', '5000'], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean).map((l) => { const [sha, ...r] = l.split('\t'); return { sha, subject: r.join('\t') }; }); }
export const gitDeps = {
  load: (c) => ({ issueText: execFileSync('git', ['log', '-1', '--format=%B', c.sha], { encoding: 'utf8' }), diff: execFileSync('git', ['show', '--format=', c.sha], { encoding: 'utf8', maxBuffer: 1 << 28 }).slice(0, 60000), checkOutput: '(no check output in git history)' }),
};

// Live run: every case x tier gets a fresh `claude -p` reviewer call; one verdicts.jsonl line each; resumable (done pairs are skipped).
// deps = { load(case) -> {issueText, diff, checkOutput}, ask(model, prompt) -> {text, tokens} }; injected so the check needs no model or gh.
export function promptFor(input) {
  return 'Judge whether the PR does what the issue asks. Answer one word on the first line: pass | mismatch | unclear, then three lines of evidence.\n\nISSUE (with required: list):\n' + input.issue + '\n\nPR DIFF:\n' + input.diff + '\n\nCHECK OUTPUT:\n' + input.checks + '\n';
}
export function runCases(cases, tiers, deps, file) {
  const done = new Set(existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { const v = JSON.parse(l); return v.pr + ':' + v.model; }) : []);
  const out = [];
  for (const c of cases) {
    let input = null;
    for (const model of tiers) {
      if (done.has(c.pr + ':' + model)) continue;
      input ||= buildInput(deps.load(c));
      const r = deps.ask(model, promptFor(input));
      const v = { pr: c.pr, model, verdict: parseVerdict(r.text), tokens: r.tokens || 0 };
      appendFileSync(file, JSON.stringify(v) + '\n'); out.push(v);
    }
  }
  return out;
}
const sh = (c, a, i) => execFileSync(c, a, { encoding: 'utf8', input: i, maxBuffer: 1 << 28 });
export const liveDeps = {
  load: (c) => ({ issueText: sh('gh', ['issue', 'view', String(c.issue), '--json', 'title,body', '--jq', '.title+"\\n"+.body']), diff: sh('gh', ['pr', 'diff', String(c.pr)]).slice(0, 60000), checkOutput: sh('gh', ['pr', 'view', String(c.pr), '--json', 'statusCheckRollup', '--jq', '.statusCheckRollup|tostring']).slice(0, 4000) }),
  ask: (model, prompt) => { const j = JSON.parse(sh('claude', ['-p', '--model', model, '--output-format', 'json', '--max-turns', '1'], prompt)); const u = j.usage || {}; return { text: j.result, tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) }; },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'cases') { let cs; try { cs = collect(); } catch { cs = collectGit(gitLog()); } console.log(JSON.stringify(cs, null, 1)); }
  else if (cmd === 'run') { const n = runCases(JSON.parse(readFileSync(a, 'utf8')), (process.argv[5] || 'haiku,sonnet').split(','), { ask: liveDeps.ask, load: (c) => (c.sha ? gitDeps : liveDeps).load(c) }, b); console.log(n.length + ' verdicts appended to ' + b); }
  else if (cmd === 'score') {
    const by = score(JSON.parse(readFileSync(a, 'utf8')), readFileSync(b, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    console.log(format(by)); console.log('use: ' + pickModel(by));
  } else { console.error('usage: calibrate.mjs cases | score cases.json verdicts.jsonl'); process.exit(2); }
}
