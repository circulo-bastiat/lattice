// #8395: the pure half of the lander's anti-vacuity gate (land.mjs has side effects on import, so the check imports this).
// One suite row looks like ` ✓ <id>   123 ms  ...`; the id is matched ONLY in that row format, never in free text or the
// live progress copy. Each id is classified: ok | nobreaks | failed | skipped | norow.
export function classify(id, stdout) {
  const re = new RegExp(`^ ([✓✗·]) ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d+ ms`);
  const lines = (stdout || '').split('\n'); const i = lines.findIndex((l) => re.test(l));
  if (i < 0) return { id, state: 'norow', row: '', block: [] };
  const row = lines[i]; const mark = row[1];
  const block = lines.slice(i + 1, i + 27);
  if (mark === '·') return { id, state: 'skipped', row, block: [] };
  if (mark === '✗') return { id, state: 'failed', row, block };
  return { id, state: /[1-9]\d*\s+(deliberate\s+)?breaks?\s+caught/i.test(row) ? 'ok' : 'nobreaks', row, block: [] };
}

// kinds: {id: stage kind}; fast: the suite ran with --fast. null = fine, else {why, out, ids}.
export function judge(ids, stdout, kinds = {}, fast = true) {
  const bad = []; const why = []; const head = [];
  for (const id of ids) {
    const c = classify(id, stdout);
    if (c.state === 'ok') continue;
    bad.push(id);
    if (c.state === 'norow') why.push(`${id} has no result row in the suite output (stage not selected or not run on the mirror)`);
    else if (c.state === 'failed') why.push(`${id} FAILED: ${c.row.trim()}`);
    else if (c.state === 'skipped' && /not selected/.test(c.row)) why.push(`${id} has no result row in the suite output (stage not selected or not run on the mirror)`);
    else if (c.state === 'skipped') {
      if (fast && kinds[id] === 'browser') why.push(`${id} is a browser stage SKIPPED by --fast, so nothing proved it can fail`);
      else { bad.pop(); continue; }
    } else why.push(`${id} ran but caught 0 breaks - a new check must break its own data and report "<n> breaks caught" (D-30)`);
    if (c.row) head.push(c.row, ...c.block);
  }
  if (!bad.length) return null;
  return { why: `anti-vacuity: ${why.join('; ')}.`, out: head.join('\n') + '\n--- tail ---\n' + (stdout || '').slice(-1200), ids: bad };
}

// Root cause of the 21 Oct bounces (#9280 #9278 #9294 #9295): the gate ran EVERY added stage with --fast, and --fast skips browser
// stages, so a PR that adds one could never be merged ("nothing proved it can fail") - workers burned 10-17 turns per bounce inventing
// pure companion checks. Browser stages now run WITHOUT --fast (on the mirror when TEST_REMOTE=mirror), the rest keep --fast.
export function splitByKind(ids, kinds = {}) {
  return { fastIds: ids.filter((id) => kinds[id] !== 'browser'), browserIds: ids.filter((id) => kinds[id] === 'browser') };
}
