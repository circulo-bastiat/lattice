// farmwork.mjs (22 Oct, Dan: "I wanted something to be a constant source of work"): turns the pilot farm's credit into issues, with no session in the loop.
//   - a mob whose lockstep row is green (20 credited stable salts, zero divergence) CLOSES its open `G17-L4 ... lockstep ... x20 / 20 seeds` rollout issues;
//   - a mob whose row has credited salts that DIVERGE gets ONE open issue `LOCKSTEP DIVERGENCE <mob>` (salts + first tick) - real, well-specified work for a worker;
//     at most `cap` new ones per run, and it is closed again when the row turns green.
//   node tools/infra/farmwork.mjs              plan only (prints what it would close / open)
//   node tools/infra/farmwork.mjs --apply      do it (env GH_TOKEN, GITHUB_REPOSITORY)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const STOP = new Set(['lockstep', 'rollout', 're', 'credit', 'seeds', 'seed', 'zero', 'divergences', 'against', 'the', 'real', 'server', 'vs', 'x20', 'to', 'l4', 'g17']);
export const DIV_PREFIX = 'LOCKSTEP DIVERGENCE ';
/** the mob a `G17-L4 ... lockstep ... x20 / 20 seeds` rollout title is about (a token that is a row of `rows`), or null */
export function rolloutMob(title, rows) {
  const t = String(title || '');
  if (!/^G\d+[a-z]?-L4\b/i.test(t) || !/lockstep/i.test(t) || !/(x\s?20|20 seeds)/i.test(t)) return null;
  return t.toLowerCase().split(/[^a-z_0-9]+/).find((w) => w && !STOP.has(w) && Object.prototype.hasOwnProperty.call(rows, w)) || null;
}
/** issues = open issues [{number,title}] (no PRs). Returns { close: [{number, mob}], open: [{mob, salts, tick}], resolve: [{number, mob}] } */
export function plan(issues, rows, cap = 5) {
  const close = [], resolve = [], open = [];
  const divIssue = new Map(issues.filter((i) => i.title.startsWith(DIV_PREFIX)).map((i) => [i.title.slice(DIV_PREFIX.length).trim(), i]));
  for (const i of issues) { const m = rolloutMob(i.title, rows); if (m && rows[m].pass && rows[m].checked >= 20) close.push({ number: i.number, mob: m }); }
  for (const [mob, r] of Object.entries(rows)) {
    const salts = Object.keys(r.failed || {}).map(Number);
    if (r.pass && divIssue.has(mob)) resolve.push({ number: divIssue.get(mob).number, mob });
    if (!r.pass && salts.length && !divIssue.has(mob)) open.push({ mob, salts, tick: Math.min(...salts.map((s) => r.failed[s])) });
  }
  return { close, resolve, open: open.sort((a, b) => a.tick - b.tick || a.mob.localeCompare(b.mob)).slice(0, cap) };
}
export const divBody = (o) => `The pilot farm (tools/infra/pilotfarm.mjs) credited real-server runs for \`${o.mob}\` where the engine DIVERGES from the real 1.18.2 server.\n\n- diverging salts: ${o.salts.join(', ')}\n- first divergence tick: ${o.tick}\n\nRepro: \`node tools/referee/lockstep/pilot.mjs ${o.mob} ${o.salts[0]}\` (see the lane file under tools/referee/lanes.d). Fix the ENGINE (the server is the truth), re-run the lane; the farm closes this issue itself when the row turns green. Never edit the shared harness files outside a \`LANE:\` fence to make it pass.`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { lockstepRows, allDirs } = await import('../moblockstepproof.mjs');
  const rows = lockstepRows({ lanesDir: join(HERE, 'referee', 'lanes.d'), resultsDirs: allDirs(join(HERE, 'referee', 'lockstep', 'pilot-results')) });
  const repo = process.env.GITHUB_REPOSITORY || 'owner/mclite', tok = process.env.GH_TOKEN, apply = process.argv.includes('--apply');
  const api = async (m, p, b) => { const r = await fetch(`https://api.github.com/repos/${repo}${p}`, { method: m, headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json' }, body: b ? JSON.stringify(b) : undefined }); if (!r.ok) throw new Error(`${m} ${p} ${r.status}`); return r.json(); };
  let issues = []; if (tok) for (let p = 1; p <= 5; p++) { const a = await api('GET', `/issues?state=open&per_page=100&page=${p}`); issues = issues.concat(a.filter((i) => !i.pull_request)); if (a.length < 100) break; }
  const P = plan(issues, rows);
  console.log(`farmwork: ${Object.keys(rows).length} mob rows, ${Object.values(rows).filter((r) => r.pass).length} green; would close ${P.close.length} rollout issue(s), resolve ${P.resolve.length}, open ${P.open.length} divergence issue(s)`);
  for (const c of P.close) console.log(`  close #${c.number} (${c.mob} green)`); for (const o of P.open) console.log(`  open ${DIV_PREFIX}${o.mob}: salts ${o.salts.join(',')} tick ${o.tick}`);
  if (apply && tok) {
    for (const c of P.close.concat(P.resolve)) { await api('POST', `/issues/${c.number}/comments`, { body: `**Pilot farm**: \`${c.mob}\` now has 20 credited real-server salts and zero divergences (tools/mobproof/out/lockstep.json). Closing.` }); await api('PATCH', `/issues/${c.number}`, { state: 'closed', state_reason: 'completed' }); }
    for (const o of P.open) await api('POST', '/issues', { title: `${DIV_PREFIX}${o.mob}`, body: divBody(o), labels: ['bug', 'mobs'] });
  }
}
