#!/usr/bin/env node
// stagecheck.mjs — PASS 15 JOB 1: the roster comes from docs/archive/PLAN.md, not from memory. (D-375)
//
//   node tools/stagecheck.mjs             the full report (suite stage)
//   node tools/stagecheck.mjs --roster    print id -> state and stop; nothing else runs
//
// ⚠⚠ WHY THIS EXISTS. git 2a8efe1:docs/AUDIT-2026-09-17.md §3: "G19" meant right-click (shipped), the Nether/End
// (not started), advancements/statistics, AND background music, depending which file you opened,
// and "G20" meant statistics in one file and farming in another. Every owed gap in this engine —
// `Use.OWED`, `Cb.OWED`, `C.OWED`, `O.OWED`, `S.OWED_SOURCES`, `Rs.OWED_SOURCES`, `ER.OWED`,
// `ER.OWED_ITEM` — is a LIST THAT NAMES THE STAGE THAT WILL CLOSE IT, and that discipline is only
// as good as the id being unambiguous. An id that means two things is a stage nobody can tell
// they picked up. §2.11 showed the concrete cost: an owed row citing a stage that had ALREADY
// shipped sat there for four sessions because nothing said so.
//
// ⚠ THE ROSTER IS PARSED OUT OF `docs/archive/PLAN.md`, NEVER RETYPED. Two shapes carry a state glyph:
//   - an ATX heading:      `### ✅ G16 — The sky ...`     (2-6 #'s; G18a-f live at ####)
//   - a bold list item:    `- **✅ G16a — THE SKY'S NUMBERS.** ...`
// A stage that never got its own heading (G16a, G17a, G17b) only ever appears the second way, and
// a scan that only reads `###` would call every citation of them a stage that does not exist —
// which is wrong; they are shipped, D-3xx says so, and the code has cited them since session 9.
//
// ⚠ TWO FILES ARE READ AND DELIBERATELY NOT SCANNED FOR LIVE CITATIONS: `docs/DECISIONS.md` and
// `docs/archive/KNOWN-WRONG.md`. Both are append-only historical logs by their own charter — a struck
// KW entry keeps its body forever, and a closed DECISION is never edited — so both are FULL of
// correct, deliberate mentions of ids that used to be wrong or no longer exist (KW-4 literally
// preserves "`02j_sounds.js` also cited a `G16c` that has never existed" as the record of the
// bug this file now guards against). Scanning them would make the fix for a bug and the record
// of the bug fail the same check. `docs/archive/PLAN.md` and everything else in `docs/` is the board —
// live, and scanned.
//
// ⚠ `src/19_data.gen.js` IS EXCLUDED FROM THE SOURCE SCAN, ON PURPOSE, AND HERE IS THE PROOF: it
// is a 7.5 MB generated blob of packed/base64 asset bytes, not source with comments, and running
// this scan against it before this exclusion turned up eight hits, every one a coincidental
// substring of texture/model data (base64 has no notion of a word boundary), not a citation.
// `docs/archive/AGENTS.md` §3 already says never to `cat` this file; this is the same rule as a check.
//
// ⚠ TWO TOKENS ARE ALLOWLISTED BELOW, NAMED, NOT SILENCED. "G16c" never existed — `docs/archive/PLAN.md`
// §3.3's own "Was / Is now" table and `git 2a8efe1:docs/AUDIT-2026-09-17.md` §2.9 quote it deliberately, in
// backticks, as the worked example of the exact bug this tool exists to catch, so a future
// reader can see what the mistake looked like. "G99" is this project's own standing convention
// for "a stage that is obviously not real" (this file's anti-vacuity §(a) below, and git 2a8efe1:docs/passes/PASS-15-HISTORY.md
// JOB 1's own anti-vacuity instruction, use it the same way). A regex cannot tell "still wrong"
// from "correctly quoting what used to be wrong, on purpose" — a human already made that call,
// in the prose next to it — so this file trusts that judgement instead of re-litigating it on
// every run, the same way `knowncheck.mjs` trusts a `struck` entry instead of deleting it.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAN_PATH = join(ROOT, 'docs/archive/PLAN.md');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);

// ═══════════════ roster: parsed, not retyped ════════════════════════════════════════════════
const RANK = { open: 0, partial: 1, done: 2 };
const GLYPH_STATE = { '☐': 'open', '◐': 'partial', '✅': 'done' };
const STATE_GLYPH = { open: '☐', partial: '◐', done: '✅' };

