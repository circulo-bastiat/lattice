// lib.mjs - the pure scoring rules of the worker-prompt eval (#7774). run.mjs does the I/O; evalharnesscheck proves these.
export const scoreCase = (r, b) => {
  // end state decides: every end-state check of the original PR must pass and every required item be done.
  const checksOk = r.checks.length > 0 && r.checks.every((c) => c.pass);
  const itemsOk = (r.required || []).every((x) => x.done);
  const withinBudget = r.tokens <= b.maxTokensPerCase;
  const pass = checksOk && itemsOk && withinBudget;
  return { pass, score: pass ? 1 : (r.checks.filter((c) => c.pass).length / Math.max(1, r.checks.length)) * 0.5, tokens: r.tokens, minutes: r.minutes, withinBudget };
};
// runs = [{pass}] of ONE case; a case whose result differs between runs is flaky.
export const isFlaky = (runs) => new Set(runs.map((x) => x.pass)).size > 1;
// comparisons use only non-flaky cases.
export const passRate = (cases) => {
  const use = cases.filter((c) => !c.flaky);
  return { n: use.length, excluded: cases.length - use.length, rate: use.length ? use.filter((c) => c.pass).length / use.length : 0 };
};
// hard budget from roles.json "evals": false = refuse to run, with the reason.
export const budgetGate = (b, st) => {
  if (st.cases > b.maxCasesPerRun) return { ok: false, why: `cases ${st.cases} > maxCasesPerRun ${b.maxCasesPerRun}` };
  if (st.model !== b.model) return { ok: false, why: `model ${st.model} is not the eval model ${b.model}` };
  if (st.usagePct >= b.maxUsagePct) return { ok: false, why: `usage ${st.usagePct}% >= cap ${b.maxUsagePct}%` };
  if (st.tokensSoFar >= b.maxTokensPerRun) return { ok: false, why: `tokens ${st.tokensSoFar} >= maxTokensPerRun ${b.maxTokensPerRun}` };
  return { ok: true };
};
// a change to roles.json prompts / tools.json needs an eval report naming the new content hash.
export const needsReport = (changedFiles, reportHashes, hashNow) =>
  !changedFiles.some((f) => /(^|\/)(roles|tools)\.json$/.test(f)) || reportHashes.includes(hashNow);
export const reportText = (cases, cost) => {
  const p = passRate(cases);
  return `pass-rate ${(p.rate * 100).toFixed(0)}% of ${p.n} stable cases (${p.excluded} flaky excluded); total cost ${cost.tokens} tokens, ${cost.minutes.toFixed(1)} min`;
};
