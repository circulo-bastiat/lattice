// #11253: usage() reads every source (local file, usage-data branch, MCLITE_USAGE variable) and takes the one with the newest `at`.
// Each source is a raw JSON string or an object; empty/corrupt/missing/without accounts = skipped. Ties go to the earlier listed source.
export function pickUsage(sources, now = Date.now()) {
  let best = null;
  for (const [name, raw] of sources) {
    let u = raw; if (typeof raw === 'string') { try { u = JSON.parse(raw); } catch { u = null; } }
    if (!u || typeof u !== 'object' || !u.accounts) continue;
    const t = Date.parse(u.at || ''); const at = Number.isFinite(t) ? t : -Infinity;
    if (!best || at > best.at) best = { name, u, at };
  }
  return best && { u: best.u, source: best.name, ageMin: best.at === -Infinity ? null : Math.round((now - best.at) / 6e4) };
}
