// tools/infra/landtree.mjs - #4972 (10 Oct 2026): the lander bounced every PR for ~90 min with "local changes ... would be
// overwritten by merge" because two golden TSVs sat on master as CRLF blobs under `eol=lf`, so the lander's tree was dirty
// right after `reset --hard`. A dirty lander tree is the LANDER's fault, never the PR's: land.mjs must not bounce the PR.
// badEolLines: committed (index) CRLF/mixed text under eol=lf, from `git ls-files --eol`.
export const badEolLines = (lsEol) => String(lsEol).split('\n').filter((l) => /^i\/(crlf|mixed)\b[^\t]*\battr\/[^\t]*\beol=lf\b/.test(l));
// dirtyTracked: tracked files that differ from the index/HEAD in `git status --porcelain` (untracked '??' lines are data folders).
export const dirtyTracked = (porcelain) => String(porcelain).split('\n').filter((l) => l.trim() && !l.startsWith('??')).map((l) => l.replace(/^.{2} /, ''));
