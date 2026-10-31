// tools/infra/required.mjs - #7767: the issue contract. An issue body may carry a fenced block
//     ```required
//     - [ ] text
//     ```
// Workers answer in the `done --msg`, one line per item, never by editing the body (the body's own [x] marks are IGNORED):
//     - [x] <item text or R<n>> :: evidence: <command output line | file path | commit>
//     - [ ] <item text or R<n>> :: blocked: <command + output>
//     - [ ] <item text or R<n>> :: does-not-fit: <why> :: follow-up: #N[, #M]
// Pure, no network. go.mjs done / the brief / status and tools/infra/land.mjs call it.
export const DONE_MARK = '<!-- mclite:required-done -->';       // in a PR body: every item ticked with evidence
export const OPEN_MARK = '<!-- mclite:required-open -->';       // in a PR body: some item is unticked (the lander keeps the issue open)
export const UNTICKED_HEAD = '**Unticked required items:**';    // in a hand-off: the next worker's brief starts with these lines
export const OUTCOME = (c) => `<!-- outcome:${c} -->`;

const norm = (s) => String(s || '').toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();

/** the required items of an issue body, in order; the [ ]/[x] box state in the body is deliberately not read */
export function parseRequired(body) {
  const m = /```[ \t]*required:?[ \t]*\r?\n([\s\S]*?)```/i.exec(body || '');
  if (!m) return [];
  return m[1].split(/\r?\n/).map((l) => /^\s*[-*]\s*\[[ xX]\]\s*(.+?)\s*$/.exec(l)).filter(Boolean).map((x) => x[1]);
}

/** answers in a hand-off message: [{ticked, key, kind, text}] */
export function parseAnswers(msg) {
  const out = [];
  for (const l of String(msg || '').split(/\r?\n/)) {
    const m = /^\s*[-*]\s*\[([ xX])\]\s*(.+?)\s*::\s*(evidence|blocked|does-not-fit)\s*:\s*(.*)$/i.exec(l);
    if (!m) continue;
    const kind = m[3].toLowerCase(), rest = m[4];
    out.push({ ticked: m[1] !== ' ', key: norm(m[2]), kind, text: rest.split(/\s*::\s*follow-up\s*:/i)[0].trim(), followUps: [...((/::\s*follow-up\s*:(.*)$/i.exec(rest) || [])[1] || '').matchAll(/#(\d+)/g)].map((x) => Number(x[1])) });
  }
  return out;
}

/** judge a hand-off against the items. finished = `done --finished` without --part.
 *  problems: what makes `done` refuse. unticked: honest remainders. needFollowUps: items whose reason is does-not-fit. */
export function evaluate(items, msg, { finished = false } = {}) {
  const ans = parseAnswers(msg), problems = [], unticked = [], needFollowUps = [];
  items.forEach((it, i) => {
    const a = ans.find((x) => x.key === `r${i + 1}` || x.key === norm(it) || (x.key.length >= 12 && norm(it).startsWith(x.key)));
    if (!a) { problems.push(`required item R${i + 1} "${it}" is not answered (silent skip)`); return; }
    if (a.ticked) {
      if (a.kind !== 'evidence' || a.text.length < 8) problems.push(`required item R${i + 1} "${it}" is ticked without evidence (':: evidence: <command output line | file path | commit>')`);
      return;
    }
    if (a.kind === 'evidence') { problems.push(`required item R${i + 1} "${it}" is unticked but gives evidence: tick it or give a reason`); return; }
    if (a.text.length < 8) { problems.push(`required item R${i + 1} "${it}" is unticked with no concrete reason`); return; }
    unticked.push({ item: it, kind: a.kind, text: a.text, followUps: a.followUps });
    if (a.kind === 'does-not-fit') needFollowUps.push({ item: it, followUps: a.followUps });
    if (finished) problems.push(`required item R${i + 1} "${it}" is unticked: --finished needs every item ticked with evidence (hand in with --part --owed, or without --finished, as an honest partial)`);
  });
  for (const n of needFollowUps) if (!n.followUps.length) problems.push(`"${n.item}" is 'does-not-fit': file the follow-up issue (go.mjs newissue --parent ...) and name it ':: follow-up: #N'`);
  return { problems, unticked, needFollowUps, allTicked: items.length > 0 && !problems.length && !unticked.length };
}

/** the PR-body marker the lander reads: when the ISSUE carries required items, the PR must prove them all ticked */
export function landerKeepsOpen(issueBody, prBody) {
  if (!parseRequired(issueBody).length) return false;
  return !String(prBody || '').includes(DONE_MARK) || String(prBody || '').includes(OPEN_MARK);
}

/** the unticked list a hand-off left, read back for the next brief */
export function owedFromHandoff(comments) {
  const h = (comments || []).filter((c) => typeof c?.body === 'string' && c.body.startsWith('**Hand-off**') && c.body.includes(UNTICKED_HEAD)).at(-1);
  if (!h) return [];
  return h.body.split(UNTICKED_HEAD)[1].split(/\r?\n/).map((l) => /^\s*-\s*(.+)$/.exec(l)).filter(Boolean).map((m) => m[1]);
}

/** run outcome classes. A run is one `<!-- brain-run N worker #M -->` marker; its outcome tag follows before the next marker.
 *  landed | partial-handoff | honest-partial | already-fixed | no-claim | gave-up */
export function classifyRun(tags, { claimed = true } = {}) {
  if (!claimed) return 'no-claim';
  for (const c of ['landed', 'honest-partial', 'partial-handoff', 'already-fixed']) if (tags.includes(c)) return c;
  return 'gave-up';
}
export function classifyIssue(comments) {
  const runs = []; let cur = null;
  for (const c of comments || []) {
    const b = c?.body || '';
    if (/^\*\*Commander/.test(b)) { runs.length = 0; cur = null; continue; }
    if (/^<!-- brain-run \S+ worker #\d+/.test(b)) { cur = { tags: [] }; runs.push(cur); continue; }
    const t = /<!-- outcome:([a-z-]+) -->/.exec(b);
    if (t && cur) cur.tags.push(t[1]);
  }
  return runs.map((r) => classifyRun(r.tags));
}
export const gaveUpTwice = (classes) => classes.length >= 2 && classes.slice(-2).every((c) => c === 'gave-up');
export function countClasses(all) { const n = { landed: 0, 'partial-handoff': 0, 'honest-partial': 0, 'already-fixed': 0, 'no-claim': 0, 'gave-up': 0 }; for (const c of all) n[c]++; return n; }
