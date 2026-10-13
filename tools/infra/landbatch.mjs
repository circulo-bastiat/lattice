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
  const members = [], excluded = [];
  for (const it of items) {
    const m = sh('git', ['merge', '--no-ff', '-q', '-m', `land #${it.n} (batch)`, it.ref]);
    if (!m.status) { members.push(it.n); continue; }
    const why = resolve ? resolve() : 'no resolver';
    if (why) { sh('git', ['merge', '--abort']); excluded.push(it.n); } else members.push(it.n);
  }
  return { members, excluded };
}
