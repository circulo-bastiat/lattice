#!/usr/bin/env node
// fillresumecheck.mjs - #6522: pause the fill until the land queue is empty, resume by itself, mail the commander when the land backlog is high.
//   node tools/fillresumecheck.mjs
// 1. route.mjs findings(): 'land-backlog' fires at the threshold, not below it   2. source guards: go.mjs parks FILL_RESUME_TO, brain.mjs restores it only on an
// empty queue and arms its own waker otherwise   3. anti-vacuity: each guard / the finding, with the behaviour removed, must FAIL.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findings, dueAlerts, unpaged } from './brain/route.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const keys = (snap, cfg = {}) => findings({ now: Date.now(), runners: [], mail: [], ...snap }, cfg).map((f) => f.key);

// 1. the finding
ok(keys({ landWaiting: 30 }).includes('land-backlog'), 'findings: 30 PRs waiting raises land-backlog');
ok(!keys({ landWaiting: 29 }).includes('land-backlog'), 'findings: 29 PRs waiting does not');
ok(keys({ landWaiting: 5 }, { health: { landBacklogHigh: 5 } }).includes('land-backlog'), 'findings: health.landBacklogHigh moves the threshold');
ok(!keys({}).includes('land-backlog'), 'findings: an unreadable queue (landWaiting unset) raises nothing');

// #9747: a backlog that drains (master moved in the last 45 min) mails the commander but never pages Dan
{ const now = Date.now(), cfg = { health: {} }, past = [{ key: 'land-backlog', at: now - 2 * 3600e3 }];
  const fd = (lm) => findings({ now, runners: [], mail: [], landWaiting: 31, lastMasterAt: lm }, cfg);
  const dr = fd(now - 6 * 60e3), st = fd(now - 90 * 60e3);
  const danOf = (f, da) => da(f.filter((x) => x.key === 'land-backlog'), past, [], cfg, now).dan.length;
  ok(dr.find((f) => f.key === 'land-backlog').draining === true && st.find((f) => f.key === 'land-backlog').draining === false, 'land-backlog: draining when master moved < 45 min ago');
  ok(danOf(dr, dueAlerts) === 0 && danOf(st, dueAlerts) === 1, 'dueAlerts: a draining backlog never pages Dan; a stuck one still does after an hour');
  ok(dueAlerts(dr.filter((x) => x.key === 'land-backlog'), [], [], cfg, now).mail.length === 1, 'dueAlerts: a draining backlog still mails the commander');
  const R = readFileSync(join(ROOT, 'tools/brain/route.mjs'), 'utf8'), g = /if \(mine\.length && !f\.draining && /;
  const caught = !g.test(R.replace('!f.draining && ', '')); ok(g.test(R) && caught, 'route.mjs: the draining exemption is wired'); if (caught) breaks++; }

// #9770: one page per key per pass
{ const now = 5, f = [{ key: 'dormant' }, { key: 'master-red' }], told = [{ key: 'dormant', at: 5 }, { key: 'master-red', at: 1 }];
  const t = (u) => { try { const r = u(f, told, now).map((x) => x.key); return r.length === 1 && r[0] === 'master-red' && u(f, [], now).length === 2 && u(null, null, now).length === 0; } catch { return false; } };
  ok(t(unpaged), 'unpaged: a key already pushed in this pass is not paged again; older pushes do not count');
  const c = !t((d) => d || []); ok(c, 'anti-vacuity: an unpaged() that pages everything is caught'); if (c) breaks++;
  const B = readFileSync(join(ROOT, 'tools/brain/brain.mjs'), 'utf8'); ok(/for \(const f of unpaged\(dan, h\.told, now\)\) \{ await notify\(/.test(B), 'brain.mjs pages only unpaged findings'); }

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
