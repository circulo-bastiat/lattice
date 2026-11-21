#!/usr/bin/env node
// texauditjob.mjs - #1529 GATE M L3b: the GPU half of the rendered pixel audit, as a CONTROLLED BACKGROUND JOB.
// It draws every complained mob in a real Chromium (WebGL2, then WebGPU, SwiftShader) with the game's own mob pipeline
// and compares the pixels with the jar+.decomp reference (mobl3check.mjs). It is heavy, so it NEVER runs in the
// foreground: the CLI refuses unless MCLITE_TEXAUDIT_BG=1, which only the brain's spawn (tools/brain/brain.mjs health
// pass, route.mjs texauditDue) sets. Nothing else starts it. Read the result with `node tools/go.mjs texaudit status`.
//   - ONE job at a time (mkdir lock <dir>/render.lock), nice 19 on itself and the browser;
//   - limits: perMobMs per mob, memMB for the browser tree, runMs for the run (then state 'aborted');
//   - RESUMABLE: summary.json {srcHash, state}; the same srcHash and state !== 'done' skips mobs already carrying it;
//   - results: <dir>/<mob>/<layer>.json (+ <layer>.png / <layer>.webgpu.png on a mismatch), <dir>/summary.json,
//     ONE bus line, the repo variable MCLITE_TEXAUDIT, and (with GH_TOKEN) deduplicated `bug,mobs` issues.
// <dir> = $MCLITE_TEXAUDIT_DIR || <_status>/texaudit || ~/.brain/_status/texaudit.   texauditjobcheck.mjs proves the rules.
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, setPriority } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findUnder, gh, token } from './infra/gh.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
export const LIMITS = { perMobMs: 60e3, runMs: 45 * 60e3, memMB: 1536 };
const SOURCES = ['src/07h_entities.js', 'src/07j_entityrender.js', 'src/15h_bemodel.js', 'src/16z_l3render.js',
  'tools/extract-mob-textures.mjs', 'tools/bake-geometry.mjs', 'tools/extract-models.mjs', 'tools/mobl3check.mjs'];
const BACKENDS = ['webgl2', 'webgpu'];

export const texauditDir = () => process.env.MCLITE_TEXAUDIT_DIR || join(findUnder('_status') || join(homedir(), '.brain', '_status'), 'texaudit');

/** sha of the last commit touching each entity/model/texture source that exists: changes when the audited code does. */
export function sourceHash(root = ROOT) {
  const files = SOURCES.filter((f) => existsSync(join(root, f)));
  const r = spawnSync('git', ['log', '-1', '--format=%H', '--', ...files], { cwd: root, encoding: 'utf8' });
  return createHash('sha1').update(`${r.stdout || ''}|${files.join(',')}`).digest('hex').slice(0, 16);
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** {held, stale, owner}: the lock is stale when its pid is dead or it is older than runMs + 5 min. */
export function lockState(dir, limits = LIMITS, now = Date.now()) {
  const lock = join(dir, 'render.lock');
  if (!existsSync(lock)) return { held: false, stale: false };
  let o = null; try { o = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')); } catch {}
  const age = now - (o ? o.start : (() => { try { return statSync(lock).mtimeMs; } catch { return 0; } })());
  const stale = !o || !alive(o.pid) || age > limits.runMs + 5 * 60e3;
  return { held: true, stale, owner: o };
}
function takeLock(dir, limits, now) {
  const lock = join(dir, 'render.lock');
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 2; i++) {
    try { mkdirSync(lock); writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, start: now })); return true; }
    catch { if (!lockState(dir, limits, now).stale) return false; rmSync(lock, { recursive: true, force: true }); }
  }
  return false;
}
const dropLock = (dir) => {
  try { if (JSON.parse(readFileSync(join(dir, 'render.lock', 'owner.json'), 'utf8')).pid === process.pid) rmSync(join(dir, 'render.lock'), { recursive: true, force: true }); } catch {}
};

/** MB of resident memory of pid and its descendants (/proc; 0 where unavailable). */
export function memOf(pid) {
  try {
    const kids = new Map(), rss = new Map();
    for (const p of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try {
        const s = readFileSync(`/proc/${p}/status`, 'utf8');
        const pp = Number((/^PPid:\s*(\d+)/m.exec(s) || [])[1]);
        (kids.get(pp) || kids.set(pp, []).get(pp)).push(Number(p));
        rss.set(Number(p), Number((/^VmRSS:\s*(\d+)/m.exec(s) || [])[1] || 0));
      } catch {}
    }
    let kb = 0; const st = [Number(pid)];
    while (st.length) { const p = st.pop(); kb += rss.get(p) || 0; st.push(...(kids.get(p) || [])); }
    return kb / 1024;
  } catch { return 0; }
}

