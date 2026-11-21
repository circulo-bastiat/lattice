// tools/infra/coveredblock.mjs - #11908: big AUDIT-MAP / MUTATE issues are delivered a slice at a time, and hand-off "Next:" lists go stale (#11484 got YawAdjustingLookControl
// twice, #11487 had four no-code re-verify runs). When a partial PR lands, the lander records the classes it newly covered in a machine-managed block of the issue body;
// the brief (go.mjs start prints the body) then shows the next worker what is done. Nothing outside the block is ever rewritten.
export const START = '<!-- covered:start -->', END = '<!-- covered:end -->';

/** Simple names of the classes whose stage count rose between two tools/classmap.json texts ({rows: [class, module, wired, nstages, proof, verdict]}). Pure. */
export function coveredFrom(baseText, prText) {
  const rows = (t) => { try { return JSON.parse(t).rows || []; } catch { return []; } };
  const base = new Map(rows(baseText).map((r) => [r[0], r[3] || 0]));
  return rows(prText).filter((r) => (r[3] || 0) > (base.get(r[0]) || 0)).map((r) => String(r[0]).split('/').pop()).sort();
}

/** The body with `names` merged into its covered block (created at the end when absent). Unchanged when there is nothing to add. Pure. */
export function withCovered(body, names) {
  const b = String(body || ''), i = b.indexOf(START), j = b.indexOf(END);
  const old = i >= 0 && j > i ? ((/:\*\*\s*([^\n]*)/.exec(b.slice(i + START.length, j)) || [])[1] || '').split(',').map((x) => x.trim()).filter(Boolean) : [];
  const all = [...new Set([...old, ...names])].sort();
  if (!names.length || all.length === old.length) return b;
  const block = `${START}\n**Covered so far (lander, do not edit):** ${all.join(', ')}\n${END}`;
  return i >= 0 && j > i ? b.slice(0, i) + block + b.slice(j + END.length) : `${b.replace(/\s+$/, '')}\n\n${block}\n`;
}

/** Classes this PR newly covers: its own regenerated map against the master the lander fetched this round. [] when it did not touch the map. `sh` is land.mjs's runner. */
export function coveredFor(sh, n) {
  const ref = sh('git', ['rev-parse', '--verify', '-q', `pr${n}`]).status ? 'pr' : `pr${n}`;   // batch rounds fetch prN, the single path fetches pr
  const show = (r) => { const x = sh('git', ['show', `${r}:tools/classmap.json`], { maxBuffer: 1 << 26 }); return x.status ? '' : x.stdout; };
  return coveredFrom(show('origin/master'), show(ref));
}
