// tools/infra/requests.mjs - #7686: the REQUEST contract (Dan's phone -> the `requests` role). One module for the brain half
// (go.mjs request ...) and the phone app's parser, so the two cannot drift. Pure: no network, no fs.
export const LABELS = { request: 'request', waiting: 'req:waiting', working: 'req:working', done: 'req:done' };
export const STATUS = ['req:waiting', 'req:working', 'req:done'];
export const MARK = '<!-- request -->';
export const DASH_MAX = 60000;

/** Issue title: the first line of Dan's words, max 80 chars. */
export const titleOf = (text) => (String(text).trim().split('\n')[0] || 'request').slice(0, 80);
/** Issue body: Dan's words verbatim, then the marker as the last line. */
export const bodyOf = (text) => `${String(text).replace(/\s+$/, '')}\n${MARK}`;
/** A comment: `from: <who>`, blank line, Markdown. */
export const commentOf = (who, md) => `from: ${who}\n\n${String(md).replace(/^\n+/, '')}`;
/** The bus mail that wakes the role. */
export const mailOf = (n) => `to: requests\nfrom: dan\ntype: info\n\n#${n}`;
/** A fenced block of a given kind. */
export const block = (kind, body) => '```' + kind + '\n' + body + '\n```';
export const undoBlock = (id, what, undo) => block('undo', JSON.stringify({ id, what, undo }));
export const resultBlock = (md) => block('result', md);

/** The comment's `from:` and Markdown body; null when the first line is not `from: x` + blank line. */
export function parseComment(body) {
  const m = /^from: ([^\r\n]+)\r?\n\r?\n([\s\S]*)$/.exec(String(body));
  return m ? { from: m[1].trim(), md: m[2] } : null;
}
/** Every fenced dashboard/result/undo block in a comment's Markdown. undo blocks that are not valid JSON with id/what/undo are dropped;
 *  dashboards over DASH_MAX chars or not a full HTML document are dropped. */
export function parseBlocks(md) {
  const out = [], re = /```(dashboard|result|undo)\r?\n([\s\S]*?)\r?\n```/g;
  let m;
  while ((m = re.exec(String(md)))) {
    const [, kind, text] = m;
    if (kind === 'undo') {
      try { const j = JSON.parse(text); if (j && typeof j.id === 'string' && typeof j.what === 'string' && typeof j.undo === 'string') out.push({ kind, ...j }); } catch { /* not a block */ }
    } else if (kind === 'dashboard') { if (text.length < DASH_MAX && /<html[\s>]/i.test(text) && !/(src|href)\s*=\s*["']?https?:/i.test(text)) out.push({ kind, html: text }); }
    else out.push({ kind, text });
  }
  return out;
}
/** Issue -> {status, isRequest}: exactly one status label is required. */
export function parseIssue(labels, body) {
  const ls = labels.map((l) => (typeof l === 'string' ? l : l.name));
  const st = STATUS.filter((s) => ls.includes(s));
  return { isRequest: ls.includes('request') && st.length === 1 && String(body).trimEnd().endsWith(MARK), status: st.length === 1 ? st[0] : null };
}
/** Dan's `undo <id>` comment -> id or null. */
export const undoIdOf = (md) => (/^undo (\S+)\s*$/.exec(String(md).trim()) || [])[1] || null;
/** The undo command recorded in the thread for <id> (the last block with that id), or null. */
export function findUndo(comments, id) {
  let found = null;
  for (const c of comments) { const p = parseComment(c.body); if (p && p.from !== 'dan') for (const b of parseBlocks(p.md)) if (b.kind === 'undo' && b.id === id) found = b; }
  return found;
}
