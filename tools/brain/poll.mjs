// #10419: bus routing by POLLING. brain.yml routed each bus comment from its `issue_comment` event, which needs a runner in the private repo (none: no hosted minutes,
// and the VM is retired). The hosted tick reads the bus every 5 minutes and routes what is new with the SAME routeComment (route.mjs, braincheck/routeevalcheck decisions
// unchanged). Pure: comments in, actions + the new cursor out. The cursor (highest bus comment id handled) lives in history.json (BRAIN_HOME, kept on usage-data).
import { routeComment } from './route.mjs';
export const FIRST_LOOKBACK_MS = 30 * 60e3;   // with no cursor yet, only mail from the last 30 minutes counts (not the whole bus)

export function pollPlan(comments, cursor, cfg, now = Date.now()) {
  const list = (comments || []).filter((c) => c && Number.isFinite(c.id)).sort((a, b) => a.id - b.id);
  const fresh = list.filter((c) => (cursor ? c.id > cursor : now - Date.parse(c.created_at) < FIRST_LOOKBACK_MS));
  const starts = new Map(), notifies = [];
  for (const c of fresh) {
    const d = routeComment(c.body, cfg);
    if (d.do === 'notify') notifies.push({ id: c.id, text: d.text, body: c.body });
    else if (d.do === 'start') starts.set(d.role, { role: d.role, id: c.id, reason: `bus:${c.id}` });   // one run per role per poll: it reads ALL its mail; the later comment wins
  }
  return { starts: [...starts.values()], notifies, cursor: list.length ? Math.max(cursor || 0, list[list.length - 1].id) : (cursor || 0), seen: fresh.length };
}
