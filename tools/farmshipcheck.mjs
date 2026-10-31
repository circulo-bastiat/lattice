// farmshipcheck (22 Oct): RUNS tools/infra/farmship.mjs against a fake GitHub and checks the brain tick calls it and the workflow no longer tries to open the PR itself.
// Prints '<n> breaks caught'.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOOLS = dirname(fileURLToPath(import.meta.url)), SRC = readFileSync(join(TOOLS, 'infra', 'farmship.mjs'), 'utf8');
const BRAIN = readFileSync(join(TOOLS, 'brain', 'brain.mjs'), 'utf8'), WF = readFileSync(join(TOOLS, '..', '.github', 'workflows', 'pilot-farm.yml'), 'utf8');
let ASSERTS = 0;
const RD = 'tools/referee/lockstep/pilot-results/262bd/';
function fake({ branches, prs = {}, ahead = {}, files = {}, have = [], trees = {} }) {
  const calls = [];
  const gh = async (m, p, b) => {
    calls.push([m, p, b]);
    if (p === '/repos/{repo}') return { owner: { login: 'o' } };
    if (p.startsWith('/repos/{repo}/branches')) return branches.map((name) => ({ name }));
    const h = p.match(/pulls\?state=all&head=o:(.+)$/); if (h) return prs[decodeURIComponent(h[1])] || [];
    const c = p.match(/compare\/master\.\.\.([^?]+)/); if (c) return { ahead_by: ahead[c[1]] ?? 0, files: files[c[1]] || [1, 2, 3] };
    // #10530: the recursive tree of the results dir: master's from `have` (names under 262bd/), a branch's from `trees[name]` (type/path/sha entries)
    const t = p.match(/^\/repos\/\{repo\}\/git\/trees\/([^:]+):tools\/referee\/lockstep\/pilot-results(\?recursive=1)?$/);
    if (t && t[1] === 'master') return { tree: t[2] ? have.map((n) => ({ type: 'blob', path: '262bd/' + n, sha: 'm-' + n })) : [{ type: 'tree', path: '262bd', sha: 'd' }] };
    if (t) return { tree: t[2] ? trees[decodeURIComponent(t[1])] || [] : [{ type: 'tree', path: '262bd', sha: 'd' }] };
    if (/git\/trees\/master:/.test(p)) return { tree: have.map((n) => ({ path: n })) };
    if (p === '/repos/{repo}/git/ref/heads/master') return { object: { sha: 'abcdef1234567890' } };
    if (m === 'POST' && p === '/repos/{repo}/git/trees') return { sha: 'tree1' };
    if (m === 'POST' && p === '/repos/{repo}/git/commits') return { sha: 'commit1' };
    if (m === 'POST' && p === '/repos/{repo}/git/refs') return {};
    if (m === 'PATCH' && /pulls\/\d+$/.test(p)) return {};
    if (m === 'POST' && /issues\/\d+\/comments$/.test(p)) return {};
    if (m === 'POST' && p === '/repos/{repo}/pulls') return { number: 777 };
    if (m === 'POST' && /labels$/.test(p)) return [];
    throw new Error('unexpected ' + m + ' ' + p);
  };
  return { gh, calls };
}
async function run(mut) { try { return await run0(mut); } catch (e) { if (/^no-op break/.test(e.message)) throw e; if (!mut) console.log('FAIL: threw ' + e.message); return 1; } }
async function run0(mut) {
  let fails = 0; const ok = (c, msg) => { ASSERTS++; if (!c) { fails++; if (!mut) console.log('FAIL: ' + msg); } };
  let src = SRC; if (mut && mut[0] === 'src') { if (!src.includes(mut[1])) throw new Error('no-op break: ' + mut[1]); src = src.replace(mut[1], mut[2]); }
  const d = mkdtempSync(join(tmpdir(), 'fsc-')); writeFileSync(join(d, 'farmship.mjs'), src);
  const m = await import(pathToFileURL(join(d, 'farmship.mjs')).href + '?' + Math.random()); rmSync(d, { recursive: true, force: true });
  let f = fake({ branches: ['master', 'farm/1', 'work/9-x'], ahead: { 'farm/1': 2 } });
  let r = await m.shipFarm({ gh: f.gh });
  ok(r.opened.length === 1 && /farm\/1/.test(r.opened[0]), 'a farm branch ahead of master with no PR gets a PR');
  ok(f.calls.some(([me, p, b]) => me === 'POST' && /issues\/777\/labels/.test(p) && b.labels.includes('land')), 'the new PR is labelled land');
  ok(!f.calls.some(([, p]) => /work\/9-x|compare\/master\.\.\.master/.test(p)), 'non-farm branches are never touched');
  f = fake({ branches: ['farm/2'], prs: { 'farm/2': [{ number: 5 }] }, ahead: { 'farm/2': 1 } }); r = await m.shipFarm({ gh: f.gh });
  ok(r.opened.length === 0 && !f.calls.some(([me]) => me === 'POST'), 'a farm branch that already has a PR (open or closed) is left alone');
  f = fake({ branches: ['farm/3'], ahead: { 'farm/3': 0 } }); r = await m.shipFarm({ gh: f.gh });
  ok(r.opened.length === 0 && !f.calls.some(([me]) => me === 'POST'), 'a farm branch master already contains is left alone');
  // #10101: an open farm PR nobody labelled land is closed when master has all its files, else replaced by a fresh branch from master with only the missing files
  const fl = (n, st = 'added') => ({ filename: RD + n, status: st, sha: 's-' + n }), openPr = { 'farm/4': [{ number: 40, state: 'open', labels: [] }] };
  const te = (n, type = 'blob') => ({ type, path: '262bd/' + n, sha: 's-' + n });   // #10530: a branch tree entry
  f = fake({ branches: ['farm/4'], prs: openPr, files: { 'farm/4': [fl('a-0.json'), fl('a-1.json')] }, trees: { 'farm/4': [te('a-0.json'), te('a-1.json')] }, have: ['a-0.json', 'a-1.json'] }); r = await m.shipFarm({ gh: f.gh });
  ok(f.calls.some(([me, p, b]) => me === 'PATCH' && /pulls\/40$/.test(p) && b.state === 'closed') && !f.calls.some(([me, p]) => me === 'POST' && p === '/repos/{repo}/pulls'), 'an open farm PR whose files master already has is closed, no new PR');
  // #10530: the real shape of farm/40617324923-p3: compare shows ONLY the first 300 of ~5000 removed entries and no result at all; the branch tree still holds the results
  const removed300 = Array.from({ length: 300 }, (_, i) => fl(`old-${i}.json`, 'removed'));
  f = fake({ branches: ['farm/5'], prs: { 'farm/5': [{ number: 50, state: 'open', labels: [] }] }, files: { 'farm/5': removed300 }, trees: { 'farm/5': [te('a-0.json'), te('a-1.json'), te('a-2.json'), { type: 'blob', path: '262bd/notes.txt', sha: 'x' }, { type: 'tree', path: '262bd', sha: 'd' }, te('gone.json', 'tree')] }, have: ['a-0.json'] }); r = await m.shipFarm({ gh: f.gh });
  const tr = f.calls.find(([me, p]) => me === 'POST' && p === '/repos/{repo}/git/trees');
  ok(tr && tr[2].base_tree === 'abcdef1234567890' && tr[2].tree.map((x) => x.path).join() === RD + 'a-1.json,' + RD + 'a-2.json' && tr[2].tree.every((x) => x.type === 'blob' && x.sha.startsWith('s-')), 'the replacement tree is the current master plus ONLY the result files master lacks (blob shas from the branch TREE, not compare; no non-json, no tree entries)');
  ok(f.calls.some(([, p]) => /git\/trees\/farm%2F5:tools\/referee\/lockstep\/pilot-results\?recursive=1$|git\/trees\/farm\/5:tools\/referee\/lockstep\/pilot-results\?recursive=1$/.test(p)), 'the branch results are read from its recursive tree (#10530: compare caps at 300 files)');
  ok(f.calls.some(([me, p, b]) => me === 'POST' && p === '/repos/{repo}/git/refs' && b.ref === 'refs/heads/farm/5-mabcdef1' && b.sha === 'commit1'), 'the replacement branch is farm/<name>-m<master sha7>');
  ok(f.calls.some(([me, p, b]) => me === 'POST' && p === '/repos/{repo}/pulls' && b.head === 'farm/5-mabcdef1' && b.base === 'master') && f.calls.some(([me, p, b]) => me === 'POST' && /issues\/777\/labels/.test(p) && b.labels.includes('land')), 'the replacement PR is opened from it and labelled land');
  ok(f.calls.some(([me, p, b]) => me === 'PATCH' && /pulls\/50$/.test(p) && b.state === 'closed'), 'the conflicted old PR is closed once superseded');
  f = fake({ branches: ['farm/6'], prs: { 'farm/6': [{ number: 60, state: 'open', labels: [{ name: 'land' }] }] }, ahead: { 'farm/6': 1 } }); r = await m.shipFarm({ gh: f.gh });
  ok(!f.calls.some(([me]) => me === 'POST' || me === 'PATCH'), 'a farm PR already labelled land (in the lander queue) is left alone');
  ok(m.farmBranches([{ name: 'farm/9' }, { name: 'farmer' }, null, { name: 'x/farm/1' }]).join() === 'farm/9', 'only names starting farm/ count');
  return fails;
}
const base = await run();
const BREAKS = [
  ['src', "if ((prs || []).length) {", "if (false) {"],
  ['src', "if (!cmp || !cmp.ahead_by) {", "if (false) {"],
  ['src', "issues/${pr.number}/labels`, { labels: ['land'] }", "issues/${pr.number}/labels`, { labels: ['x'] }"],
  ['src', "export const FARM_PREFIX = 'farm/';", "export const FARM_PREFIX = '';"],
  ['src', "state=all&head=", "state=open&head="],
  ['src', "if (!miss.length) {", "if (false) {"],
  ['src', "base_tree: sha,", "base_tree: undefined,"],
  ['src', "e.type === 'blob' && ", ""],
  ['src', " && e.path.endsWith('.json')", ""],
  ['src', "!have.has(e.path)", "true"],
  ['src', "?recursive=1", ""],
  ['src', "resultTree({ gh, ref: name })", "resultTree({ gh, ref: 'master' })"],
  ['src', "await gh('PATCH', `/repos/{repo}/pulls/${op.number}`, { state: 'closed' }); opened.push", "opened.push"],
  ['src', "!(p.labels || []).some((l) => l.name === 'land'));\n    if (op) {", "true);\n    if (op) {"],
];
let caught = 0; for (const b of BREAKS) { if (await run(b)) { caught++; console.log(' ✓ caught: ' + b[2]); } else console.log(' NOT CAUGHT: ' + b[2]); }
let fails = base; const need = (c, msg) => { ASSERTS++; if (!c) { fails++; console.log('FAIL: ' + msg); } };
need(/farmship\.mjs/.test(BRAIN) && /shipFarm\(\{ gh \}\)/.test(BRAIN), 'brain.mjs health pass calls shipFarm');
need(!/api\.github\.com|\/pulls/.test(WF), 'pilot-farm.yml does not try to open the PR with GITHUB_TOKEN');
const wired = (s) => /farmship\.mjs/.test(s) && /shipFarm\(\{ gh \}\)/.test(s);
for (const [n, s] of [['brain no longer ships', BRAIN.replace('shipFarm({ gh })', 'shipFarmX({ gh })')], ['brain import gone', BRAIN.replaceAll('farmship.mjs', 'farmshipx.mjs')]]) { if (!wired(s)) { caught++; console.log(' ✓ caught: ' + n); } else console.log(' NOT CAUGHT: ' + n); }
const wfOk = (s) => !/api\.github\.com|\/pulls/.test(s); if (!wfOk(WF + '\n  fetch("https://api.github.com/repos/x/pulls")')) { caught++; console.log(' ✓ caught: workflow PR call'); } else console.log(' NOT CAUGHT: workflow PR call');
console.log(`farmshipcheck: ${ASSERTS} assertions, ${fails} failures, ${caught} breaks caught (of ${BREAKS.length + 3})`);
process.exit(fails || caught < BREAKS.length + 3 ? 1 : 0);
