#!/usr/bin/env node
// diskcleancheck.mjs - #4965: low guest disk is a finding, and the auto-clean removes only stale regenerable files. Anti-vacuity: breaks its own source.
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, mkdirSync, utimesSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const P = (f) => fileURLToPath(new URL('../' + f, import.meta.url)), rd = (f) => readFileSync(P(f), 'utf8');
let asserts = 0, fails = 0, breaks = 0, seq = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
async function load(file, src) { const f = P(`tools/${file}/_dc${process.pid}_${seq++}.tmp.mjs`); writeFileSync(f, src); try { return await import(pathToFileURL(f).href); } finally { unlinkSync(f); } }
const DAY = 86400e3, now = Date.now();
async function cases(R, D) { const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch {} if (!r) bad.push(n); };
  const f = (free) => R.findings({ now, diskFreeGB: free }, {});
  t('2 GB free is disk-low', () => f(2).some((x) => x.key === 'disk-low'));
  t('50 GB free is not', () => !f(50).some((x) => x.key === 'disk-low'));
  t('gate is configurable', () => R.findings({ now, diskFreeGB: 8 }, { health: { diskMinGB: 10 } }).some((x) => x.key === 'disk-low'));
  const e = (name, age) => ({ name, path: name, mtime: now - age });
  t('old tmp scratch goes', () => D.stale([e('bpc-abc', 2 * DAY)], 'tmp', now).length === 1);
  t('fresh tmp scratch stays', () => D.stale([e('bpc-abc', 1000)], 'tmp', now).length === 0);
  t('unknown tmp name stays', () => D.stale([e('my-notes', 9 * DAY)], 'tmp', now).length === 0);
  t('lockstep scratch dirs go', () => ['lockstep-a-x', 'lstable-1', 'mclite-mdl-9', 'lockstepchk-2', 'ag-3'].every((n) => D.stale([e(n, 9 * DAY)], 'tmp', now).length === 1));
  t('old diag log goes', () => D.stale([e('Worker_1.log', 3 * DAY)], 'diag', now).length === 1);
  t('fresh diag log stays', () => D.stale([e('Worker_1.log', DAY)], 'diag', now).length === 0);
  t('clean() removes stale and keeps fresh', () => { const root = mkdtempSync(join(tmpdir(), 'dcc-')), tmp = join(root, 't'), rn = join(root, 'runners', 'r1', '_diag'); mkdirSync(tmp); mkdirSync(rn, { recursive: true });
    const mk = (d, n, age) => { const p = join(d, n); mkdirSync(p); const s = (now - age) / 1000; utimesSync(p, s, s); return p; };
    const a = mk(tmp, 'dm-old', 3 * DAY), b = mk(tmp, 'dm-new', 1000), c = mk(rn, 'old.log', 5 * DAY), d = mk(rn, 'new.log', 1000);
    const n = D.clean(now, { tmp, runners: join(root, 'runners') }); const r = n === 2 && !existsSync(a) && !existsSync(c) && existsSync(b) && existsSync(d); rmSync(root, { recursive: true, force: true }); return r; });
  t('old chrome scoped_dir goes, fresh and foreign stay', () => D.stale([e('scoped_dirAb12', 2 * DAY)], 'chrome', now).length === 1 && D.stale([e('scoped_dirAb12', 1000)], 'chrome', now).length === 0 && D.stale([e('Default', 9 * DAY)], 'chrome', now).length === 0);
  t('clean() sweeps the chrome roots', () => { const root = mkdtempSync(join(tmpdir(), 'dcc-')), ch = join(root, 'chrome'); mkdirSync(ch);
    const mk = (n, age) => { const p = join(ch, n); mkdirSync(p); const s = (now - age) / 1000; utimesSync(p, s, s); return p; };
    const a = mk('scoped_dirOld', 3 * DAY), b = mk('scoped_dirNew', 1000);
    const n = D.clean(now, { tmp: join(root, 'none'), runners: join(root, 'none'), chrome: [ch] }); const r = n === 1 && !existsSync(a) && existsSync(b); rmSync(root, { recursive: true, force: true }); return r; });
  const fx = (mk) => { const root = mkdtempSync(join(tmpdir(), 'dcg-')); const out = mk(root); return out; };
  const clone = (root, rn, packs, tmpAge) => { const pk = join(root, rn, '_work', 'p', 'p', '.git', 'objects', 'pack'); mkdirSync(pk, { recursive: true }); for (let i = 0; i < packs; i++) writeFileSync(join(pk, `pack-${i}.pack`), ''); if (tmpAge) { const t = join(pk, 'tmp_pack_x'); writeFileSync(t, ''); const s = (now - tmpAge) / 1000; utimesSync(t, s, s); } return pk; };
  t('gcClones picks fat idle, skips busy and clean, drops old tmp_', () => fx((root) => { const a = clone(root, 'a', 60, 2 * DAY), b = clone(root, 'b', 60), c = clone(root, 'c', 3); const seen = [];
    const g = D.gcClones(now, { runners: root, busy: (d) => d.endsWith('b'), run: (git) => seen.push(git) }); const r = g.length === 1 && g[0].includes('/a/') && seen.length === 1 && !existsSync(join(a, 'tmp_pack_x')); rmSync(root, { recursive: true, force: true }); return r; }));
  t('gcClones rate-limits per clone', () => fx((root) => { clone(root, 'a', 60); const o = { runners: root, busy: () => false, run: () => {} }; const n1 = D.gcClones(now, o).length, n2 = D.gcClones(now + 1000, o).length, n3 = D.gcClones(now + 7 * 3600e3, o).length; rmSync(root, { recursive: true, force: true }); return n1 === 1 && n2 === 0 && n3 === 1; }));
  t('needsGc rule', () => D.needsGc({ packs: 21, loose: 0, busy: false }) && D.needsGc({ packs: 1, loose: 5001, busy: false }) && !D.needsGc({ packs: 21, loose: 0, busy: true }) && !D.needsGc({ packs: 20, loose: 5000, busy: false }));
  return bad; }
