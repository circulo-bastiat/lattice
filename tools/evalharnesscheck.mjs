#!/usr/bin/env node
// evalharnesscheck.mjs - the worker-prompt eval harness scores honestly (#7774). Good inputs behave; each break must be caught.
import { readFileSync } from 'node:fs';
import { scoreCase, isFlaky, passRate, budgetGate, needsReport } from './evals/lib.mjs';
const R = JSON.parse(readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8'));
const cases = JSON.parse(readFileSync(new URL('./evals/worker-cases.json', import.meta.url), 'utf8')).cases;
const B = R.evals; let bad = 0; const fail = (m) => { console.log('FAIL ' + m); bad++; };
if (!B || B.maxCasesPerRun > 20) fail('roles.json evals budget missing or > 20 cases');
if (cases.length !== 20 || new Set(cases.map((c) => c.kind)).size < 5 || cases.some((c) => !/^[0-9a-f]{40}$/.test(c.pre))) fail('worker-cases.json: need 20 cases, >=5 kinds, full pre shas');
if (!/tools\/evals\/run\.mjs/.test(R.roles.commander.prompt)) fail('commander prompt does not require the eval');
const ok = { checks: [{ pass: true }], required: [{ done: true }], tokens: 1000, minutes: 5 };
const st = { cases: 20, model: B.model, usagePct: 10, tokensSoFar: 0 };
if (!scoreCase(ok, B).pass || !budgetGate(B, st).ok || !needsReport(['x.js'], [], 'h') || !needsReport(['tools/brain/roles.json'], ['h'], 'h') || isFlaky([{ pass: true }, { pass: true }])) fail('good inputs rejected');
let caught = 0;
const brk = (name, bad_) => { if (bad_) caught++; else fail('NOT caught: ' + name); };
brk('failing end-state scored as pass', !scoreCase({ ...ok, checks: [{ pass: false }] }, B).pass);
brk('no end-state checks scored as pass', !scoreCase({ ...ok, checks: [] }, B).pass);
brk('required item undone scored as pass', !scoreCase({ ...ok, required: [{ done: false }] }, B).pass);
brk('token budget ignored', !scoreCase({ ...ok, tokens: B.maxTokensPerCase + 1 }, B).pass);
brk('case cap ignored', !budgetGate(B, { ...st, cases: 21 }).ok);
brk('usage cap ignored', !budgetGate(B, { ...st, usagePct: B.maxUsagePct }).ok);
brk('run token cap ignored', !budgetGate(B, { ...st, tokensSoFar: B.maxTokensPerRun }).ok);
brk('wrong model ignored', !budgetGate(B, { ...st, model: 'opus' }).ok);
brk('flip not flagged flaky', isFlaky([{ pass: true }, { pass: false }, { pass: true }]));
brk('flaky counted in pass rate', passRate([{ pass: true }, { pass: false, flaky: true }]).n === 1);
brk('prompt change without report', !needsReport(['tools/brain/roles.json'], [], 'h'));
console.log(bad ? `${bad} problems` : `evalharnesscheck ok: ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
