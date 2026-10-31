// issuedup.mjs - #8206: the enlargers' filing tool (go.mjs newissue) refuses (a) a TWIN of an existing unit and (b) a unit aimed at a file that
// already has too many open units. Until now twins were prevented only by enlargers reading each other's chat (25 twins on 12-16 Oct) and the
// hot-file pile-up (53 advancement triggers into src/02l_advancements.js) became conflict-blocked PRs. Pure rules + two search calls.
import { readFileSync } from 'node:fs';
export const HOT_CAP = 6;
export const CODE = /^(G\d+[a-z]?-[A-Za-z]+\d+(?:-[A-Za-z_][A-Za-z0-9_]*)?)/;
export const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** [exact normalised title, code|tokens]. Tokens = minecraft:xxx ids and 'quoted' scenario names, so G18c-L1 'spawnegg' and G18c-L1 'spawnvariants' differ. */
export function keys(title) {
  const out = [norm(title)], m = CODE.exec(String(title || ''));
  if (m) {
    const toks = [...String(title).matchAll(/minecraft:[a-z_]+|'([^']+)'/g)].map((x) => x[0].toLowerCase()).sort();
    if (toks.length || /^G\d+[a-z]?-[A-Za-z]+\d+-/.test(m[1])) out.push(`${m[1].toLowerCase()}|${toks.join(',')}`);
  }
  return out;
}
// the {repo} placeholder must stay OUTSIDE the encoding: gh() substitutes it in the raw path
const Q = (rest, n) => `/search/issues?per_page=${n}&q=repo%3A{repo}+${encodeURIComponent(rest)}`;
const has = (i, l) => (i.labels || []).some((x) => (x.name || x) === l);
/** The first src/*.js (not generated) or tools/*.mjs path the body names, or null. */
export function primaryFile(body) { const m = /\b(src\/[\w.]+\.js|tools\/[\w./-]+\.mjs)\b/.exec(String(body || '')); return m && !/\.gen\.js$/.test(m[1]) ? m[1] : null; }
/** The mob a lockstep rollout title names (G17-L4-strider: lockstep ...), or null. */
export const rollMob = (t) => { const m = /^G\d+[a-z]?-[A-Za-z]+\d+-([A-Za-z_][A-Za-z0-9_]*)\b/.exec(String(t || '')); return m && /lockstep/i.test(t) ? m[1].toLowerCase() : null; };
/** moblockstepproof's rows by mob ({} when the file is absent). */
export function lockstepRows(f = new URL('../mobproof/out/lockstep.json', import.meta.url)) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } }
/** gh(path) -> parsed JSON. Returns null (fine to file) or { why, twin?, file?, count? }. */
export async function checkNew({ title, body }, gh, { cap = HOT_CAP, keyFn = keys, ignoreNotPlanned = true, rows = lockstepRows(), creditFree = true } = {}) {
  const code = (CODE.exec(String(title || '')) || [])[1];
  if (code) {
    const r = await gh(Q(`is:issue in:title "${code}"`, 50));
    const mine = new Set(keyFn(title));
    for (const i of (r && r.items) || []) {
      if (ignoreNotPlanned && i.state === 'closed' && i.state_reason === 'not_planned') continue;
      if (has(i, 'tracking')) continue;
      if (creditFree && i.state === 'closed' && rollMob(title) && !rows[rollMob(title)]) continue;   // #9070: no lockstep.json row = the closed twin's credit is stale; credit is the evidence
      if (keyFn(i.title).some((k) => mine.has(k))) return { twin: i.number, why: `twin of #${i.number} (${i.state}): "${String(i.title).slice(0, 70)}" - do not file it again` };
    }
  }
  const file = primaryFile(body);
  if (file) {
    const r = await gh(Q(`is:issue is:open -label:blocked -label:tracking in:body "${file}"`, 30));
    const n = r && Number.isFinite(r.total_count) ? r.total_count : 0;
    if (n >= cap) return { file, count: n, why: `${n} open units already edit ${file} (limit ${cap}): they would conflict with each other - file units for other files, or end your slice` };
  }
  return null;
}
