// inbox.js - the phone's Inbox (#4180): every push the brain sent in the last 7 days as a feed. A push is ephemeral, so the brain's notify() also records each one
// as a comment on the open issue labelled `push-log`: `<!-- push-log -->` then one JSON line {at,title,text,url}. Tap = the same deep link the push carried.
(function (root) {
  const MARK = '<!-- push-log -->', WEEK = 7 * 86400e3, LABEL = 'push-log';
  const record = ({ at, title, text, url }) => `${MARK}\n${JSON.stringify({ at: at || Date.now(), title: title || 'MC-Lite', text: String(text || ''), url: url || '/' })}`;
  /** comments -> entries newest first, only the last 7 days; non-push comments and bad JSON are skipped */
  function feed(comments, now) {
    return (comments || []).filter((c) => String(c.body || '').startsWith(MARK)).flatMap((c) => {
      try { const e = JSON.parse(c.body.slice(c.body.indexOf('\n') + 1)); return e && now - e.at < WEEK && e.at <= now + 60e3 ? [{ id: c.id, ...e }] : []; } catch { return []; }
    }).sort((a, b) => b.at - a.at);
  }
  /** the deep link as an in-app hash: '/#/questions' -> '#/questions', '/' -> '#/' */
  const hashOf = (url) => { const i = String(url || '/').indexOf('#'); return i < 0 ? '#/' : String(url).slice(i); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = (list, ago) => (list.length ? list.map((e) => `<a class="ui-row inbox" href="${esc(hashOf(e.url))}"><b>${esc(e.title)}</b><small>${esc(ago(e.at))}</small><div>${esc(e.text)}</div></a>`).join('') : '<p class="empty">No pushes in the last 7 days.</p>');
  /** read the log through gh(method, path): the open push-log issue's newest comments */
  async function load(gh, now) {
    const l = (await gh('GET', `/repos/{repo}/issues?labels=${LABEL}&state=open&per_page=1`)) || [];
    if (!l[0]) return [];
    const n = l[0].number, first = await gh('GET', `/repos/{repo}/issues/${n}/comments?per_page=100`);
    return feed(first || [], now);
  }
  root.Inbox = { MARK, WEEK, LABEL, record, feed, hashOf, html, load };
  if (typeof module !== 'undefined') module.exports = root.Inbox;
})(typeof self !== 'undefined' ? self : globalThis);
