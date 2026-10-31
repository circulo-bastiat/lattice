// tools/infra/golden.mjs - #6524: the referee GOLDEN files (generated on the real server, never in mclite: D-6) reach the lander.
// A *refcheck whose golden/<name>.json is missing prints "SKIP (golden not generated)" and exits 0, so the lander saw no "<n> breaks caught" and bounced it
// as vacuous (12 Oct: 36 of 68 bounces in 12 h). The worker has the golden on its own machine; the lander only has the store branch's golden/.
//   publishGolden: `go.mjs done --finished` pushes the golden an added/changed referee check reads to branch store, golden/<name>.json
//   syncGolden:    the PC lander copies store golden/ into its referee dir before it tests (the hosted lander does that in cloud/bootstrap.mjs)
import { gitExec } from './gitenv.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** The golden file names a check's source reads: join(refDir, 'golden', '<name>.json'). */
export const goldenNames = (src) => [...new Set([...String(src).matchAll(/'golden',\s*'([\w.-]+\.json)'/g)].map((m) => m[1]))];
/** Same place every *refcheck looks first. */
/** #9020: every golden a SKIP-ing proof check needs (tools/*proofcheck*.mjs), changed or not: the lander must always find them on the store branch. */
export const proofGoldenNames = (toolsDir) => [...new Set(readdirSync(toolsDir).filter((f) => /proofcheck.*\.mjs$/.test(f)).flatMap((f) => goldenNames(readFileSync(join(toolsDir, f), 'utf8'))))];

export const goldenDir = () => join(process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2'), 'golden');

/** #9546: when a golden says it was generated (its own top-level `generatedAt`), as ms, else null. Newest wins in both directions (sync and publish). */
export const genAt = (buf) => { try { const t = Date.parse(JSON.parse(String(buf)).generatedAt); return Number.isFinite(t) ? t : null; } catch { return null; } };
/** Push each named golden from this machine to the store branch (contents API). Returns {pushed, same, missing}. */
/** #9546: the golden files the full-suite check `id` reads (its tools/stages.d entry's file). A RED issue about that check makes them `regen`:
 *  the worker who ran it green with its (re)generated golden publishes that golden, or the mirror keeps the stale one and re-files the RED. */
export function checkGoldens(root, id) {
  const sd = join(root, 'tools', 'stages.d');
  for (const f of readdirSync(sd).filter((x) => x.endsWith('.json'))) {
    let arr; try { arr = JSON.parse(readFileSync(join(sd, f), 'utf8')); } catch { continue; }
    const e = (Array.isArray(arr) ? arr : []).find((x) => x && x.id === id); if (!e) continue;
    try { return goldenNames(readFileSync(join(root, e.file || `tools/${id}.mjs`), 'utf8')); } catch { return []; }
  }
  return [];
}
/** #9133: a store file that differs is replaced only by a golden named in `regen` (a referee check this PR added/changed reads it) or in env MCLITE_GOLDEN_REGEN (comma list, set by a worker that ran runloot). Never by file mtime. */
export async function publishGolden(names, gh, dir = goldenDir(), regen = new Set()) {
  const out = { pushed: [], same: [], missing: [] };
  const envRegen = new Set(String(process.env.MCLITE_GOLDEN_REGEN || '').split(',').map((x) => x.trim()).filter(Boolean));
  for (const name of names) {
    const f = join(dir, name);
    if (!existsSync(f)) { out.missing.push(name); continue; }
    const buf = readFileSync(f), b64 = buf.toString('base64');
    const cur = await gh('GET', `/repos/{repo}/contents/golden/${name}?ref=store`, null, { ok404: true });
    if (cur && String(cur.content || '').replace(/\n/g, '') === b64) { out.same.push(name); continue; }
    if (cur && cur.sha && !regen.has(name) && !envRegen.has(name)) { out.same.push(name); continue; }   // #9133: never by mtime - bootstrap copies the OLD mclite-store file over the workspace's, so its mtime is always fresh (20 Oct 18:53Z clobber, after the mtime guard of the first fix)
    { const sb = cur && cur.content ? Buffer.from(String(cur.content), 'base64') : null, a = genAt(buf), b = sb ? genAt(sb) : null; if (a !== null && b !== null && a < b) { out.same.push(name); continue; } }   // #9546: never replace a newer store golden with an older local one
    await gh('PUT', `/repos/{repo}/contents/golden/${name}`, { message: `golden: ${name} (published by done --finished, #6524)`, content: b64, branch: 'store', ...(cur && cur.sha ? { sha: cur.sha } : {}) });
    out.pushed.push(name);
  }
  return out;
}

/** Copy every golden/*.json of origin/store that is missing or different into `dir`. `cwd` is a clone with origin. Returns the names written. */
export function syncGolden(cwd, dir = goldenDir()) {
  const run = (...a) => gitExec(a, { cwd, maxBuffer: 1 << 28 });
  run('fetch', '-q', 'origin', '+refs/heads/store:refs/remotes/origin/store');
  const names = run('ls-tree', '--name-only', 'origin/store', 'golden/').toString().split('\n').filter((n) => /^golden\/[\w.-]+\.json$/.test(n)).map((n) => n.slice(7));
  mkdirSync(dir, { recursive: true });
  const wrote = [];
  for (const name of names) {
    const data = run('show', `origin/store:golden/${name}`), f = join(dir, name);
    if (existsSync(f)) { const cur = readFileSync(f); if (cur.equals(data)) continue; const a = genAt(cur), b = genAt(data); if (a !== null && b !== null && a > b) continue; }   // #9546: a golden generated HERE after the store's copy is kept (a worker's prep used to overwrite it within minutes, so it never reached the store)
    writeFileSync(f, data); wrote.push(name);
  }
  return wrote;
}
