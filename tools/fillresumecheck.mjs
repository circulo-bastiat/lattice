#!/usr/bin/env node
// fillresumecheck.mjs - #6522: pause the fill until the land queue is empty, resume by itself, mail the commander when the land backlog is high.
//   node tools/fillresumecheck.mjs
// 1. route.mjs findings(): 'land-backlog' fires at the threshold, not below it   2. source guards: go.mjs parks FILL_RESUME_TO, brain.mjs restores it only on an
// empty queue and arms its own waker otherwise   3. anti-vacuity: each guard / the finding, with the behaviour removed, must FAIL.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findings } from './brain/route.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const keys = (snap, cfg = {}) => findings({ now: Date.now(), runners: [], mail: [], ...snap }, cfg).map((f) => f.key);

// 1. the finding
ok(keys({ landWaiting: 30 }).includes('land-backlog'), 'findings: 30 PRs waiting raises land-backlog');
ok(!keys({ landWaiting: 29 }).includes('land-backlog'), 'findings: 29 PRs waiting does not');
ok(keys({ landWaiting: 5 }, { health: { landBacklogHigh: 5 } }).includes('land-backlog'), 'findings: health.landBacklogHigh moves the threshold');
ok(!keys({}).includes('land-backlog'), 'findings: an unreadable queue (landWaiting unset) raises nothing');

// 2. source guards
const go = readFileSync(join(ROOT, 'tools/go.mjs'), 'utf8'), brain = readFileSync(join(ROOT, 'tools/brain/brain.mjs'), 'utf8');
const goGuard = (s) => /argv\.includes\('--resume-when-landed'\)[\s\S]{0,400}FILL_RESUME_TO[\s\S]{0,400}const body = \{ name: VN/.test(s);
const brainGuard = (s) => /FILL_RESUME_TO[\s\S]{0,300}landBacklog === 0[\s\S]{0,500}name: 'FILL_WORKERS', value: String\(rt\)[\s\S]{0,400}DELETE[\s\S]{0,200}FILL_RESUME_TO/.test(s);
const wakerGuard = (s) => /else if \(rt && !armed\(now \+ 20 \* 60e3\)\) await arm\(now \+ 20 \* 60e3\)/.test(s);
const beforeOff = (s) => s.indexOf('FILL_RESUME_TO') > -1 && s.indexOf('FILL_RESUME_TO') < s.indexOf('const fillOff = ');
ok(goGuard(go), 'go.mjs: loop off --resume-when-landed parks the current count in FILL_RESUME_TO before it writes 0');
ok(brainGuard(brain), 'brain.mjs: FILL_WORKERS comes back, and FILL_RESUME_TO is deleted, only when landBacklog === 0');
ok(wakerGuard(brain), 'brain.mjs: while parked the fill arms its own 20-min waker');
ok(beforeOff(brain), 'brain.mjs: the resume runs before the FILL_WORKERS=0 drop of held mail');
ok(/!bad\.includes\('lander'\)/.test(brain), 'brain.mjs: an unreadable PR queue never counts as empty');

// 3. anti-vacuity: take the behaviour out and the check must notice
const drop = (name, caught) => { ok(caught, 'anti-vacuity: ' + name + ' is caught'); if (caught) breaks++; };
drop('a go.mjs that never parks the count', !goGuard(go.replace("argv.includes('--resume-when-landed')", 'false').replace(/FILL_RESUME_TO/g, 'X')));
drop('a brain that resumes whatever the backlog', !brainGuard(brain.replace('landBacklog === 0', 'true')));
drop('a brain that never deletes FILL_RESUME_TO', !brainGuard(brain.replace("'DELETE', '/repos/{repo}/actions/variables/FILL_RESUME_TO'", "'GET', '/repos/{repo}/actions/variables/FILL_RESUME_TO'")));
drop('a brain with no waker while parked', !wakerGuard(brain.replace('else if (rt && !armed(now + 20 * 60e3)) await arm(now + 20 * 60e3);', '')));
{ const raised = findings({ now: Date.now(), runners: [], mail: [], landWaiting: 99 }, { health: { landBacklogHigh: 1e9 } }).map((f) => f.key);
  drop('a threshold nobody can reach', !raised.includes('land-backlog')); }

console.log('\n' + asserts + ' assertions, ' + fails + ' failures, ' + breaks + ' breaks caught');
process.exit(fails ? 1 : 0);
