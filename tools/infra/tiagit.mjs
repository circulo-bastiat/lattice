// tools/infra/tiagit.mjs - #7765 item 1: recall baseline rebuilt from GIT HISTORY alone (no runner result history exists).
//   node tools/infra/tiagit.mjs [commits=3000] [--json]
// A "red" is a fix commit whose subject names a stage id with a fix word. Its CAUSE is the latest earlier commit that touched a
// non-test file the fix also touched. The cause is "caught" when the stage's static file set (stage file + import closure, and
// src/ + build.mjs when the stage file mentions dist/ or src/) intersects the cause's diff. This is a PROXY: the real map comes
// from `suite --map`, which reads more than imports, so true recall is >= this figure.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, importClosure, touches } from './tia.mjs';
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const N = +process.argv[2] || 3000;

export function staticFiles(st) {
  const out = new Set();
  for (const a of importClosure(st.file)) out.add(a.slice(ROOT.length + 1).replace(/\\/g, '/'));
  let src = ''; try { src = readFileSync(join(ROOT, st.file), 'utf8'); } catch { /* gone */ }
  if (/dist\/mclite|\bsrc\/|build\.mjs/.test(src)) { out.add('src/'); out.add('build.mjs'); }
  if (/^lockstep-/.test(st.id) || /lockstep|pilot|\bspawn/.test(src)) { out.add('src/'); out.add('build.mjs'); out.add('tools/lockstep/'); }   // child processes read src/ too
  return [...out];
}

export function history(n) {
  const rows = git('log', `-${n}`, '--name-only', '--format=@@%h\t%s').split('@@').slice(1).map((b) => {
    const [head, ...f] = b.split('\n'); const [sha, subj] = head.split('\t');
    return { sha, subj, files: f.filter(Boolean) };
  });
  return rows; // newest first
}

export function run(n = N) {
  const stages = {};
  for (const f of readdirSync(join(ROOT, 'tools/stages.d'))) {
    try { for (const s of JSON.parse(readFileSync(join(ROOT, 'tools/stages.d', f), 'utf8'))) if (s.kind === 'check' && s.file) stages[s.id] = s; } catch { /* skip */ }
  }
  const ids = Object.keys(stages).sort((a, b) => b.length - a.length);
  const rows = history(n), gen = (f) => /\.gen\.js$|^docs\/|^\.|\.json$/.test(f) && !/^tools\/stages\.d/.test(f);
  const fixRe = /\b(fix(es|ed)?|repair(ed)?|regress\w*|broke\w*|unbreak|red)\b/i, out = [], cache = {};
  rows.forEach((r, i) => {
    if (!fixRe.test(r.subj) || /^land #/.test(r.subj)) return;
    const id = ids.find((x) => new RegExp(`(^|[^a-z0-9])${x}([^a-z0-9]|$)`, 'i').test(r.subj)); if (!id) return;
    const mine = r.files.filter((f) => !gen(f) && !/^tools\/stages\.d|^tools\/[a-z0-9]+check\.mjs$/.test(f));
    if (!mine.length) return;
    for (let j = i + 1; j < rows.length; j++) {
      const c = rows[j]; if (/^land #/.test(c.subj)) continue;
      if (!c.files.some((f) => mine.includes(f))) continue;
      const files = cache[id] ||= staticFiles(stages[id]);
      out.push({ stage: id, fix: r.sha, cause: c.sha, caught: touches(files, c.files), subj: c.subj.slice(0, 70) });
      break;
    }
  });
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('tiagit.mjs')) {
  const r = run(), hit = r.filter((x) => x.caught).length;
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else { for (const x of r) console.log(`${x.caught ? 'CAUGHT' : 'MISSED'}  ${x.stage.padEnd(22)} fix ${x.fix} <- cause ${x.cause}  ${x.subj}`); }
  console.log(`recall(proxy) ${hit}/${r.length} = ${r.length ? Math.round(100 * hit / r.length) : 0}%`);
}
