#!/usr/bin/env node
// rosteroptscheck.mjs — #4450: every roster ActiveTargetGoal<Player> (NearestAttackableTargetGoal over
// ctx.players) carries sight + mustSee + reciprocalChance 10 (ActiveTargetGoal 3-arg ctor, checkVisibility=true).
// Anti-vacuity: strips each option from the source in turn; each mutant must be flagged ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';

const src = readFileSync(join(MCLITE_ROOT, 'src', '07k_goals.js'), 'utf8');
const re = /new Ai\.NearestAttackableTargetGoal\(e, ctx\.players\b[^\n]*/g;
const need = [/sight:\s*true/, /mustSee:\s*true/, /reciprocalChance:\s*10\b/];
const bad = (s) => { const m = s.match(re) || []; return m.length < 10 ? ['only ' + m.length + ' sites'] : m.filter(l => !need.every(r => r.test(l))); };

const base = bad(src);
if (base.length) { console.log('FAIL ' + base.length + ' roster Player goals lack opts:\n' + base.join('\n')); process.exit(1); }
let breaks = 0;
for (const strip of ['sight: true, ', 'mustSee: true, ', 'reciprocalChance: 10, ']) {
  const i = src.search(re), j = src.indexOf(strip, i);   // strip it from the first roster line
  if (bad(src.slice(0, j) + src.slice(j + strip.length)).length) { breaks++; console.log('✓ mutant without "' + strip.trim() + '" caught'); }
}
if (breaks !== 3) { console.log('FAIL anti-vacuity: ' + breaks + '/3 mutants caught'); process.exit(1); }
console.log(`rosteroptscheck: ${(src.match(re) || []).length} assertions, 0 failures, ${breaks} breaks caught`);
