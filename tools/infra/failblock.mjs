// tools/infra/failblock.mjs - the "──── <id> FAILED ────" block of the suite output, as full.mjs quotes it in the `master is red` comment.
// The block ends at the NEXT suite header (another FAILED block, or the `==== suite ====` table), never at a bare `====` line: a check prints its
// OWN `================ soundcheck ================` summary, and cutting there hid the very `FAIL  ...` lines that say why it is red
// (25 Oct: soundcheck, optionscheck, cullcheck, g11bcheck were "red" in every comment with 25 passing lines and no reason).
export const FAIL_BLOCK_MAX = 45;   // suite.mjs prints up to 12 early failing lines + 25 tail lines + 2 labels
export function failBlock(out, id) {
  const L = String(out).split('\n'), i = L.findIndex((l) => l.includes(`──── ${id} FAILED ────`));
  if (i < 0) return `──── ${id}: no FAILED block in the suite output`;
  let j = i + 1;
  while (j < L.length && j <= i + FAIL_BLOCK_MAX && !/^──── /.test(L[j]) && !/^=+ suite[ (=]/.test(L[j])) j++;
  return L.slice(i, j).join('\n').trimEnd();
}
