// #7768: independent fresh-context review of landed work. Pure decision logic; the brain/lander call it.
export const CAPS = { maxPerHour: 6, maxPerDay: 40, restFraction: 5 };

// Input handed to the reviewer: issue text (with required: list), the diff, the check output. NEVER the worker summary.
export function buildInput(pr) {
  return { issue: pr.issueText, diff: pr.diff, checks: pr.checkOutput };
}

// Which landings get reviewed: every verifier-change, every <=3-turn run, 1 in N of the rest.
export function shouldSample(pr, n = 0, caps = CAPS) {
  if (pr.labels && pr.labels.includes('verifier-change')) return true;
  if (pr.workerTurns != null && pr.workerTurns <= 3) return true;
  return n % caps.restFraction === 0;
}

// Hard hourly/daily cap; never when the usage caps say stop. times = ms timestamps of past reviews.
export function allowed(times, now, usageStop, caps = CAPS) {
  if (usageStop) return false;
  return times.filter((t) => now - t < 3600e3).length < caps.maxPerHour && times.filter((t) => now - t < 86400e3).length < caps.maxPerDay;
}

export function parseVerdict(text) {
  const m = /\b(pass|mismatch|unclear)\b/i.exec(text || '');
  return m ? m[1].toLowerCase() : 'unclear';
}

// What a verdict does: mismatch reopens with label and mails the commander.
export function actions(verdict, issue) {
  const a = [{ do: 'comment', issue }, { do: 'bus', line: `review ${verdict} #${issue}` }];
  if (verdict === 'mismatch') a.push({ do: 'reopen', issue, label: 'review-mismatch' }, { do: 'mail', to: 'commander', issue });
  return a;
}

// 7-day counts + mean token cost for go.mjs status. reviews = [{t, verdict, tokens}]
export function summary(reviews, now = Date.now()) {
  const r = reviews.filter((x) => now - x.t < 7 * 86400e3), c = { pass: 0, mismatch: 0, unclear: 0 };
  for (const x of r) c[x.verdict]++;
  const tok = r.length ? Math.round(r.reduce((s, x) => s + (x.tokens || 0), 0) / r.length) : 0;
  return `reviewer 7d: ${c.pass} pass / ${c.mismatch} mismatch / ${c.unclear} unclear; ~${tok} tokens per review`;
}
