// pilotfarmcheck (21 Oct): RUNS tools/infra/pilotfarm.mjs on fixtures -- the bulk top-up of lockstep pilot credit must plan the shortest lanes first,
// count only credited STABLE salts, name the shared file that dropped credit, and write results the credit rule accepts. Prints '<n> breaks caught'.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOOLS = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(TOOLS, 'infra', 'pilotfarm.mjs'), 'utf8');
let ASSERTS = 0;
/** copy of pilotfarm.mjs (optionally with one text mutation) next to a symlink to the real tools/referee, then import it */
async function load(mut) {
  let src = SRC;
  if (mut) { if (!src.includes(mut[0])) throw new Error('no-op break: not found in pilotfarm.mjs: ' + mut[0]); src = src.replace(mut[0], mut[1]); }
  const d = mkdtempSync(join(tmpdir(), 'pfc-')); mkdirSync(join(d, 'infra'));
  symlinkSync(join(TOOLS, 'referee'), join(d, 'referee'), 'junction'); // junction: no admin needed on Windows
  writeFileSync(join(d, 'infra', 'pilotfarm.mjs'), src);
  const m = await import(pathToFileURL(join(d, 'infra', 'pilotfarm.mjs')).href + '?' + Math.random());
  return { m, d };
}
const inp = (g) => ({ 'referee/lockstep/run.mjs': g.run || 'r1', 'referee/lanes.d/cow.json': 'c', 'referee/server.mjs': g.srv || 's1' });
const res = (lane, salt, same, inputs) => ({ lane, salt, same, inputs });
async function run(mut) {
  let fails = 0; const ok = (c, msg) => { ASSERTS++; if (!c) { fails++; if (!mut) console.log('FAIL: ' + msg); } };
  const { m, d } = await load(mut);
  const cur = (l) => (l === 'cow' ? inp({}) : l === 'pig' ? inp({}) : inp({ run: 'r1' }));
  const r = [];
  for (let s = 0; s < 20; s++) r.push(res('cow', s, true, inp({})));                       // cow: fully credited
  for (let s = 0; s < 12; s++) r.push(res('pig', s, true, inp({})));                       // pig: 12 credited
  for (let s = 12; s < 14; s++) r.push(res('pig', s, false, inp({})));                    // + 2 current but server-unstable (not credited)
  for (let s = 0; s < 20; s++) r.push(res('sheep', s, true, inp({ run: 'OLD' })));        // sheep: all stale, run.mjs changed
  const plan = m.farmPlan(['cow', 'pig', 'sheep', 'ant'], r, cur);
  const by = Object.fromEntries(plan.map((p) => [p.lane, p]));
  ok(by.cow.credited === 20 && by.cow.missing === 0, 'a lane with 20 current stable salts is done');
  ok(by.pig.credited === 12 && by.pig.missing === 8, 'unstable salts are not credited (pig 12 of 20)');
  ok(by.sheep.credited === 0 && by.sheep.stale === 20 && by.sheep.missing === 20, 'stale results are not credited');
  ok(by.ant.missing === 20 && by.ant.stale === 0, 'a lane with no results needs all 20');
  ok(plan.map((p) => p.lane).join() === 'cow,pig,ant,sheep', 'fewest missing first, then name');
  ok(m.nextLanes(plan, 2).map((p) => p.lane).join() === 'pig,ant', 'nextLanes skips finished lanes and caps at k');
  ok(by.sheep.droppedBy['referee/lockstep/run.mjs'] === 20 && !by.sheep.droppedBy['referee/server.mjs'], 'droppedBy names the file whose text changed');
  ok(m.droppers(plan)['referee/lockstep/run.mjs'] === 1, 'droppers counts lanes per shared file');
  const dir = join(d, 'res'); mkdirSync(dir);
  writeFileSync(join(dir, 'cow-0.json'), JSON.stringify(res('cow', 0, true, inp({})))); writeFileSync(join(dir, 'bad.json'), '{nope'); writeFileSync(join(dir, 'noinp.json'), JSON.stringify({ lane: 'cow', salt: 1 }));
  const old = join(d, 'res2'); mkdirSync(old); writeFileSync(join(old, 'cow-0.json'), JSON.stringify(res('cow', 0, false, inp({})))); writeFileSync(join(old, 'cow-5.json'), JSON.stringify(res('cow', 5, true, inp({}))));
  const rr = m.readResults([dir, old]);
  ok(rr.length === 2 && rr.find((x) => x.salt === 0).same === true, 'readResults: newest dir wins, garbled and input-less files are skipped');
  ok(/^[0-9a-f]{12}$/.test(m.srcHash(join(TOOLS, 'referee', 'lockstep'))), 'srcHash is 12 hex');
  // early cutoff (22 Oct): stale stable results are carried forward only when the probes reproduce the stored server hash
  const OLD = inp({ run: 'OLD' }), NEW = inp({}), st = (s2, a, inputs = OLD, same = true) => ({ lane: 'sheep', salt: s2, same, a, inputs });
  const stale = [0, 1, 2, 3, 4, 5].map((i) => st(i, 'h' + i)).concat([st(6, 'x', OLD, false), st(7, 'y', inp({ run: 'OLDER' })), st(8, 'z', inp({ run: 'OLDER' }))]);
  const groups = m.carryPlan(stale);
  ok(groups.length === 1 && groups[0].rs.length === 6 && groups[0].probe.join() === '0,1', 'carryPlan: one group of 6 stable results with the same old inputs, probes its 2 lowest salts; unstable and tiny groups are not probed');
  const good = m.carryForward(groups, [{ lane: 'sheep', salt: 0, same: true, a: 'h0' }, { lane: 'sheep', salt: 1, same: true, a: 'h1' }], NEW);
  ok(good.length === 4 && good.every((x) => x.carried === true && JSON.stringify(x.inputs) === JSON.stringify(NEW)) && good.map((x) => x.salt).join() === '2,3,4,5', 'probes that match carry the other four salts under the CURRENT inputs');
  ok(m.carryForward(groups, [{ lane: 'sheep', salt: 0, same: true, a: 'h0' }, { lane: 'sheep', salt: 1, same: true, a: 'CHANGED' }], NEW).length === 0, 'one probe with a different server hash carries nothing');
  ok(m.carryForward(groups, [{ lane: 'sheep', salt: 0, same: true, a: 'h0' }, { lane: 'sheep', salt: 1, same: false, a: 'h1' }], NEW).length === 0, 'an unstable probe carries nothing');
  ok(m.carryForward(groups, [{ lane: 'sheep', salt: 0, same: true, a: 'h0' }], NEW).length === 0, 'a missing probe carries nothing');
  ok(m.carryPlan(stale.slice(0, 2)).length === 0, 'a group no bigger than the probe count is just re-run, never carried');
  rmSync(d, { recursive: true, force: true });
  return fails;
}
const base = await run();
const pilot = readFileSync(join(TOOLS, 'referee', 'lockstep', 'pilot.mjs'), 'utf8');
const wiring = [
  ['srcHash uses the same five sources as pilot.mjs', /SeedAgent\.java'\), join\(here, 'run\.mjs'\), join\(here, '\.\.', 'runchase\.mjs'\), join\(here, '\.\.', 'chasescen\.mjs'\), join\(here, '\.\.', 'server\.mjs'\)/.test(SRC) && /SeedAgent\.java'\), join\(HERE, 'run\.mjs'\), join\(HERE, '\.\.', 'runchase\.mjs'\), join\(HERE, '\.\.', 'chasescen\.mjs'\), join\(HERE, '\.\.', 'server\.mjs'\)/.test(pilot)],
  ['srcHash hashes like pilot.mjs (join of NUL, 12 hex)', SRC.includes(".join('\\u0000')).digest('hex').slice(0, 12)") && pilot.includes(".join('\\u0000')).digest('hex').slice(0, 12)")],
  ['--run writes results with the lane\'s CURRENT inputs (what the credit rule compares)', /\{ \.\.\.r, inputs: currentInputs\(lane\) \}/.test(SRC)],
  ['--run probes stale lanes first and honours --no-carry', /--no-carry/.test(SRC) && /carryForward\(groups, fresh, currentInputs\(lane\)\)/.test(SRC)],
  ['the workflow does a full no-carry pass once a day', (() => { try { const w = readFileSync(join(TOOLS, '..', '.github', 'workflows', 'pilot-farm.yml'), 'utf8'); return /--no-carry/.test(w) && w.split('cron:').length >= 3; } catch { return false; } })()],
  ['--run asks the mirror only for the salts not already on disk', /runPilot\(lane, 0, NEED, have\)/.test(SRC)],
  ['the workflow runs the farm with the mirror secrets', (() => { try { const w = readFileSync(join(TOOLS, '..', '.github', 'workflows', 'pilot-farm.yml'), 'utf8'); return /pilotfarm\.mjs --run/.test(w) && /MIRROR_TOKEN: \$\{\{ secrets\.MIRROR_TOKEN/.test(w) && /MIRROR_REPO: \$\{\{ vars\.MIRROR_REPO/.test(w); } catch { return false; } })()],
  ['the workflow pushes a farm/ branch and has a schedule; farmship.mjs (the brain tick, PAT) opens the land PR (22 Oct: GITHUB_TOKEN got /pulls 403)', (() => { try { const w = readFileSync(join(TOOLS, '..', '.github', 'workflows', 'pilot-farm.yml'), 'utf8'), fs = readFileSync(join(TOOLS, 'infra', 'farmship.mjs'), 'utf8'); return /farm\/\$\{GITHUB_RUN_ID\}/.test(w) && /git -c credential\.helper= push -q origin "\$br"/.test(w) && /cron:/.test(w) && /labels: \['land'\]/.test(fs); } catch { return false; } })()],
];
let wfail = 0; for (const [msg, c] of wiring) { ASSERTS++; if (!c) { wfail++; console.log('FAIL: ' + msg); } }
const breaks = [
  ['stable', ["if (sameInputs(r.inputs, c)) { if (r.same) e.credited++; continue; }", "if (sameInputs(r.inputs, c)) { e.credited++; continue; }"]],
  ['stale', ["if (sameInputs(r.inputs, c)) {", "if (true) {"]],
  ['order', ["a.missing - b.missing || a.lane.localeCompare(b.lane)", "a.lane.localeCompare(b.lane)"]],
  ['done', ["plan.filter((p) => p.missing > 0).slice(0, k)", "plan.slice(0, k)"]],
  ['dropped', ["if (r.inputs[f] !== c[f]) e.droppedBy", "if (r.inputs[f] === c[f]) e.droppedBy"]],
  ['first', ["if (seen.has(k)) continue; seen.add(k);", "seen.add(k);"]],
  ['garbled', ["if (!r || !r.lane || !Number.isInteger(r.salt) || !r.inputs) continue;", ""]],
  ['carry-match', ["fs.get(s).a === rs.find((r) => r.salt === s).a", "fs.has(s)"]],
  ['carry-stable', ["f.same === true && f.a).map((f) => [f.salt, f])", "f.a).map((f) => [f.salt, f])"]],
  ['carry-inputs', ["{ ...r, inputs: curInputs, carried: true }", "{ ...r, carried: true }"]],
  ['carry-group', [".filter((rs) => rs.length > k)", ".filter((rs) => rs.length > 0)"]],
  ['hash', [".digest('hex').slice(0, 12);\n}\n\nif", ".digest('hex').slice(0, 8);\n}\n\nif"]],
];
let caught = 0; for (const [id, mut] of breaks) { if (await run(mut)) caught++; else console.log('NOT CAUGHT: ' + id); }
if (base || wfail || caught < breaks.length) { console.log(`pilotfarmcheck: FAIL (${base} rule(s), ${wfail} wiring, ${caught}/${breaks.length} breaks caught)`); process.exit(1); }
console.log(`pilotfarmcheck: ${caught} breaks caught, ${ASSERTS} assertions`);