const nice = (pid) => { try { setPriority(pid, 19); } catch {} };
const within = (p, ms) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r({ __timeout: true }), Math.max(1, ms)); })]).finally(() => clearTimeout(t)); };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const sayDefault = (line) => spawnSync(process.execPath, [join(ROOT, 'tools', 'go.mjs'), 'say', '--to', 'log', line], { cwd: ROOT, stdio: 'ignore' });
async function publishDefault(sum) {
  if (!token()) return;
  const body = { name: 'MCLITE_TEXAUDIT', value: JSON.stringify(sum) };
  if ((await gh('PATCH', '/repos/{repo}/actions/variables/MCLITE_TEXAUDIT', body, { ok404: true })) === null) await gh('POST', '/repos/{repo}/actions/variables', body);
}

/** A mob already finished under this srcHash: in the summary, and every result json carries the hash. */
function mobDone(dir, mob, prev, srcHash) {
  if (!prev || !prev.mobs[mob]) return false;
  const d = join(dir, mob); let fs; try { fs = readdirSync(d).filter((f) => f.endsWith('.json')); } catch { return false; }
  return fs.length > 0 && fs.every((f) => (readJson(join(d, f)) || {}).srcHash === srcHash);
}

export async function runJob(opt = {}) {
  const dir = opt.dir || texauditDir(), limits = { ...LIMITS, ...(opt.limits || {}) }, now = opt.now || Date.now;
  const say = opt.say || sayDefault, mem = opt.memOf || memOf;
  const srcHash = opt.srcHash || sourceHash();
  const mobs = opt.mobs || Object.keys((await import('./mobl3check.mjs')).MOBS);
  const openPage = opt.openPage || (async (b, o) => (await import('./texaudit-page.mjs')).openAuditPage(b, o));
  const targetsOf = opt.targets || (async (m) => (await import('./mobl3check.mjs')).l3Targets(m));
  const compare = opt.compare || (async (v, rgba) => (await import('./mobl3check.mjs')).compareGpu(v, rgba));
  const diffPng = opt.diffPng || (async (f, vs) => (await import('./mobl3check.mjs')).gpuDiffPng(f, vs));
  const res = opt.res !== undefined ? opt.res : opt.targets ? 1 : (await import('./mobl3check.mjs')).RES;
  const t0 = now();
  if (!takeLock(dir, limits, t0)) { say(`texaudit: refused, another run holds ${join(dir, 'render.lock')}`); return { state: 'refused' }; }
  nice(process.pid);
  const prev = readJson(join(dir, 'summary.json'));
  const resume = !!prev && prev.srcHash === srcHash && prev.state !== 'done';
  const sum = { srcHash, state: 'running', startedAt: resume ? prev.startedAt : t0, at: t0, mobs: resume ? { ...prev.mobs } : {}, elapsedMs: 0 };
  const save = () => { sum.at = now(); sum.elapsedMs = sum.at - t0; writeFileSync(join(dir, 'summary.json'), JSON.stringify(sum, null, 1)); };
  const pages = {};
  const closePage = async (b) => { const p = pages[b]; delete pages[b]; if (p) { try { await within(p.close(), 5000); } catch {} } };
  const getPage = async (b) => { if (!pages[b]) { pages[b] = await openPage(b, { timeoutMs: limits.perMobMs }); nice(pages[b].pid); } return pages[b]; };
  save();
  try {
    for (const mob of mobs) {
      if (now() - t0 >= limits.runMs) { sum.state = 'aborted'; break; }
      if (resume && mobDone(dir, mob, prev, srcHash)) continue;
      const deadline = Date.now() + limits.perMobMs, layers = {};
      let err = null;
      const lay = (t) => layers[t.layer] || (layers[t.layer] = { mob, layer: t.layer, keys: [], srcHash, at: now(), backends: {}, pngs: {} });
      try {
        const targets = await within(Promise.resolve(targetsOf(mob)), deadline - Date.now());
        if (targets && targets.__timeout) err = { b: BACKENDS[0], e: 'timeout' };
        else for (const b of BACKENDS) {
          if (err) break;
          let page; try { page = await within(getPage(b), deadline - Date.now()); } catch (e) { err = { b, e: `open: ${e.message}` }; break; }
          if (page.__timeout) { err = { b, e: 'timeout' }; break; }
          for (const t of targets) {
            const L = lay(t); if (!L.keys.includes(t.key)) L.keys.push(t.key);
            const R = L.backends[b] || (L.backends[b] = { ok: true, px: 0, mism: 0, band: 0, cullMode: null, views: [], error: null });
            const vws = [];
            for (const v of t.views) {
              const spec = { layer: t.layer, texKey: t.texKey, view: { n: v.n, R: v.R, Up: v.Up, r0: v.r0, u1: v.u1, W: v.W, H: v.H }, res };
              const r = await within(Promise.resolve(page.render(spec)), deadline - Date.now());
              if (r && r.__timeout) { err = { b, e: 'timeout' }; break; }
              if (!r || !r.ok) { R.ok = false; R.error = (r && r.error) || 'render failed'; break; }
              R.cullMode = r.cullMode ?? R.cullMode;
              const c = await compare(v, Uint8Array.from(Buffer.from(r.rgba, 'base64')));
              R.px += c.px; R.mism += c.mism; R.band += c.band;
              R.views.push({ name: `${t.key}/${v.name}`, mism: c.mism, band: c.band });
              if (c.mism) vws.push({ W: v.W, H: v.H, col: v.col, gpu: Uint8Array.from(Buffer.from(r.rgba, 'base64')), diff: c.diff });
              if (mem(page.pid) > limits.memMB) { err = { b, e: 'memory' }; break; }
            }
            if (vws.length) { const f = join(dir, mob, b === 'webgl2' ? `${t.layer}.png` : `${t.layer}.${b}.png`); mkdirSync(dirname(f), { recursive: true }); try { await diffPng(f, vws); L.pngs[b] = f; } catch {} }
            if (err || R.error) break;
          }
        }
      } catch (e) { err = { b: BACKENDS[0], e: String(e.message || e) }; }
      if (err) { await closePage(err.b); if (err.e === 'timeout' || err.e === 'memory') await Promise.all(Object.keys(pages).map(closePage)); }
      mkdirSync(join(dir, mob), { recursive: true });
      for (const L of Object.values(layers)) {
        if (err) { const R = L.backends[err.b] || (L.backends[err.b] = { ok: false, px: 0, mism: 0, band: 0, cullMode: null, views: [] }); R.ok = false; R.error = err.e; }
        writeFileSync(join(dir, mob, `${L.layer}.json`), JSON.stringify(L, null, 1));
      }
      if (err) writeFileSync(join(dir, mob, '_error.json'), JSON.stringify({ mob, srcHash, at: now(), backend: err.b, error: err.e }, null, 1));
      const bm = {}, errs = [];
      for (const L of Object.values(layers)) for (const [b, R] of Object.entries(L.backends)) { bm[b] = (bm[b] || 0) + R.mism; if (R.error) errs.push(R.error); }
      sum.mobs[mob] = { mism: Object.values(bm).reduce((s, x) => s + x, 0), ...bm, error: (err && err.e) || errs[0] || null };
      save();
    }
    if (sum.state === 'running') sum.state = 'done';
  } finally {
    await Promise.all(Object.keys(pages).map(closePage));
    save();
    dropLock(dir);
  }
  // ---- report: one bus line, deduplicated bugs, the repo variable
  const ent = Object.entries(sum.mobs), bad = ent.filter(([, r]) => r.mism > 0), errd = ent.filter(([, r]) => r.error);
  const line = `texaudit: ${sum.state}, ${ent.length}/${mobs.length} mobs x ${BACKENDS.length} backends (${BACKENDS.join('+')}) in ${Math.round(sum.elapsedMs / 1000)}s, src ${srcHash.slice(0, 8)}; `
    + `${bad.length ? `mismatching: ${bad.map(([m, r]) => `${m} (${r.mism} px${BACKENDS.map((b) => r[b] ? ` ${b} ${r[b]}` : '').join('')})`).join(', ')}` : 'no mismatches'}; `
    + `${errd.length ? `errors: ${errd.map(([m, r]) => `${m} ${r.error}`).join(', ')}` : 'no errors'}; PNGs in ${dir}`;
  try { say(line); } catch {}
  if (bad.length && (opt.fileBugs || process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) {
    const fb = opt.fileBugs || (async (...a) => (await import('./mobl3check.mjs')).fileBugs(...a));
    for (const b of BACKENDS) {
      const rows = {};
      for (const [m, r] of bad) if (r[b] > 0) {
        let worst = { t: '?' }, wm = -1;
        for (const f of readdirSync(join(dir, m)).filter((x) => x.endsWith('.json') && x !== '_error.json')) {
          for (const v of ((readJson(join(dir, m, f)) || {}).backends || {})[b]?.views || []) if (v.mism > wm) { wm = v.mism; worst = { t: v.name.split('/')[0] }; }
        }
        rows[m] = { mism: r[b], worst };
      }
      if (Object.keys(rows).length) try { await fb(Object.keys(rows), rows, { source: b }); } catch {}
    }
  }
  try { await (opt.publish || publishDefault)({ at: sum.at, srcHash, state: sum.state, elapsedMs: sum.elapsedMs, mobs: sum.mobs }); } catch {}
  return sum;
}

/** The CLI body. Refuses (exit code 2) unless the brain's spawn set MCLITE_TEXAUDIT_BG=1: there is no foreground path. */
export async function cli(env = process.env, opt = {}) {
  if (env.MCLITE_TEXAUDIT_BG !== '1') { console.error('texauditjob: refused - this is a background job started only by the brain (MCLITE_TEXAUDIT_BG=1). Read the result with: node tools/go.mjs texaudit status'); return 2; }
  await runJob(opt);
  return 0;
}
if (MAIN) process.exit(await cli());
