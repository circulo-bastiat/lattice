// tools/infra/bus.mjs - who a bus message (#53) is for, and which ones still wait for an answer. Pure: go.mjs feeds
// it the comments and this session's identity; tools/buscheck.mjs tests it without GitHub.
export const field = (body, k) => ((body.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '').trim();

/** Every address a session answers to. `sess` (loop | cloud | commander, from ~/.mclite-who or MCLITE_WHO) ALWAYS
 *  counts, even while the session holds an issue: the loop that claimed #58 stopped answering to `loop` and Dan's
 *  message sat unread (28 Sept, #63). Workflow workers share the orchestrator's HOME, so they answer to `loop` too. */
export function addresses({ me, role = null, sess = null }) {
  const num = (String(me || '').match(/^work\/(\d+)-/) || [])[1];
  const inst = String(sess || '').toLowerCase(), base = (inst.match(/^(.+)-\d+$/) || [])[1];   // #7772: enlarger-2 also hears the broadcast `enlarger`
  return [...new Set([me, num && `#${num}`, role, sess, base, num && 'sessions'].filter(Boolean).map((x) => String(x).toLowerCase()))];
}

/** #7772: `to: <role>` while the session is `<role>-<n>` is a broadcast to the role's instances: news, not a question,
 *  unless the sender wrote `reply: required` (or type reply/urgent). `to: enlarger-2` stays direct mail. */
export const isRoleBroadcast = (to, mine) => mine.some((m) => /-\d+$/.test(m) && m.replace(/-\d+$/, '') === to);

/** Message types (Dan, 10 Oct, from the phone's Talk tab). The `type:` header sets how hard a message interrupts:
 *  reply    needs an answer; blocks every tool call until `go.mjs reply` (also when sent to `all`)
 *  urgent   as reply, and the block says to drop what you are doing
 *  announce no answer; shown to the session once, on its next tool call
 *  info     FYI; lands on the bus only (inbox shows it), never interrupts
 *  No `type:` = the old rules (direct mail needs a reply; `to: all` is news unless it says `reply: required`). */
export const TYPES = ['reply', 'urgent', 'announce', 'info'];
export const typeOf = (body) => { const t = field(String(body || ''), 'type').toLowerCase(); return TYPES.includes(t) ? t : ''; };

/** A group address: one reply answers it for everyone who shares it (the loop's orchestrator and its workers). */
const GROUP = new Set(['loop']);

/** Comments addressed to `mine` that are not replies and are not answered yet. */
export function pending(all, mine, alsoAnswered = []) {
  const answered = new Set([...alsoAnswered, ...all.filter((c) => mine.includes(field(c.body, 'from').toLowerCase())).map((c) => field(c.body, 're'))]);
  for (const c of all) {
    const re = field(c.body, 're'); if (!re) continue;
    const q = all.find((x) => String(x.id) === re);
    if (!q) continue;
    const qto = (field(q.body, 'to') || 'all').toLowerCase(), n = (qto.match(/^#(\d+)$/) || [])[1], rf = field(c.body, 'from').toLowerCase();
    if (GROUP.has(qto)) answered.add(re);
    else if (n && (rf === `#${n}` || rf.startsWith(`work/${n}-`))) answered.add(re);   // #76: an answer by ANY holder of #N answers mail to #N
  }
  return all.filter((c) => {
    const to = (field(c.body, 'to') || 'all').toLowerCase();
    const ty = typeOf(c.body), bc = isRoleBroadcast(to, mine), asked = /^reply:\s*required/m.test(c.body) || ty === 'reply' || ty === 'urgent';
    const direct = (mine.includes(to) && (!bc || asked)) || (to === 'all' && (/^reply:\s*required/m.test(c.body) || ty === 'reply' || ty === 'urgent'));
    return direct && ty !== 'announce' && ty !== 'info' && !field(c.body, 're') && !mine.includes(field(c.body, 'from').toLowerCase()) && !answered.has(String(c.id));
  });
}

/** Announcements for this session it has not been shown yet: `type: announce`, to it or to `all`, not a reply, not from itself. */
export function news(all, mine, seen = []) {
  const done = new Set(seen.map(String));
  return all.filter((c) => {
    const to = (field(c.body, 'to') || 'all').toLowerCase();
    return typeOf(c.body) === 'announce' && (to === 'all' || mine.includes(to)) && !field(c.body, 're') && !mine.includes(field(c.body, 'from').toLowerCase()) && !done.has(String(c.id));
  });
}
