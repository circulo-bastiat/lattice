// tools/requestroleCheck.mjs - #7686: the `requests` role is wired (roles.json, wake, workflow, status) and its prompt carries every reversibility rule.
import { readFileSync } from 'node:fs';
const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const verdict = (roles, yml, go, run) => {
  const bad = [], r = JSON.parse(roles), q = r.roles && r.roles.requests, p = (q && q.prompt) || '';
  if (!q) return ['no requests role'];
  if (!/sonnet/i.test(q.model) || q.effort !== 'low') bad.push('requests must be Sonnet at low effort');
  if (!(q.maxPerHour >= 6 && q.maxPerHour <= 20)) bad.push('maxPerHour should be about 12');
  if (!r.roles.worker || r.roles.worker.maxPerHour === undefined) bad.push('worker role missing');
  if (!q.trim || !/Bash/.test(q.trim.tools) || !/Read/.test(q.trim.tools)) bad.push('trimmed tool set must have Bash and Read');
  if (!r.wake || r.wake.requests !== 'requests') bad.push('wake.requests must map to the requests role');
  if (!/options: \[[^\]]*\brequests\b/.test(yml)) bad.push('brain.yml role choice lacks requests');
  const rules = [['go.mjs start/done', /go\.mjs start\/done/], ['never master', /NEVER straight to master/], ['revert PR', /revert PR/], ['undo block first', /FIRST post an undo block/], ['old value + reverse command', /old value and the exact reverse command/], ['_to_delete', /_to_delete\//], ['closed not removed', /closed not removed/], ['irreversible: message', /irreversible: message/], ['type: info', /type: info/], ['undo <id>', /On `undo <id>`/], ['progress comment', /PROGRESS comment[\s\S]*BEFORE the first long step/], ['req:working', /req:working/], ['result + req:done', /request done/], ['dashboard rules', /dashboard[\s\S]*60000/], ['blocked -> thread', /no Questions tab/]];
  for (const [n, re] of rules) if (!re.test(p)) bad.push('prompt lacks rule: ' + n);
  if (!/requests role \(#7686\)/.test(go)) bad.push('go.mjs status does not report the requests role');
  if (!/REQUESTS \(#7686\)/.test(run)) bad.push('RUN.md paragraph missing');
  return bad;
};
const A = [rd('./brain/roles.json'), rd('../.github/workflows/brain.yml'), rd('./go.mjs'), rd('../RUN.md')];
const mut = (i, f) => A.map((x, j) => (j === i ? f(x) : x));
const BREAKS = [
  ['effort high', mut(0, (x) => x.replace(/("requests": \{\s*"model": "sonnet", "effort": ")low/, '$1high'))],
  ['maxPerHour 150', mut(0, (x) => x.replace(/("maxPerHour": )12(, "who": "requests")/, '$1150$2'))],
  ['wake removed', mut(0, (x) => x.replace('"requests": "requests"', '"requestz": "requests"'))],
  ['workflow option gone', mut(1, (x) => x.replace('fixer, requests,', 'fixer,'))],
  ['no progress rule', mut(0, (x) => x.replace('BEFORE the first long step', 'sometime'))],
  ['no undo-first rule', mut(0, (x) => x.replace('FIRST post an undo block', 'post'))],
  ['no _to_delete rule', mut(0, (x) => x.replace('_to_delete/', 'x/'))],
  ['no irreversible mail rule', mut(0, (x) => x.replace('irreversible: message', 'x'))],
  ['status silent', mut(2, (x) => x.replace('requests role (#7686)', 'x'))],
];
const real = verdict(...A); let caught = 0;
for (const [n, a] of BREAKS) { if (verdict(...a).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`requestroleCheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