/**
 * Parse `docs/archive/PLAN.md` into a Map<id, state>. Exported so the anti-vacuity section below can
 * call it on synthetic, broken text without touching a real file.
 */
export function parseRoster(text) {
  const roster = new Map();
  const setState = (id, state) => {
    if (!roster.has(id) || RANK[state] > RANK[roster.get(id)]) roster.set(id, state);
  };

  // shape 1 — an ATX heading, `##` to `######`, e.g. `#### ☐ G18a — the mob RENDERER ...`
  const headingRe = /^#{2,6}\s*([☐◐✅])\s*(G\d{1,3}[a-z]?)\b/gm;
  for (const m of text.matchAll(headingRe)) setState(m[2], GLYPH_STATE[m[1]]);

  // shape 2 — a bold bullet, e.g. `- **✅ G16a — THE SKY'S NUMBERS.** ...`
  const bulletRe = /^\s*-\s*\*\*([☐◐✅])\s*(G\d{1,3}[a-z]?)\b/gm;
  for (const m of text.matchAll(bulletRe)) setState(m[2], GLYPH_STATE[m[1]]);

  return roster;
}

// ═══════════════ citation scan ═══════════════════════════════════════════════════════════════
const CITATION_RE = /\bG\d{1,3}[a-z]?\b/g;

// see the header comment — both are a human's deliberate, on-the-record judgement call, not a
// blind spot; `--roster` and the roster print in §4 are unaffected, only the citation SCAN is.
const ALLOWLISTED_CITATIONS = new Set(['G16c', 'G99']);

const SCAN_EXCLUDE_FILES = new Set([
  join(ROOT, 'src/19_data.gen.js'),        // generated blob — see header
  join(ROOT, 'docs/DECISIONS.md'),         // append-only log — see header
  join(ROOT, 'docs/archive/KNOWN-WRONG.md'),       // append-only log — see header
  // THIS FILE. Its own anti-vacuity section below deliberately writes a synthetic, obviously-fake
  // citation (`G404`) to prove the detector fires — and it is written IN PROSE, not just in a
  // string a scanner could special-case, because the surrounding sentence has to stay readable.
  // Allowlisting every id a future test picks is a trap that only grows; excluding the one file
  // that legitimately talks ABOUT bad citations, rather than making one by mistake, does not.
  join(ROOT, 'tools/stagecheck.mjs')
]);

function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => extname(f) === ext)
    .map((f) => join(dir, f))
    .filter((f) => !SCAN_EXCLUDE_FILES.has(f));
}

/** Every citation in one line of text that resolves to neither the roster nor the allowlist. */
export function unresolvedCitations(line, roster) {
  const bad = [];
  for (const m of line.matchAll(CITATION_RE)) {
    if (!roster.has(m[0]) && !ALLOWLISTED_CITATIONS.has(m[0])) bad.push(m[0]);
  }
  return bad;
}

function scanFiles(files, roster) {
  const bad = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const id of unresolvedCitations(lines[i], roster)) {
        bad.push({ file: f.replace(ROOT, ''), line: i + 1, id });
      }
    }
  }
  return bad;
}

// ═══════════════ owed-list scan: an entry may not cite a stage that is already ✅ ════════════
// ⚠ EXACTLY THESE EIGHT, BY NAME (git 2a8efe1:docs/passes/PASS-15-HISTORY.md JOB 1 §3). A ninth owed list — `EL.owed()` in
// `src/07i_entitylist.js` — is a FUNCTION, not a literal, and `entlistcheck` already holds it;
// it is not scanned here because there is no literal body to extract.
const OWED_LISTS = [
  { file: 'src/14l_use.js', symbol: 'Use.OWED' },
  { file: 'src/14j_combat.js', symbol: 'Cb.OWED' },
  { file: 'src/15e_creative.js', symbol: 'C.OWED' },
  { file: 'src/15f_options.js', symbol: 'O.OWED' },
  { file: 'src/02j_sounds.js', symbol: 'S.OWED_SOURCES' },
  { file: 'src/07f_redstone.js', symbol: 'Rs.OWED_SOURCES' },
  { file: 'src/07j_entityrender.js', symbol: 'ER.OWED' },
  { file: 'src/07j_entityrender.js', symbol: 'ER.OWED_ITEM' }
];

