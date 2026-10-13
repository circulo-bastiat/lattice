// tools/infra/golden.mjs - #6524: the referee GOLDEN files (generated on the real server, never in mclite: D-6) reach the lander.
// A *refcheck whose golden/<name>.json is missing prints "SKIP (golden not generated)" and exits 0, so the lander saw no "<n> breaks caught" and bounced it
// as vacuous (12 Oct: 36 of 68 bounces in 12 h). The worker has the golden on its own machine; the lander only has the store branch's golden/.
//   publishGolden: `go.mjs done --finished` pushes the golden an added/changed referee check reads to branch store, golden/<name>.json
//   syncGolden:    the PC lander copies store golden/ into its referee dir before it tests (the hosted lander does that in cloud/bootstrap.mjs)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** The golden file names a check's source reads: join(refDir, 'golden', '<name>.json'). */
export const goldenNames = (src) => [...new Set([...String(src).matchAll(/'golden',\s*'([\w.-]+\.json)'/g)].map((m) => m[1]))];
/** Same place every *refcheck looks first. */
export const goldenDir = () => join(process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2'), 'golden');

/** Push each named golden from this machine to the store branch (contents API). Returns {pushed, same, missing}. */
export async function publishGolden(names, gh, dir = goldenDir()) {
  const out = { pushed: [], same: [], missing: [] };
  for (const name of names) {
    const f = join(dir, name);
    if (!existsSync(f)) { out.missing.push(name); continue; }
    const buf = readFileSync(f), b64 = buf.toString('base64');
    const cur = await gh('GET', `/repos/{repo}/contents/golden/${name}?ref=store`, null, { ok404: true });
    if (cur && String(cur.content || '').replace(/\n/g, '') === b64) { out.same.push(name); continue; }
    await gh('PUT', `/repos/{repo}/contents/golden/${name}`, { message: `golden: ${name} (published by done --finished, #6524)`, content: b64, branch: 'store', ...(cur && cur.sha ? { sha: cur.sha } : {}) });
    out.pushed.push(name);
  }
  return out;
}

/** Copy every golden/*.json of origin/store that is missing or different into `dir`. `cwd` is a clone with origin. Returns the names written. */
export function syncGolden(cwd, dir = goldenDir()) {
  const run = (...a) => execFileSync('git', a, { cwd, maxBuffer: 1 << 28 });
  run('fetch', '-q', 'origin', '+refs/heads/store:refs/remotes/origin/store');
  const names = run('ls-tree', '--name-only', 'origin/store', 'golden/').toString().split('\n').filter((n) => /^golden\/[\w.-]+\.json$/.test(n)).map((n) => n.slice(7));
  mkdirSync(dir, { recursive: true });
  const wrote = [];
  for (const name of names) {
    const data = run('show', `origin/store:golden/${name}`), f = join(dir, name);
    if (existsSync(f) && readFileSync(f).equals(data)) continue;
    writeFileSync(f, data); wrote.push(name);
  }
  return wrote;
}