const R0 = rd('tools/brain/route.mjs'), D0 = rd('tools/infra/diskclean.mjs'), B0 = rd('tools/brain/brain.mjs');
const run = async (r, d) => cases(await load('brain', r), await load('infra', d));
const bad = await run(R0, D0); ok(bad.length === 0, 'behaviour: ' + bad.join(' | '));
ok(/diskclean\.mjs/.test(B0) && /snap\.diskFreeGB = freeGB\(\)/.test(B0) && /key === 'disk-low'.*notify/.test(B0), 'brain.mjs does not wire the disk check + notify');
for (const [n, r, d] of [
  ['finding never fires', R0.replace('snap.diskFreeGB < (H.diskMinGB || 5)', 'false'), D0],
  ['gate ignores config', R0.replace('(H.diskMinGB || 5)', '5').replace('(H.diskMinGB || 5)', '5'), D0],
  ['stale deletes fresh', R0, D0.replace('now - e.mtime > age', 'true')],
  ['tmp ignores name filter', R0, D0.replace('(kind === \'diag\' || (kind === \'chrome\' ? CHROME_RE : TMP_RE).test(e.name))', 'true')],
  ['regex drops lockstep', R0, D0.replace('|lockstep|', '|')],
  ['chrome never cleaned', R0, D0.replace("hit.push(...stale(list(d), 'chrome', now))", '0')],
  ['chrome ignores name filter', R0, D0.replace('(kind === \'chrome\' ? CHROME_RE : TMP_RE)', 'TMP_RE')],
  ['busy runner not skipped', R0, D0.replace('if (busy(r.path)) continue;', '')],
  ['clean clone not skipped', R0, D0.replace('if (!needsGc({ ...cloneStats(git), busy: false })) continue;', '')],
  ['old tmp_ kept', R0, D0.replace("now - t.mtime > 86400e3) try { rmSync", "false) try { rmSync")],
  ['no rate limit', R0, D0.replace('< every) continue;', '< 0) continue;')],
  ['diag never cleaned', R0, D0.replace("hit.push(...stale(list(join(r.path, '_diag')), 'diag', now))", '0')],
]) { let c = false; if (r !== R0 || d !== D0) { try { c = (await run(r, d)).length > 0; } catch { c = true; } } ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
console.log(`diskcleancheck: ${asserts} assertions, ${fails} failed, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
