// tools/infra/metrics.mjs - pure core of the throughput/cost dashboard (#7771). No GitHub here: tools/metrics.mjs feeds it.
// A run = one bus comment "brain: <role> run ended (...)" written by tools/brain/launch.mjs; its comment id is the run id.
export const parseRun = (c) => {
  const m = /brain: (\w+) run ended \((ok|exit \d+), (\S+) turns, ([^)]*)\) \[usage (.*?); total \$([\d.]+); (\d+) min/s.exec(c.body || '');
  if (!m) return null;
  const sum = (k) => [...m[5].matchAll(new RegExp(`\\b${k} (\\d+)`, 'g'))].reduce((a, x) => a + +x[1], 0);
  const tail = (c.body || '').slice((m.index || 0) + m[0].length);
  const issue = (/\[#(\d+)\]\s*$/.exec(c.body.trim()) || [])[1] || null;
  return { id: c.id, at: c.created_at, role: m[1], account: m[4], turns: m[3] === '?' ? null : +m[3], usd: +m[6], min: +m[7], issue: issue && +issue,
    inTok: sum('in'), outTok: sum('out'), cw: sum('cw'), cr: sum('cr'), outcome: outcomeOf(tail, m[2]) };
};
export function outcomeOf(t, ok) {
  if (/CUT OFF/.test(t)) return 'gave-up';
  if (/LIMIT:/.test(t)) return 'limit';
  if (/already (fixed|done)|nothing to claim|no (claimable|issue)/i.test(t)) return /already/i.test(t) ? 'already-fixed' : 'no-claim';
  if (/--part|partly|partial/i.test(t)) return 'partial';
  if (/handed off|hand off|bounced/i.test(t) && !/queued|landed|finished/i.test(t)) return 'gave-up';
  return ok === 'ok' ? 'landed' : 'gave-up';
}
/** append-only merge keyed by run id: a run already stored is never replaced or doubled; nothing is ever dropped. */
export function merge(store, runs) {
  const have = new Set(store.runs.map((r) => r.id)), add = runs.filter((r) => r && !have.has(r.id) && have.add(r.id));
  return { ...store, runs: [...store.runs, ...add].sort((a, b) => a.id - b.id) };
}
/** headline numbers over [now-ms, now]. A bounce's cost belongs to the issue it ran on, not to the PR that landed later. */
export function summarize(store, now, ms) {
  const rs = store.runs.filter((r) => Date.parse(r.at) >= now - ms), by = {};
  for (const r of rs) by[r.outcome] = (by[r.outcome] || 0) + 1;
  const landed = rs.filter((r) => r.outcome === 'landed' && r.issue), usd = rs.reduce((a, r) => a + r.usd, 0);
  const perIssue = {}; for (const r of rs) if (r.issue) perIssue[r.issue] = (perIssue[r.issue] || 0) + r.usd;
  const landedIssues = new Set(landed.map((r) => r.issue));
  const landedUsd = [...landedIssues].reduce((a, i) => a + perIssue[i], 0);
  const short = rs.filter((r) => r.min <= 1);
  return { runs: rs.length, byOutcome: by, usd: +usd.toFixed(2), landedPRs: landedIssues.size,
    usdPerLanded: landedIssues.size ? +(landedUsd / landedIssues.size).toFixed(2) : null,
    tokPerRun: rs.length ? Math.round(rs.reduce((a, r) => a + r.cw + r.cr + r.inTok + r.outTok, 0) / rs.length) : null,
    shortRunShare: rs.length ? +(short.length / rs.length).toFixed(2) : null,
    bounceRate: rs.length ? +((by['gave-up'] || 0) / rs.length).toFixed(2) : null, perIssueUsd: perIssue };
}
/** a snapshot (queue depth, mirror load) is stale after 45 min and is labelled so, never shown as fresh. */
export const freshness = (at, now, maxMin = 45) => { const a = Math.round((now - Date.parse(at)) / 60e3); return a > maxMin ? `STALE (${a} min old)` : `fresh (${a} min old)`; };
export function html(store, now, snap) {
  const row = (n, ms) => { const s = summarize(store, now, ms); return `<tr><td>${n}</td><td>${s.runs}</td><td>${JSON.stringify(s.byOutcome)}</td><td>${s.landedPRs}</td><td>${s.usdPerLanded ?? '-'}</td><td>${s.shortRunShare ?? '-'}</td><td>${s.bounceRate ?? '-'}</td></tr>`; };
  return `<!doctype html><meta charset=utf-8><title>MC-Lite throughput</title><h1>Throughput and cost</h1><p>Built ${new Date(now).toISOString()}; queue snapshot ${snap ? freshness(snap.at, now) : 'none'}.</p>
<table border=1 cellpadding=4><tr><th>window</th><th>runs</th><th>by outcome</th><th>landed PRs</th><th>$ per landed PR</th><th>share of runs &lt;=1 min</th><th>bounce rate</th></tr>${row('24 h', 864e5)}${row('7 d', 6048e5)}</table>
<ul><li>run: one worker session (one bus line); outcome is read from the bus line text</li><li>$ per landed PR: notional $ of every run on an issue that landed, bounces included, divided by those issues</li><li>bounce rate: runs that gave up or were cut off / all runs</li></ul>`;
}
