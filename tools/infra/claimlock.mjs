// tools/infra/claimlock.mjs - #6416 (12 Oct): four workers dispatched within 16 s took the same stale issue twice over. A takeover is now exclusive:
// claim() first creates refs/claims/<issue>-<sha12>-<bucket> (POST /git/refs; 422 = another worker holds this exact claim) and also treats an issue
// as held when another run's `<!-- brain-run N worker #M -->` comment is newer than 10 minutes. Pure, no network.
export const BUCKET_MS = 10 * 60 * 1000;
export function claimKey(issue, sha, now = Date.now()) {
  if (!Number.isInteger(issue) || issue <= 0) throw new Error('claimKey: issue');
  if (typeof sha !== 'string' || !/^[0-9a-f]{12,}$/i.test(sha)) throw new Error('claimKey: sha');
  if (!Number.isFinite(now)) throw new Error('claimKey: now');
  return `refs/claims/${issue}-${sha.slice(0, 12).toLowerCase()}-${Math.floor(now / BUCKET_MS)}`;
}
/** true when a comment from a run other than `myRun` carries a worker marker younger than 10 minutes */
export function heldByComment(comments, myRun, now = Date.now()) {
  return (comments || []).some((c) => {
    const m = /^<!-- brain-run (\S+) worker #\d+/.exec(c?.body || '');
    return !!m && String(m[1]) !== String(myRun || '') && now - Date.parse(c.created_at) < BUCKET_MS && now >= Date.parse(c.created_at) - 60000;
  });
}
