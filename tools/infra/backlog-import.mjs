// tools/infra/backlog-import.mjs [--apply] - one-time move of the backlog into GitHub Issues (INFRA-V2 §B).
// Milestones sort by their leading number = Track G phase order (Dan, 28 Sept: "in order as the phases were
// ordered ... for some reason we postponed a lot of work"). Without --apply it writes the plan to
// .ledger/backlog-plan.json and prints a summary, so it can be read before anything is created.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gh, ghAll, ROOT } from './gh.mjs';

const Q = readFileSync(join(ROOT, 'docs/archive/QUEUE.md'), 'utf8');
const P = readFileSync(join(ROOT, 'docs/archive/PLAN.md'), 'utf8');
const KW = readFileSync(join(ROOT, 'docs/archive/KNOWN-WRONG.md'), 'utf8');
const ORDER = ['G7', 'G17', 'G17d', 'G17e', 'G18a', 'G18b', 'G18c', 'G18f', 'G19b', 'G19c', 'G19d', 'G19e', 'G20', 'G21',
  'G22', 'G23', 'G24', 'G25', 'G26', 'G27'];
const plan = { milestones: [], issues: [] };
const ms = (key, title, desc) => { const t = `${String(plan.milestones.length).padStart(2, '0')} ${key} — ${title}`; plan.milestones.push({ title: t, description: desc.slice(0, 700) }); return t; };

// 00: infra first (it is what makes everything after it cheap), then debts in FINISHED phases (earliest by definition)
const mi = ms('INFRA', 'infrastructure v2', 'docs/INFRA-V2.md, top-down.');
plan.issues.push({ title: 'Infrastructure v2 (docs/INFRA-V2.md)', milestone: mi, labels: ['dan'], body: 'Work docs/INFRA-V2.md top-down; strike lines in place. RUN.md is the target shape.' });
const mb = ms('BUGS', 'open bugs in finished phases', 'Every open KNOWN-WRONG entry. A finished phase with a bug is the earliest unfinished work there is.');
for (const m of KW.matchAll(/^### (KW-\d+) open (\w+) — (.+)\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)) {
  plan.issues.push({ title: `${m[1]}: ${m[3].replace(/\s*\(.*?\)\s*$/, '').slice(0, 110)}`, milestone: mb,
    labels: ['bug', ...(m[2] === 'severe' ? ['severe'] : []), ...(/Dan/.test(m[3]) ? ['dan'] : [])], body: m[4].trim().slice(0, 6000) });
}
// the phases, in order. A phase with a QUEUE section: its unstruck units, each an issue with the section as spec.
for (const g of ORDER) {
  const head = P.match(new RegExp(`^#{3,4} [^\\n]*?\\b${g}\\b[^\\n]*$`, 'm'));
  if (head && /✅/.test(head[0])) continue;
  const title = head ? head[0].replace(/^#+\s*[☐◐✅]?\s*/, '').replace(new RegExp(`^${g}\\s*[—-]\\s*`), '').replace(/\*\*/g, '').split(/ — | \(|\. /)[0].slice(0, 70) : g;
  const sec = Q.match(new RegExp(`^## \\d+ — ${g}:[^\\n]*\\n([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  const planSec = head ? P.slice(head.index, head.index + 5000).split(/\n(?=#{2,4} )/)[0] : '';
  const spec = (sec ? sec[1] : planSec).trim();
  const m = ms(g, title, spec);
  const units = sec && (sec[1].match(/\*\*Units:\*\*([\s\S]*?)(?:\n\n|$)/) || [])[1];
  const open = units ? units.replace(/\n/g, ' ').split(/\s·\s/).map((u) => u.trim()).filter((u) => u && !/^~~/.test(u)).map((u) => u.replace(/\*\*|▶/g, '').trim()) : [];
  if (open.length) for (const u of open) plan.issues.push({ title: `${g}: ${u.slice(0, 110)}`, milestone: m, labels: [], body: `Unit of ${g}. The phase spec:\n\n${spec.slice(0, 6000)}` });
  else plan.issues.push({ title: `${g}: ${title} (whole phase — split it into issues as the first step)`, milestone: m, labels: [], body: spec.slice(0, 6000) });
}
mkdirSync(join(ROOT, '.ledger'), { recursive: true });
writeFileSync(join(ROOT, '.ledger/backlog-plan.json'), JSON.stringify(plan, null, 1));
console.log(`${plan.milestones.length} milestones, ${plan.issues.length} issues`);
for (const m of plan.milestones) console.log(`  ${m.title}  (${plan.issues.filter((i) => i.milestone === m.title).length})`);

if (process.argv.includes('--apply')) {
  const have = await ghAll('/repos/{repo}/milestones?state=all');
  const id = {};
  for (const m of plan.milestones) id[m.title] = (have.find((h) => h.title === m.title) || await gh('POST', '/repos/{repo}/milestones', m)).number;
  const labels = new Set((await ghAll('/repos/{repo}/labels')).map((l) => l.name));
  for (const [n, c] of [['land', '0e8a16'], ['needs-rebase', 'fbca04'], ['severe', 'b60205'], ['dan', '5319e7'], ['bug', 'd73a4a'], ['blocked', '000000'], ['ask-dan', 'c5def5'], ['master-red', 'b60205'], ['tracking', 'ededed']])
    if (!labels.has(n)) await gh('POST', '/repos/{repo}/labels', { name: n, color: c });
  const existing = new Set((await ghAll('/repos/{repo}/issues?state=all')).map((i) => i.title));
  let made = 0;
  for (const i of plan.issues) if (!existing.has(i.title)) { await gh('POST', '/repos/{repo}/issues', { ...i, milestone: id[i.milestone] }); made++; }
  console.log(`created ${made} issues`);
}
