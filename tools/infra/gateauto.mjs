// gateauto.mjs - #8878 (Dan, 18 Oct: "Build it, strict conditions"): Gate M (#585) lifts itself, and only when ALL four hold.
// Pure decision: decide({ matrix, issues, now }) -> { lift, conds }. Fails CLOSED on a missing/unreadable/stale/unstamped matrix.
const lab = (i, l) => (i.labels || []).some((x) => (x.name || x) === l);
export const MAX_AGE_H = 6, KW = [578, 579, 581, 582, 584], DIMS = ['model', 'texture', 'animation', 'drops', 'spawn', 'lockstep', 'goals'];
export function decide({ matrix, issues = [], now = Date.now() } = {}) {
  const open = issues.filter((i) => !i.pull_request), M = matrix && typeof matrix === 'object' ? matrix : null, rows = M && M.rows && typeof M.rows === 'object' ? M.rows : null;
  const at = M && M.full === true && M.sha && Date.parse(M.generatedAt);
  const age = Number.isFinite(at) ? (now - at) / 36e5 : null;
  const names = rows ? Object.keys(rows) : [], cells = names.flatMap((n) => DIMS.map((d) => rows[n][d]));
  const proven = names.filter((n) => DIMS.every((d) => rows[n][d] === 'green') && rows[n].proven === true).length;
  const bad = cells.filter((c) => c !== 'green').length;
  const proofOpen = open.filter((i) => /^\s*PROOF\b/i.test(i.title || '') || lab(i, 'proof')).length;
  const finds = open.filter((i) => lab(i, 'tester-finding') || KW.includes(i.number)).map((i) => i.number);
  const conds = {
    fresh: { ok: age !== null && age >= 0 && age <= MAX_AGE_H, value: age === null ? 'matrix missing/unreadable/unstamped (needs full:true, sha, generatedAt)' : `${age.toFixed(1)} h old, sha ${M.sha}` },
    proven: { ok: !!rows && names.length > 0 && names.length === M.roster && proven === M.roster && M.proven === M.roster, value: rows ? `${proven}/${M.roster} (${names.length} rows)` : 'no rows' },
    dry: { ok: !!rows && bad === 0 && proofOpen === 0, value: rows ? `${bad} red/missing cells, ${proofOpen} open PROOF issues` : 'no rows' },
    findings: { ok: finds.length === 0, value: finds.length ? `open: ${finds.map((n) => '#' + n).join(' ')}` : 'none open' },
  };
  return { lift: Object.values(conds).every((c) => c.ok), conds };
}
export const comment = (r) => `**GATE-AUTO (#8878): Gate M lifted.** Every condition held:\n${Object.entries(r.conds).map(([k, c]) => `- ${k}: ${c.value}`).join('\n')}\n\nUndo: reopen #585 (\`gh issue reopen 585\`).`;