/**
 * Pull the literal `[ ... ]` or `{ ... }` body assigned to `Symbol.Name = ...` out of `text`,
 * by bracket-depth counting (respecting quoted strings AND comments) rather than a fixed closing
 * pattern — the eight lists are not all the same shape (arrays and objects both appear) or the
 * same length. Returns null if the symbol is not assigned in this text at all.
 *
 * ⚠ COMMENTS MUST BE SKIPPED, NOT JUST STRINGS. `C.OWED`'s own body has a `//` comment containing
 * "the SIXTY items ... TAB's own chest icon" — an apostrophe inside a LINE COMMENT, not a string —
 * and a scanner that only understands quotes reads that apostrophe as opening a string, then
 * never finds a matching close before EOF. This is the §2.11 shape one level down: a check that
 * cannot read its own input silently reports "not found" for a list that is right there.
 */
export function extractOwedBody(text, symbol) {
  const needle = symbol.replace('.', '\\.') + '\\s*=\\s*';
  const m = new RegExp(needle).exec(text);
  if (!m) return null;
  let i = m.index + m[0].length;
  const open = text[i];
  if (open !== '[' && open !== '{') return null;
  const close = open === '[' ? ']' : '}';
  let depth = 0, inStr = null;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) return null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return text.slice(m.index + m[0].length, i + 1); }
  }
  return null; // unterminated — the caller treats this as a parse failure, not an empty list
}

/** Every quoted string literal inside a body — array ELEMENTS and object VALUES (and keys, which
 *  never cite a stage, so including them is harmless). */
function stringLiterals(body) {
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  for (const m of body.matchAll(re)) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

/**
 * For one owed list's body, the entries whose OPERATIVE citation — the stage that will actually
 * close the row — is already ✅. That is the LAST `Gxx` mentioned in the entry, not any of them:
 * several real rows correctly mention an already-shipped stage as CONTEXT before naming the one
 * they are actually waiting for (`O.OWED`'s Chat Settings: "G12 has chat; ... (G26)" — G12 is
 * true and done, G26 is what the row is owed on). Checking "any" flags that row as a false
 * positive; checking the LAST one does not, and still catches every real case found while
 * building this tool — `daylight_detector`'s sole citation, `lightning_rod`'s sole citation, and
 * so on all the way down to a row with exactly one id, where "last" and "any" agree.
 */
export function staleOwedEntries(body, roster) {
  const stale = [];
  for (const entry of stringLiterals(body)) {
    const ids = [...entry.matchAll(CITATION_RE)].map((m) => m[0]);
    if (ids.length && roster.get(ids[ids.length - 1]) === 'done') stale.push(entry);
  }
  return stale;
}

// ═══════════════ run it ══════════════════════════════════════════════════════════════════════
// ⚠ GUARDED, ON PURPOSE. `redcheck.mjs` (PASS 15 JOB 2) imports `parseRoster` from this file
// rather than re-parsing `docs/archive/PLAN.md` a second way — one source of truth for what "done" means
// (D-139). An unguarded script body would run ITS OWN suite-stage report, print it, and call
// `process.exit()` the moment anything merely IMPORTS this file, killing the importer's own
// process before its tests ever ran — which is exactly what happened the first time this file
// was imported, and is why this guard exists rather than being theoretical.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {

const planText = readFileSync(PLAN_PATH, 'utf8');
const roster = parseRoster(planText);

if (flag('--roster')) {
  for (const [id, state] of [...roster].sort()) console.log(`${STATE_GLYPH[state]} ${id}`);
  process.exit(0);
}

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };

// ── §0. the parse itself is not degenerate ──────────────────────────────────────────────────
console.log('0. the roster parses to something worth checking against');
ok(roster.size > 40, `only ${roster.size} stage ids parsed out of PLAN.md — the parse is broken`);

