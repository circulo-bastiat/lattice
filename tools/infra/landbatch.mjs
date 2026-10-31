// tools/infra/landbatch.mjs - #5760 (Dan, 11 Oct: "merge train ... the merge is one lander but the pushing is multiple"). The pure/git parts of the
// batch lander (land.mjs does the GitHub calls): which PRs to take, and merging them one after another onto the checked-out master.
export const BATCH_DEFAULT = 4;

/** The PRs the next round takes together. [] = take one the old way: batching off (size < 2), backing off after a red batch, or fewer than 2 queued. */
export function pickBatch(queue, size, off) {
  if (!(size >= 2) || off > 0 || queue.length < 2) return [];
  return queue.slice(0, size);
}

/** Merge each {n, ref} onto the current tree in order. A PR that conflicts is aborted and LEFT OUT (still labelled `land`: the single path bounces it
 *  with its own message), unless `resolve()` finishes the merge (land.mjs passes the shared-list auto-merge, '' = finished). Returns the PR numbers merged / left out. */
export function mergeBatch(sh, items, resolve) {
  const members = [], excluded = [], heads = {};   // #9683: heads[n] = the local merge commit after member n = the tested tree of members 1..n
  const head = () => String(sh('git', ['rev-parse', 'HEAD']).stdout || '').trim();
  for (const it of items) {
    const m = sh('git', ['merge', '--no-ff', '-q', '-m', `land #${it.n} (batch)`, it.ref]);
    if (!m.status) { members.push(it.n); heads[it.n] = head(); continue; }
    const why = resolve ? resolve() : 'no resolver';
    if (why) { sh('git', ['merge', '--abort']); excluded.push(it.n); } else { members.push(it.n); heads[it.n] = head(); }
  }
  return { members, excluded, heads };
}

/** #9640: the one-PR backoff after a red batch counts only rounds that really tested a PR; a skipped head (ghost, closed, unlabelled) must not use it up. */
export const backoffAfter = (off, result) => (off > 0 && result !== 'skipped' ? off - 1 : off);
/** #9640: after a red batch the single rounds go to the batch's own members first (the culprit is among them); otherwise the queue head. */
export const singleHead = (queue, redMembers) => (redMembers && redMembers.size ? (queue.find((n) => redMembers.has(n)) ?? queue[0]) : queue[0]);

/** #9743: the members a red batch most likely owes its red to. failed = check ids from the red rows (` ✗ <id>`), files = {n: [changed paths]},
 *  src = (id) => that check's source text or ''. A member is a suspect when it changes the check itself, its stage file, or a file the check names
 *  (basename of 5+ chars, the shared lists excluded). Exactly one suspect lets the lander test it alone first; any other count = the old 3 single rounds. Pure. */
export const failedIds = (out) => [...new Set([...String(out || '').matchAll(/^ \u2717 (\S+)/gm)].map((m) => m[1]))];
const SHARED = /^tools\/(core|quarantine|protected)\.json$|^tools\/stages\.d\//;
export function suspects(failed, files, src) {
  if (!failed.length) return [];
  return Object.keys(files).map(Number).filter((n) => (files[n] || []).some((f) => failed.some((id) => {
    if (f === `tools/${id}.mjs` || f === `tools/stages.d/${id}.json`) return true;
    if (SHARED.test(f)) return false;
    const base = f.split('/').pop();
    return base.length >= 5 && String(src(id) || '').includes(base);
  })));
}

/** #9849: a red batch is bisected: [first half, second half] (the first is the larger on an odd count). Each is tested as its own batch round. */
export const halves = (members) => { const k = Math.ceil(members.length / 2); return members.length < 2 ? [] : [members.slice(0, k), members.slice(k)]; };
