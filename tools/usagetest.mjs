#!/usr/bin/env node
// tools/usagetest.mjs - #1497 (Dan, 1 Oct: "pro sonnet is feeling really fishy on usage, like insane rise at the beginning").
// For each account (pro, max), when its 5-hour window is under 60%: read usage, run ONE trivial headless Sonnet session in
// an EMPTY directory (run A: the fixed start-up cost) and one in the mclite checkout (run B: what a worker's start adds),
// read usage again at +0 / +60 / +180 s (the endpoint lags). Fixed samples only - no polling loop. Writes
// _status/usage-test.json and mails the plain-English table to Dan.   Run: the `usagetest` workflow, or  node tools/usagetest.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { profiles, readUsage } from './usaged.mjs';
import { projectsDirs, ROOT } from './infra/gh.mjs';
import { measurable, table } from './usagetestlib.mjs';

const PROMPT = 'Reply with the single word: ok';
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const pick = (u) => ({ window: u && u.window ? u.window.pct : null, week: u && u.week ? u.week.pct : null });

function session(dir, cwd) {
  const r = spawnSync('claude', ['-p', PROMPT, '--model', 'sonnet', '--max-turns', '1', '--output-format', 'json'], {
    cwd, encoding: 'utf8', timeout: 4 * 60e3, shell: process.platform === 'win32', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: '' },
  });
  let j = {}; try { j = JSON.parse(r.stdout); } catch {}
  const u = j.usage || {};
  return { tokens: { in: u.input_tokens, out: u.output_tokens, cw: u.cache_creation_input_tokens, cr: u.cache_read_input_tokens }, cost: j.total_cost_usd, ok: r.status === 0 && !!j.usage, err: (r.stderr || '').slice(0, 200) };
}

const rows = [], skipped = [], P = profiles();
for (const account of ['pro', 'max']) {
  if (!P[account]) { skipped.push(`${account}: no profile`); continue; }
  for (const [run, cwd] of [['A empty dir', mkdtempSync(join(tmpdir(), 'usagetest-'))], ['B repo dir', ROOT]]) {
    const before = await readUsage(P[account]);
    if (!measurable(before)) { skipped.push(`${account} ${run}: ${before.ok ? `window at ${before.window && before.window.pct}%` : before.why}`); continue; }
    const s = session(P[account], cwd);
    if (!s.ok) { skipped.push(`${account} ${run}: session failed ${s.err}`); continue; }
    const samples = [];
    for (const t of [0, 60, 180]) {                        // 0, 60, 180 s after the run
      if (t) await sleep(t === 60 ? 60 : 120);
      const u = await readUsage(P[account]);
      if (u.ok) samples.push({ t, ...pick(u) });
    }
    rows.push({ account, run, before: pick(before), samples, tokens: s.tokens, cost: s.cost });
  }
}
const text = table(rows) + (skipped.length ? `\n\nSkipped: ${skipped.join('; ')}` : '');
console.log(text);
const dir = projectsDirs().map((d) => join(d, '_status'))[0];
if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'usage-test.json'), JSON.stringify({ at: new Date().toISOString(), rows, skipped, text }, null, 1)); }
spawnSync('node', [join(ROOT, 'tools', 'go.mjs'), 'say', '--to', 'dan', `usage test (#1497)\n${text}`], { env: { ...process.env, MCLITE_WHO: 'commander' }, stdio: 'inherit' });