// ── §1/§2. every citation resolves ──────────────────────────────────────────────────────────
console.log('1/2. every G-id cited in src/, tools/ and docs/ is on the roster');
const files = [
  ...listFiles(join(ROOT, 'src'), '.js'),
  ...listFiles(join(ROOT, 'tools'), '.mjs'),
  ...listFiles(join(ROOT, 'docs'), '.md')
];
ok(files.length > 100, `only ${files.length} files scanned — the file list is broken`);
const badCitations = scanFiles(files, roster);
ok(badCitations.length === 0,
  `${badCitations.length} citation(s) name a stage not on the roster: ` +
  badCitations.slice(0, 20).map((b) => `${b.file}:${b.line} ${b.id}`).join('; ') +
  (badCitations.length > 20 ? ` ...and ${badCitations.length - 20} more` : ''));

// ── §3. no owed row cites a stage that is already ✅ ────────────────────────────────────────
console.log('3. no owed row cites a stage that has already shipped');
const staleRows = [];
const missingLists = [];
for (const { file, symbol } of OWED_LISTS) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const body = extractOwedBody(text, symbol);
  if (body === null) { missingLists.push(`${symbol} (${file})`); continue; }
  for (const entry of staleOwedEntries(body, roster)) staleRows.push(`${symbol}: "${entry}"`);
}
ok(missingLists.length === 0, `owed list(s) could not be found or did not parse: ${missingLists.join(', ')}`);
ok(staleRows.length === 0, `${staleRows.length} owed row(s) cite an already-✅ stage: ${staleRows.join(' | ')}`);

// ── §4. print the roster — the check is also the summary ───────────────────────────────────
console.log('\n4. the roster');
const byState = { done: [], partial: [], open: [] };
for (const [id, state] of roster) byState[state].push(id);
for (const s of ['done', 'partial', 'open']) byState[s].sort((a, b) => (a.length - b.length) || a.localeCompare(b));
console.log(`   ✅ done    (${byState.done.length}): ${byState.done.join(' ')}`);
console.log(`   ◐ partial (${byState.partial.length}): ${byState.partial.join(' ')}`);
console.log(`   ☐ open    (${byState.open.length}): ${byState.open.join(' ')}`);

// ── anti-vacuity (D-30): break each of the three checks above and prove it is caught ────────
console.log('\nanti-vacuity: break it, and it must be caught');
{
  // (a) a citation to a stage that does not exist — G404 rather than G99, precisely because G99
  // is this file's OWN allowlisted "obviously fake" id (see the header) and using it here would
  // test the allowlist instead of the detector.
  const fakeBad = unresolvedCitations('note: this deviation is filed under G404, which is not a real stage.', roster);
  okAv(fakeBad.includes('G404'), 'anti-vacuity: a citation to G404 (not on the roster) is caught by §1/§2');

  // (b) an owed row citing a stage that is already complete. G16 is ✅ on the real roster — if it
  // is not (a future renumber), the assertion below still proves the MECHANISM: inject a row
  // citing whatever id the roster itself reports as done.
  const doneId = [...roster].find(([, s]) => s === 'done')?.[0];
  ok(!!doneId, 'anti-vacuity setup: the real roster has at least one ✅ stage to inject (it does — G1..)');
  const fakeBody = `['a real gap (${doneId})']`;
  const stale = staleOwedEntries(fakeBody, roster);
  okAv(stale.length === 1, `anti-vacuity: an owed row citing ${doneId} (✅) is caught by §3`);

  // (c) delete a roster heading and the parse must shrink, not silently stay the same size
  const headingMatch = planText.match(/^#{2,6}\s*[☐◐✅]\s*G\d{1,3}[a-z]?\b.*$/m);
  ok(!!headingMatch, 'anti-vacuity setup: at least one heading exists to delete');
  const withoutOne = planText.replace(headingMatch[0], '');
  const shrunkRoster = parseRoster(withoutOne);
  okAv(shrunkRoster.size < roster.size,
    `anti-vacuity: deleting one heading shrinks the parsed roster (${roster.size} -> ${shrunkRoster.size}), it does not pass with a shorter roster silently`);

  // (d) extractOwedBody on an unterminated literal must fail closed (null), not return garbage
  okAv(extractOwedBody('Use.OWED = [\n  "unterminated"\n', 'Use.OWED') === null,
    'anti-vacuity: an unterminated owed-list literal returns null, not a truncated body');
}

console.log('');
console.log('=============== stagecheck ================');
console.log(` roster ids ......... ${roster.size}`);
console.log(` files scanned ....... ${files.length}`);
console.log(` bad citations ....... ${badCitations.length}`);
console.log(` stale owed rows ..... ${staleRows.length}`);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);

} // isMain
