// tools/infra/tia.mjs - #7765, test impact analysis. Which stages does a PR's diff touch (from a map DERIVED by `suite.mjs --map`), plus a
// deterministic per-branch sample of the rest, under a time cap. Pure functions first (tools/tiacheck.mjs breaks them), CLI below.
//   node tools/infra/tia.mjs select [--diff <git range>] [--branch <name>]   prints the choice and why, last line `IDS a,b,c`
//   node tools/infra/tia.mjs replay <history.jsonl>                          recall of the selection over recorded reds
//   node tools/infra/tia.mjs misses [days]                                   selection-miss count (go.mjs status)
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
export const DEFAULTS = { capMin: 6, sampleRate: 0.05, defaultSec: 20 };
export const mapPath = () => join(process.env.MCLITE_DATA || ROOT, 'tia-map.json');

/** seed + id -> a number in [0,1): the same for the same branch, different across branches (the fleet covers everything) */
export const sampleKey = (seed, id) => parseInt(createHash('sha1').update(seed + '\0' + id).digest('hex').slice(0, 8), 16) / 2 ** 32;

/** static import closure of a stage's own file (ESM loads are not fs reads) */
export function importClosure(file, root = ROOT, seen = new Set()) {
  const abs = resolve(root, file); if (seen.has(abs) || !existsSync(abs)) return seen;
  seen.add(abs);
  let src = ''; try { src = readFileSync(abs, 'utf8'); } catch { return seen; }
  for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) importClosure(resolve(dirname(abs), m[1]), root, seen);
  return seen;
}

/** reads (absolute paths, one stage) -> repo-relative files; a directory read is kept as `dir/` (a prefix) */
export function normalizeReads(reads, stageFile, root = ROOT) {
  const set = new Set(), all = new Set([...reads, ...importClosure(stageFile, root)]);
  let wholeSrc = false;
  for (const a of all) {
    const r = relative(root, a).replace(/\\/g, '/');
    if (!r || r.startsWith('..') || /^(\.git|\.ledger|\.mcdata|\.decomp|\.chromium|jars|node_modules|assets)(\/|$)/.test(r)) continue;
    if (r === 'dist/mclite.html') { wholeSrc = true; continue; }   // the build concatenates src/: reading the shipped file depends on all of it
    let isDir = false; try { isDir = readdirSync(a).length >= 0; } catch { /* a file */ }
    set.add(isDir ? r + '/' : r);
  }
  if (wholeSrc) { set.add('src/'); set.add('build.mjs'); }
  return [...set].sort();
}

export const touches = (files, changed) => files.some((f) => f.endsWith('/') ? changed.some((c) => c.startsWith(f)) : changed.includes(f));

/** the choice. map = {stages:{id:{kind,file,files,ms}}}; returns {picks:[{id,why}], dropped:[{id,why}], estSec} */
/** #9776: the stages the newest full run recorded as failed (tia-history.jsonl next to the map, written by full.mjs). They are red on master already, so
 *  selecting them would bounce every PR that touches their files for a red it did not cause. Pure over the file text; '' / garbage = none. */
export function redOnMaster(historyText) {
  const lines = String(historyText || '').split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) { try { const r = JSON.parse(lines[i]); if (Array.isArray(r.failed)) return r.failed.map(String); } catch { /* a torn line: try the one before */ } }
  return [];
}
export function select({ map, changed, branch, core = [], quarantine = {}, newStages = [], capMin = DEFAULTS.capMin, sampleRate = DEFAULTS.sampleRate }) {
  const S = map.stages || {}, skip = new Set(core), picks = [], dropped = [], rest = [], pilots = [];
  for (const id of Object.keys(S).sort()) {
    const st = S[id]; if (st.kind !== 'check' || skip.has(id) || quarantine[id]) continue;
    // 23 Oct (commander, lander stalled 1 h): a PILOT stage (lockstep-<mob>, lockstep_<mob>: 20 salts against the real server) is never selected here. The map's ms is the WARM (cache-hit)
    // time, ~6 s; a cold run in the lander is 30+ min (the 01:20Z batch timed out on lockstep-parrot-server, -skeleton and -witch, and every single round after it selected them again).
    // The full run and the pilot farm own them; the lander never ran them before TIA existed. Infra checks named lockstep<x>check (no separator) are not pilots.
    if (/^lockstep[-_]/.test(id)) { pilots.push(id); continue; }
    const hit = (st.files || []).filter((f) => touches([f], changed));
    if (hit.length) picks.push({ id, why: 'impacted: ' + hit.slice(0, 2).join(', ') + (hit.length > 2 ? ` +${hit.length - 2}` : ''), sec: (st.ms || DEFAULTS.defaultSec * 1000) / 1000 });
    else rest.push(id);
  }
  for (const id of newStages) if (!skip.has(id) && !quarantine[id] && !picks.some((p) => p.id === id)) picks.push({ id, why: 'new stage in this diff', sec: DEFAULTS.defaultSec });
  for (const id of rest) if (sampleKey(branch, id) < sampleRate) picks.push({ id, why: `sample ${(sampleRate * 100)}% of seed "${branch}"`, sec: ((S[id].ms) || DEFAULTS.defaultSec * 1000) / 1000 });
  const capSec = capMin * 60, kept = []; let t = 0;
  // impacted first (cheap first inside each group), then the sample: the cap cuts the sample before it cuts anything impacted
  const rank = (p) => (p.why.startsWith('sample') ? 1 : 0);
  for (const p of picks.sort((a, b) => rank(a) - rank(b) || a.sec - b.sec || (a.id < b.id ? -1 : 1))) {
    if (t + p.sec > capSec && kept.length) dropped.push({ id: p.id, why: `time cap ${capMin} min (${p.why})` }); else { kept.push(p); t += p.sec; }
  }
  return { picks: kept, dropped, pilots, estSec: Math.round(t) };
}

