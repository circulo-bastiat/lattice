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

/** The mobs to audit next: not clean-and-unchanged, not already in flight; never-audited / oldest clean audit first. */
export function pickMobs(mobs, ledger, hashOf, k, inflight = []) {
  return mobs.filter((m) => !inflight.includes(m) && !(ledger[m] && ledger[m].hash === hashOf(m)))
    .sort((a, b) => ((ledger[a] || {}).at || 0) - ((ledger[b] || {}).at || 0)).slice(0, k);
}
/** A finished audit: clean -> remembered with the hash it started from; a bug (or an unreadable report) clears the entry. */
export function record(ledger, mob, hash, clean, at) { const l = { ...ledger }; if (clean) l[mob] = { at, hash }; else delete l[mob]; return l; }
export const cleanCount = (mobs, ledger, hashOf) => mobs.filter((m) => ledger[m] && ledger[m].hash === hashOf(m)).length;
