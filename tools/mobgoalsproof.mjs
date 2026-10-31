#!/usr/bin/env node
// mobgoalsproof (#8081): goals dimension of the mob proof. Per roster mob (tools/mobl3-mobs.json) it folds the three existing goal
// comparisons into one row: goalrostercheck (library goal families vs goals-1.18.2.tsv), mobgoalscheck (fox/bee/wolf/cat rows) and
// goalaudit (registerGoals() vs Ai.ROSTER, every golden row; ledger tools/goalaudit-known.json). Each is run as a child process
// (--verbose / --print give per-mob lines). Writes tools/mobproof/out/goals.json { mob: { pass, checked, notCovered, failed } }.
// pass is false for a mob with any goalaudit key (live or in the ledger) or any DIFFER/failed row. notCovered = goals no check numbers.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const T = dirname(fileURLToPath(import.meta.url)), ROOT = join(T, '..');
if (!existsSync(join(ROOT, 'assets', 'entities.json'))) { console.log('mobgoalsproof: SKIP — assets missing'); process.exit(0); }
const roster = Object.keys(JSON.parse(readFileSync(join(T, 'mobl3-mobs.json'), 'utf8')).mobs);
const run = (tool, args) => spawnSync('node', [join(T, tool), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
const golden = new Map();
for (const l of readFileSync(join(T, 'golden', 'goals-1.18.2.tsv'), 'utf8').split('\n')) { if (!l || l[0] === '#') continue; const f = l.split('\t'); golden.set(f[0], (golden.get(f[0]) || 0) + 1); }

// ── parse the three tools' output ────────────────────────────────────────────────────────────
const GR = run('goalrostercheck.mjs', ['--verbose']), MG = run('mobgoalscheck.mjs', []), GA = run('goalaudit.mjs', ['--print']);
const grRows = new Map();   // type -> diff lines ([] = exact)
{ let cur = null; for (const l of GR.stdout.split('\n')) {
    const m = /^([a-z_0-9]+):(?: exact)?\s*$/.exec(l);
    if (m) { cur = m[1]; grRows.set(cur, []); if (!/exact\s*$/.test(l)) continue; cur = null; continue; }
    if (cur && /^\s{3}\S/.test(l)) grRows.get(cur).push(l.trim()); else if (!/^\s{3}/.test(l)) cur = null; } }
const mgRows = new Map(), mgFail = [];   // type -> {n, differ}
for (const l of MG.stdout.split('\n')) { const m = /^ ([a-z_0-9]+): (\d+) mob-specific rows (exact|DIFFER)/.exec(l); if (m) mgRows.set(m[1], { n: +m[2], differ: m[3] === 'DIFFER' }); if (/^ x /.test(l)) mgFail.push(l.slice(3)); }
const auditKeys = GA.stdout.split('\n').filter((l) => /^ {2}[a-z_0-9]+\|\w+\|/.test(l)).map((l) => l.trim());
const known = JSON.parse(readFileSync(join(T, 'goalaudit-known.json'), 'utf8')).keys;

/** one mob's row from the parsed facts (pure: the break proof feeds it corrupted facts) */
function prove(mob, F) {
  const failed = [], checked = [];
  const rows = F.golden.get(mob) || 0;
  const gr = F.gr.get(mob), mg = F.mg.get(mob);
  if (gr) { checked.push('goalrostercheck: library goal families (priority, parameters)'); for (const d of gr) failed.push('goalrostercheck ' + d); }
  if (mg) { checked.push(`mobgoalscheck: ${mg.n} mob-specific rows`); if (mg.differ) failed.push('mobgoalscheck: rows differ'); for (const f of F.mgFail) if (f.startsWith(mob + ':') || f.startsWith(mob + ' ')) failed.push('mobgoalscheck ' + f); }
  if (rows) checked.push(`goalaudit: ${rows} registerGoals() rows vs Ai.ROSTER`); else checked.push('goalaudit: the jar registers no goals for it');
  for (const k of new Set(F.keys.concat(F.known))) if (k.split('|')[0] === mob) failed.push('goalaudit ' + k);
  const notCovered = [];
  if (rows && !gr) notCovered.push('goal parameters (speed, range, item sets): goalrostercheck does not roster this mob');
  if (rows && !mg) notCovered.push('goal behaviour (canUse/start/tick): goalcheck and the mob checks own it, not numbered here');
  return { pass: failed.length === 0, checked, notCovered, failed };
}
const F0 = { golden, gr: grRows, mg: mgRows, mgFail, keys: auditKeys, known };
let bad = 0;
if (GR.status !== 0) { bad++; console.log('goalrostercheck FAILED'); }
if (MG.status !== 0) { bad++; console.log('mobgoalscheck FAILED'); }
if (!golden.size || !grRows.size || !mgRows.size) { bad++; console.log('parse found nothing: ' + [golden.size, grRows.size, mgRows.size]); }
const out = {};
for (const mob of roster) out[mob] = prove(mob, F0);
mkdirSync(join(T, 'mobproof', 'out'), { recursive: true });
writeFileSync(join(T, 'mobproof', 'out', 'goals.json'), JSON.stringify(out, null, 1));

// ── break proof (D-30) ───────────────────────────────────────────────────────────────────────
let caught = 0;
const brk = (c, w) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT ' + w); } };
const base = prove('cow', F0).pass;
brk(base && prove('cow', { ...F0, keys: ['cow|missing|G1:TemptGoal'] }).pass === false, 'goal key for cow');
brk(prove('cow', { ...F0, known: ['cow|extra|G9:FloatGoal'] }).pass === false, 'ledger key');
brk(prove('cow', { ...F0, gr: new Map(grRows).set('cow', ['0 PanicGoal speed 2 != 1.25']) }).pass === false, 'goalrostercheck diff');
brk(prove('fox', { ...F0, mg: new Map(mgRows).set('fox', { n: 9, differ: true }) }).pass === false, 'mobgoalscheck differ');
brk(prove('wolf', { ...F0, mgFail: ['wolf: row missing'] }).pass === false, 'mobgoalscheck failure line');
brk(!('no_such_mob' in out), 'mob absent from the roster stays missing');
brk(auditKeys.length === 0 || roster.some((m) => !prove(m, F0).pass), 'live keys make a mob fail');
const nPass = roster.filter((m) => out[m].pass).length;
console.log(bad ? `FAIL ${bad} bad` : `mobgoalsproof: ${roster.length} mobs (${nPass} pass), ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