/** replay: records [{sha, failed:[ids]}] oldest first; commitsBetween(prevSha, sha) -> [{pr, files}] . A red is NEW when the previous record was not red on it. */
export function replay({ records, commitsBetween, map, core = [], quarantine = {}, capMin, sampleRate }) {
  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const prev = new Set(records[i - 1].failed || []);
    for (const id of records[i].failed || []) {
      if (prev.has(id)) continue;
      const commits = commitsBetween(records[i - 1].sha, records[i].sha);
      let by = null, inCore = core.includes(id);
      for (const c of commits) {
        const r = select({ map, changed: c.files, branch: c.branch || 'pr' + c.pr, core, quarantine, capMin, sampleRate });
        if (inCore || r.picks.some((p) => p.id === id)) { by = c.pr; break; }
      }
      rows.push({ stage: id, sha: records[i].sha, candidates: commits.map((c) => c.pr), caught: by != null, by });
    }
  }
  const caught = rows.filter((r) => r.caught).length;
  return { rows, caught, total: rows.length, recall: rows.length ? caught / rows.length : null };
}

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const cfg = () => ({ ...DEFAULTS, ...(readJson(join(ROOT, 'tools/brain/roles.json'), {}).tia || {}) });
const gitOut = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const sub = process.argv[2], c = cfg();
  if (sub === 'select') {
    const range = arg('--diff', 'origin/master..HEAD'), map = readJson(mapPath(), null);
    if (!map) { console.log('tia: no map yet (the next 2-hourly full run writes it); core list only'); process.exit(0); }
    let branch = arg('--branch', ''); if (!branch) try { branch = gitOut('rev-parse', '--abbrev-ref', 'HEAD'); } catch { branch = 'detached'; }
    const changed = gitOut('diff', '--name-only', range).split('\n').filter(Boolean);
    const added = gitOut('diff', '--name-only', '--diff-filter=A', range, '--', 'tools/stages.d/').split('\n').filter(Boolean);
    const newStages = added.flatMap((f) => (readJson(join(ROOT, f), []) || []).filter((e) => e.kind === 'check').map((e) => e.id));
    const core = readJson(join(ROOT, 'tools/core.json'), {}).checks || [], quarantine = readJson(join(ROOT, 'tools/quarantine.json'), {});
    let red = []; try { red = redOnMaster(readFileSync(join(dirname(mapPath()), 'tia-history.jsonl'), 'utf8')); } catch { /* no history: nothing known red */ }   // #9776
    for (const id of red) if (!quarantine[id]) quarantine[id] = 'red on master at the last full run (#9776)';
    if (red.length) console.log(`tia: ${red.length} stage(s) red on master at the last full run are not selected: ${red.join(',')}`);
    const r = select({ map, changed, branch, core, quarantine, newStages, capMin: c.capMin, sampleRate: c.sampleRate });
    console.log(`tia: ${changed.length} changed files, map from ${map.head || '?'} (${map.at || '?'}), seed "${branch}", cap ${c.capMin} min: ${r.picks.length} selected (~${r.estSec}s), ${r.dropped.length} cut by the cap`);
    if (r.pilots.length) console.log(`tia: ${r.pilots.length} pilot stage(s) (lockstep-<mob>, a real-server run) are not selected: the full run and the pilot farm own them`);
    for (const p of r.picks) console.log(`  + ${p.id.padEnd(24)} ${p.why}`);
    for (const p of r.dropped) console.log(`  - ${p.id.padEnd(24)} ${p.why}`);
    if (r.picks.length) console.log('IDS ' + r.picks.map((p) => p.id).join(','));
  } else if (sub === 'replay') {
    const records = readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)), map = readJson(mapPath(), null);
    if (!map) { console.log('no map: nothing to replay against'); process.exit(1); }
    const commitsBetween = (a, b) => gitOut('log', '--first-parent', '--format=%H %s', `${a}..${b}`).split('\n').filter(Boolean).map((l) => {
      const h = l.split(' ')[0], m = /land #(\d+)/.exec(l);
      return { pr: m ? +m[1] : h.slice(0, 8), files: gitOut('diff', '--name-only', h + '^', h).split('\n').filter(Boolean) };
    });
    const r = replay({ records, commitsBetween, map, core: readJson(join(ROOT, 'tools/core.json'), {}).checks || [], quarantine: readJson(join(ROOT, 'tools/quarantine.json'), {}), capMin: c.capMin, sampleRate: c.sampleRate });
    console.log('| stage | went red at | PRs in range | caught by |\n|---|---|---|---|');
    for (const x of r.rows) console.log(`| ${x.stage} | ${x.sha.slice(0, 8)} | ${x.candidates.join(' ')} | ${x.caught ? '#' + x.by : '**missed**'} |`);
    console.log(`recall ${r.caught}/${r.total}` + (r.total ? ` = ${(100 * r.recall).toFixed(0)}%` : ''));
  } else if (sub === 'misses') {
    const f = process.argv[4] || join(process.env.MCLITE_PROJECTS || ROOT, '_status', 'tia-misses.jsonl'), days = +(process.argv[3] || 7);
    const L = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => Date.parse(x.at) > Date.now() - days * 864e5) : [];
    console.log(`selection-miss: ${L.length} in the last ${days} days` + (L.length ? ' (' + L.slice(-5).map((x) => `${x.stage} <- #${x.pr}`).join(', ') + ')' : ''));
  } else console.log('usage: tia.mjs select|replay|misses');
}
