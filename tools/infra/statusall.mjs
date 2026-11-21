// #7689: when exactly STATUS_AT workers are running, the brain asks every worker for its status (one `to: sessions` mail
// carrying `ask: status-<id>`) and waits for ALL replies (`re: <comment id>`, one per worker) before asking again.
export const STATUS_AT = 7;
/** Ask now? Only at exactly STATUS_AT running workers and with no earlier ask still waiting. */
export const shouldAsk = (running, pending) => running === STATUS_AT && !pending;
/** The mail body for an ask. */
export const askText = () => 'status? Reply with `go.mjs reply <this id> "<issue, step, what is left>"` in one line.';
/** Where an ask stands: `from:` lines of the replies to commentId, who of `expected` is still missing, done when none is. */
export function collect(comments, askId, expected) {
  const field = (b, k) => ((new RegExp(`^${k}:\\s*(.+)$`, 'mi').exec(String(b)) || [])[1] || '').trim();
  const got = new Set(comments.filter((c) => field(c.body, 're') === String(askId)).map((c) => field(c.body, 'from').toLowerCase()));
  const missing = expected.map((w) => w.toLowerCase()).filter((w) => !got.has(w));
  return { got: [...got], missing, done: missing.length === 0 };
}
