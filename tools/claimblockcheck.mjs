// tools/claimblockcheck.mjs - #9889: a bounced PR (needs-rebase) is not hidden by the brain's burn-verdict `blocked`; autorebase's block stays.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const src = readFileSync(new URL('./infra/claimfilter.mjs', import.meta.url), 'utf8');
const L = (...n) => n.map((name) => ({ name }));
const I = (number, labels) => ({ number, labels: L(...labels), body: '' });
async function verdict(code) {
  const d = mkdtempSync(join(tmpdir(), 'cbc-'));
  writeFileSync(join(d, 'heldnow.mjs'), 'export const isHeld = () => false;');
  writeFileSync(join(d, 'briefguard.mjs'), readFileSync(new URL('./infra/briefguard.mjs', import.meta.url), 'utf8'));
  writeFileSync(join(d, 'phaselane.mjs'), readFileSync(new URL('./infra/phaselane.mjs', import.meta.url), 'utf8'));
  writeFileSync(join(d, 'claimfilter.mjs'), code);
  const { claimFilter, burnLabelsToClear } = await import(pathToFileURL(join(d, 'claimfilter.mjs')).href + '?' + Math.random());
  const bad = [], ids = claimFilter([I(1, ['needs-rebase', 'blocked', 'burn-blocked']), I(2, ['needs-rebase', 'blocked']), I(3, ['blocked', 'burn-blocked']), I(4, ['blocked', 'queued-family'])], {}).map((i) => i.number);
  if (!ids.includes(1)) bad.push('needs-rebase + burn-blocked must be claimable');
  if (ids.includes(2)) bad.push('the autorebase conflict-block (blocked + needs-rebase) must stay unclaimable');
  if (ids.includes(3)) bad.push('a burn-blocked issue without a bounced PR must stay unclaimable');
  if (ids.includes(4)) bad.push('queued-family block must stay unclaimable');
  if (burnLabelsToClear(['blocked', 'burn-blocked']).join() !== 'blocked,burn-blocked') bad.push('burn block must be cleared when a PR opens');
  if (burnLabelsToClear(['blocked', 'needs-rebase']).length) bad.push('autorebase block must not be cleared');
  return bad;
}
const real = await verdict(src);
const BREAKS = [
  [(s) => s.replace("(!lab(i, 'blocked') || staleBurnBlock(i) || staleHandoffBlock(i, now))", "!lab(i, 'blocked')"), 'stale block ignored'],
  [(s) => s.replace("(!lab(i, 'blocked') || staleBurnBlock(i) || staleHandoffBlock(i, now))", "true"), 'blocked ignored altogether'],
  [(s) => s.replace("lab(i, 'burn-blocked') && lab(i, 'needs-rebase')", "lab(i, 'needs-rebase')"), 'autorebase block treated as stale'],
  [(s) => s.replace("names.includes('burn-blocked') || names.includes('handoff-blocked') ? ['blocked', ...['burn-blocked', 'handoff-blocked'].filter((l) => names.includes(l))] : []", "names.includes('blocked') ? ['blocked'] : []"), 'clears any blocked'],
];
let caught = 0;
for (const [f, name] of BREAKS) { const m = f(src); if (m === src) { console.log('BREAK DID NOT APPLY:', name); continue; } if ((await verdict(m)).length) caught++; }
for (const b of real) console.log('FAIL', b);
console.log(`claimblockcheck: ${real.length} failed; ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
