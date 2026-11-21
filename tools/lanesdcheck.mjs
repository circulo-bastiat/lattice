#!/usr/bin/env node
// lanesdcheck.mjs - #6989: the lockstep lanes live ONE FILE EACH in tools/referee/lanes.d/<id>.json, never as entries of a shared array
// (every lane PR edited that one line, so any two conflicted: 4 dirty + 1 bounced on 13 Oct). Asserts the directory is sound, that
// chasescen.mjs builds LOCKSTEP_ONLY from it and holds no inline lane, then anti-vacuity: each broken case must be caught.
import { readFileSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LOCKSTEP_ONLY, loadLanes, lanesProblems } from './referee/chasescen.mjs';
let asserts = 0, fails = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const src = readFileSync(new URL('./referee/chasescen.mjs', import.meta.url), 'utf8');
const dir = new URL('./referee/lanes.d/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// the shape
const inlineLane = (s) => /export const LOCKSTEP_ONLY\s*=\s*\[/.test(s) || /LOCKSTEP_ONLY\s*\.push\(/.test(s);
ok(!inlineLane(src), 'chasescen.mjs holds an inline LOCKSTEP_ONLY array or push: a lane is a file in lanes.d/');
ok(/export const LOCKSTEP_ONLY = loadLanes\(\)/.test(src), 'LOCKSTEP_ONLY is not built by loadLanes()');
ok(lanesProblems(dir).length === 0, `lanes.d has problems: ${lanesProblems(dir).join('; ')}`);
const ids = LOCKSTEP_ONLY.map((l) => l.id);
ok(ids.length === new Set(ids).size && ids.length === readdirSync(dir).filter((f) => f.endsWith('.json')).length, 'one lane per file, no duplicate ids');
ok(JSON.stringify(ids) === JSON.stringify([...ids].sort()), 'lanes are sorted by id (stable order)');
ok(JSON.stringify(loadLanes(dir)) === JSON.stringify(LOCKSTEP_ONLY), 'loadLanes(dir) equals LOCKSTEP_ONLY');
ok(LOCKSTEP_ONLY.every((l) => !('note' in l)), 'note is documentation and must not reach the lane');
const by = Object.fromEntries(LOCKSTEP_ONLY.map((l) => [l.id, l]));   // the entries that existed before the split keep their options
ok(by.cow?.mob === 'cow' && by.zombie_wall?.wall === true && by.zombie_wall?.mob === 'zombie' && by.chicken?.ent === true && by.hoglin?.mob === 'hoglin' && by.ghast?.fire === true && by.ghast?.up === 2, 'the original lanes kept their options');
// anti-vacuity: broken directories and a broken source must each be caught
const tmp = (files) => { const d = mkdtempSync(join(tmpdir(), 'lanesd-')); for (const [n, c] of Object.entries(files)) writeFileSync(join(d, n), c); return d; };
let breaks = 0;
const broke = (name, caught) => { ok(caught, `not caught: ${name}`); if (caught) { breaks++; console.log(`  ✓ caught: ${name}`); } };
ok(lanesProblems(tmp({ 'a.json': '{"id":"a","mob":"cow"}' })).length === 0, 'a sound directory reports no problem');
broke('a lane whose id is not its file name (duplicate id)', lanesProblems(tmp({ 'a.json': '{"id":"a","mob":"cow"}', 'b.json': '{"id":"a","mob":"cow"}' })).length > 0);
broke('a lane with no mob', lanesProblems(tmp({ 'a.json': '{"id":"a"}' })).length > 0);
broke('a lane file that is not JSON', lanesProblems(tmp({ 'a.json': '{id: a' })).length > 0);
let threw = false; try { loadLanes(tmp({ 'a.json': '{"id":"x","mob":"cow"}' })); } catch { threw = true; }
broke('loadLanes refuses a bad directory', threw);
broke('an inline array brought back', inlineLane(src + "\nexport const LOCKSTEP_ONLY = [{ id: 'x', mob: 'x' }];"));
broke('an inline push', inlineLane(src + "\nLOCKSTEP_ONLY.push({ id: 'x', mob: 'x' });"));
console.log(`lanesdcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
