#!/usr/bin/env node
// lockstep-rowcheck -- #9780: every tools/stages.d/lockstep-*.json stage has a row in golden/lockstep-table.tsv (and no row lacks a stage).
// Cheap (ids vs the tsv check column, no table regeneration), so it is in core: a PR that adds a lockstep stage without
// `node tools/lockstep-table.mjs --write` bounces in the lander instead of reddening lockstep-tablecheck in the full run.
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const stageIds = (dir) => readdirSync(dir).filter((f) => /^lockstep-.*\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  .map((s) => s.id).filter((id) => id?.startsWith('lockstep-') && id !== 'lockstep-tablecheck' && id !== 'lockstep-rowcheck');
const tsvIds = (p) => readFileSync(p, 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t')[3]);
/** -> problem strings */
export function problems(ids, rows) {
  const r = new Set(rows), s = new Set(ids);
  return [...ids.filter((i) => !r.has(i)).map((i) => `MISSING ${i}`), ...rows.filter((i) => !s.has(i)).map((i) => `ORPHAN ${i}`)];
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tsv = join(ROOT, 'tools/golden/lockstep-table.tsv'), ids = stageIds(join(ROOT, 'tools/stages.d')), rows = tsvIds(tsv);
  let bad = 0, breaks = 0;
  const p = problems(ids, rows);
  if (p.length) { bad++; console.log(p.slice(0, 10).join('\n') + '\nFAIL run: node tools/lockstep-table.mjs --write'); }
  if (ids.length < 50) { bad++; console.log('FAIL too few lockstep stages: ' + ids.length); }
  const caught = (c, m) => { if (c) { breaks++; console.log('✓ caught: ' + m); } else { bad++; console.log('NOT CAUGHT ' + m); } };
  const tmp = mkdtempSync(join(tmpdir(), 'lsrow-')), t2 = join(tmp, 't.tsv');
  const lines = readFileSync(tsv, 'utf8').split('\n');
  writeFileSync(t2, lines.filter((l, i) => i !== 1).join('\n'));
  caught(problems(ids, tsvIds(t2)).some((x) => x.startsWith('MISSING')), 'a dropped row (stage without a row)');
  writeFileSync(t2, lines.join('\n') + '\nx\tx\tx\tlockstep-nosuchstage\n');
  caught(problems(ids, tsvIds(t2)).some((x) => x.startsWith('ORPHAN')), 'a row without a stage');
  caught(problems([...ids, 'lockstep-brandnew'], rows).includes('MISSING lockstep-brandnew'), 'a new stage added without a row');
  console.log(`lockstep-rowcheck: ${ids.length + rows.length + breaks} assertions, ${bad ? bad + ' FAILED' : 'ok'}, ${breaks} breaks caught over ${ids.length} stages`);
  process.exit(bad ? 1 : 0);
}
