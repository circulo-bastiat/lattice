// auditledger.mjs - #4588: testers skip mobs already audited clean. The brain picks the mob BEFORE it starts the tester;
// a mob whose audit came back clean (0 bugs filed) is not picked again until a line that mentions it changes.
// Decision: docs/decisions/4588-audit-ledger.md. Pure helpers here; brain.mjs (pick) and launch.mjs (record) do the I/O.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, P } from './home.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const mobList = () => Object.keys(JSON.parse(readFileSync(join(ROOT, 'tools', 'mobl3-mobs.json'), 'utf8')).mobs);

/** Ledger = { mob: { at, hash } } of CLEAN audits. A missing file is an empty ledger; an unreadable one THROWS (caller falls back + mails the fixer). */
export function readLedger() {
  let t; try { t = readFileSync(P('audit-ledger.json'), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  const l = JSON.parse(t); if (!l || typeof l !== 'object' || Array.isArray(l)) throw new Error('audit-ledger.json is not an object');
  return l;
}
export function writeLedger(l) { mkdirSync(HOME, { recursive: true }); writeFileSync(P('audit-ledger.json'), JSON.stringify(l, null, 1)); }

const files = (d, out = []) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? files(p, out) : /\.(js|json)$/.test(f) && out.push(p); } return out; };
let cache = null;   // src lines, read once per process
export const forgetSrc = () => { cache = null; };
/** Hash of every src/ line (and tools/stages.d/*.json line) that names the mob: its entity/model/goal/sound/loot rows and its check data.
 *  ponytail: line-level, so an edit to shared goal CODE that never names the mob does not reopen it; widen to whole files if audits go stale. */
export function mobHash(mob, root = ROOT) {
  if (!cache || cache.root !== root) cache = { root, rows: [...files(join(root, 'src')), ...files(join(root, 'tools', 'stages.d'))].sort().map((f) => [f, readFileSync(f, 'utf8').split('\n')]) };
  const re = new RegExp(`(^|[^a-z0-9])${mob}([^a-z0-9]|$)`, 'i'), h = createHash('sha1');
  for (const [f, ls] of cache.rows) for (const l of ls) if (re.test(l)) h.update(f + l + '\n');
  return h.digest('hex').slice(0, 16);
}

// #7540 (Dan 15 Oct): machines prove what they can see; a tester only covers the in-game look and feel (3 poses, sound, drop).
// A mob is skipped when its machine proof is PROVEN (tools/mobproof/matrix.json) AND it has a visual sign-off in
// tools/mobproof-visual.json ({mob:{build,at}}, committed). The sign-off is void the moment the proof is not proven.
// The old line-hash ledger stays readable for one release (unproven mobs only); it no longer decides anything for proven ones.
export const provenSet = (root = ROOT) => { try { const M = JSON.parse(readFileSync(join(root, 'tools', 'mobproof', 'matrix.json'), 'utf8')); return new Set(Object.keys(M.rows).filter((m) => M.rows[m].proven)); } catch { return new Set(); } };
export const readVisual = (root = ROOT) => { try { return JSON.parse(readFileSync(join(root, 'tools', 'mobproof-visual.json'), 'utf8')); } catch { return {}; } };
/** Drop sign-offs of mobs whose proof is no longer proven. */
export const pruneVisual = (visual, proven) => Object.fromEntries(Object.entries(visual).filter(([m]) => proven.has(m)));
export const recordVisual = (visual, mob, build, at) => ({ ...visual, [mob]: { build, at } });
export const writeVisual = (v, root = ROOT) => writeFileSync(join(root, 'tools', 'mobproof-visual.json'), JSON.stringify(v, null, 1) + '\n');
const signed = (m, ctx) => !!(ctx.proven && ctx.proven.has(m) && ctx.visual && ctx.visual[m]);

/** The mobs to audit next: not signed off (proven + visual), not legacy-clean-and-unchanged (unproven only), not in flight. */
export function pickMobs(mobs, ledger, hashOf, k, inflight = [], ctx = {}) {
  const legacy = (m) => !(ctx.proven && ctx.proven.has(m)) && ledger[m] && ledger[m].hash === hashOf(m);
  return mobs.filter((m) => !inflight.includes(m) && !signed(m, ctx) && !legacy(m))
    .sort((a, b) => ((ledger[a] || {}).at || 0) - ((ledger[b] || {}).at || 0)).slice(0, k);
}
/** A finished audit: clean -> remembered with the hash it started from; a bug (or an unreadable report) clears the entry. */
export function record(ledger, mob, hash, clean, at) { const l = { ...ledger }; if (clean) l[mob] = { at, hash }; else delete l[mob]; return l; }
export const cleanCount = (mobs, ledger, hashOf, ctx = {}) => mobs.filter((m) => signed(m, ctx) || (!(ctx.proven && ctx.proven.has(m)) && ledger[m] && ledger[m].hash === hashOf(m))).length;
export const signedCount = (mobs, ctx) => mobs.filter((m) => signed(m, ctx)).length;
