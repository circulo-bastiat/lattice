#!/usr/bin/env node
// goldenredcheck.mjs - #9546: a RED refcheck that a worker runs GREEN on its own (re)generated golden must PUBLISH that golden to the store branch
// (the mirror's shards read only the store's golden/), or the next full run re-files the same RED and the next worker repeats the fake fix
// (22 Oct: xprefcheck's store golden had 50 of 75 variants since 25 Sept; #4036 was closed as already-fixed again and again).
// Cases: checkGoldens() maps a stage id to the golden files its check reads; go.mjs publishes them on `done --already-fixed` of a RED issue and adds
// them to the forced (regen) set on `done --finished`. Breaks: checkGoldens ignoring the entry's file, and each wiring removed.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOOLS = dirname(fileURLToPath(import.meta.url));
const GSRC = readFileSync(join(TOOLS, 'infra', 'golden.mjs'), 'utf8'), GO = readFileSync(join(TOOLS, 'go.mjs'), 'utf8');
let asserts = 0, fails = 0, breaks = 0, k = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
async function cases(src) {
  const d = mkdtempSync(join(tmpdir(), 'grc-')), bad = [];
  try {
    writeFileSync(join(d, `golden${k}.mjs`), src); copyFileSync(join(TOOLS, 'infra', 'gitenv.mjs'), join(d, 'gitenv.mjs'));
    const { checkGoldens, syncGolden, publishGolden } = await import(pathToFileURL(join(d, `golden${k++}.mjs`)).href);
    const r = join(d, 'root'); mkdirSync(join(r, 'tools', 'stages.d'), { recursive: true }); mkdirSync(join(r, 'tools', 'referee'), { recursive: true });
    writeFileSync(join(r, 'tools', 'stages.d', 'referee-xp.json'), JSON.stringify([{ id: 'xpref', kind: 'check', file: 'tools/referee/xpref.mjs' }]));
    writeFileSync(join(r, 'tools', 'stages.d', 'plain.json'), JSON.stringify([{ id: 'plaincheck', kind: 'check' }]));
    writeFileSync(join(r, 'tools', 'stages.d', 'broken.json'), '{ not json');
    writeFileSync(join(r, 'tools', 'referee', 'xpref.mjs'), "const G = join(refDir, 'golden', 'mob-xp.json');");
    writeFileSync(join(r, 'tools', 'plaincheck.mjs'), "a(join(x, 'golden', 'avoid.json')); b(join(x, 'golden', 'chase.json'));");
    const t = (n, c) => { let v = false; try { v = !!c(); } catch { v = false; } if (!v) bad.push(n); };
    t('a stage whose entry names a file reads that file', () => checkGoldens(r, 'xpref').join() === 'mob-xp.json');
    t('a stage with no file reads tools/<id>.mjs', () => checkGoldens(r, 'plaincheck').sort().join() === 'avoid.json,chase.json');
    t('an unknown stage reads no golden', () => checkGoldens(r, 'nosuch').length === 0);
    // sync (a real git repo): newest generatedAt wins; a golden with no generatedAt is rewritten as before
    const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    const OLD = '{"generatedAt":"2026-09-25T00:00:00.000Z","v":50}', NEW = '{"generatedAt":"2026-10-22T18:42:42.643Z","v":75}';
    const up = join(d, 'up'); mkdirSync(up); sh(up, 'init', '-q', '-b', 'master'); sh(up, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'm');
    sh(up, 'checkout', '-q', '-b', 'store'); mkdirSync(join(up, 'golden')); writeFileSync(join(up, 'golden', 'mob-xp.json'), OLD); writeFileSync(join(up, 'golden', 'plain.json'), '{"p":1}');
    sh(up, 'add', '-A'); sh(up, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 's'); sh(up, 'checkout', '-q', 'master');
    const cl = join(d, 'cl'); mkdirSync(cl); sh(cl, 'init', '-q', '-b', 'master'); sh(cl, 'remote', 'add', 'origin', up);
    const gd = join(d, 'golden'); mkdirSync(gd); writeFileSync(join(gd, 'mob-xp.json'), NEW); writeFileSync(join(gd, 'plain.json'), 'stale');
    syncGolden(cl, gd);
    t('sync keeps a local golden generated after the store copy', () => readFileSync(join(gd, 'mob-xp.json'), 'utf8') === NEW);
    t('sync still rewrites a golden without generatedAt', () => readFileSync(join(gd, 'plain.json'), 'utf8') === '{"p":1}');
    writeFileSync(join(gd, 'mob-xp.json'), OLD.replace('2026-09-25', '2026-09-20')); syncGolden(cl, gd);
    t('sync replaces a local golden older than the store copy', () => readFileSync(join(gd, 'mob-xp.json'), 'utf8') === OLD);
    // publish (fake GitHub): an older local golden never replaces a newer store one, even when forced (regen)
    const store = { 'mob-xp.json': { sha: 'S', content: Buffer.from(NEW).toString('base64') } }, puts = [];
    const gh = async (m, p, b) => { if (m === 'GET') return store[(p.match(/golden\/([\w.-]+)\?/) || [])[1]] || null; puts.push(p); return {}; };
    writeFileSync(join(gd, 'mob-xp.json'), OLD);
    const pr = await publishGolden(['mob-xp.json'], gh, gd, new Set(['mob-xp.json']));
    t('publish refuses an older local golden over a newer store one', () => pr.pushed.length === 0 && puts.length === 0);
    writeFileSync(join(gd, 'mob-xp.json'), NEW.replace('2026-10-22', '2026-10-23'));
    const pr2 = await publishGolden(['mob-xp.json'], gh, gd, new Set(['mob-xp.json']));
    t('publish pushes a newer forced golden', () => pr2.pushed.length === 1);
  } catch (e) { bad.push('threw: ' + e.message); } finally { rmSync(d, { recursive: true, force: true }); }
  return bad;
}
const real = await cases(GSRC); ok(real.length === 0, 'checkGoldens: ' + real.join('; '));
for (const [name, src] of [['sync overwrites a newer local golden', GSRC.replace(' const a = genAt(cur), b = genAt(data); if (a !== null && b !== null && a > b) continue;', '')], ['publish pushes an older golden over a newer store one', GSRC.replace('if (a !== null && b !== null && a < b) { out.same.push(name); continue; }', '')]]) {
  if (src === GSRC) { ok(false, 'break did not apply: ' + name); continue; }
  const b = await cases(src); ok(b.length > 0, `cases cannot tell "${name}"`); if (b.length) { breaks++; console.log(`  ✓ "${name}" caught: ${b[0]}`); }
}
const brokenSrc = GSRC.replace('e.file || `tools/${id}.mjs`', '`tools/${id}.mjs`');
if (brokenSrc === GSRC) ok(false, 'break did not apply (checkGoldens changed shape)');
else { const b = await cases(brokenSrc); ok(b.length > 0, 'cases cannot tell checkGoldens ignoring the entry file'); if (b.length) { breaks++; console.log(`  ✓ checkGoldens ignoring the stage's file is caught: ${b[0]}`); } }
const WIRES = [
  ['done --already-fixed publishes the RED check golden after it ran green', /if \(!v\.ok\) die\([^\n]*\n[^\n]*\n\s*const rg = checkGoldens\(dir, red\)[^\n]*\n\s*if \(rg\.length\) \{ const p = await publishGolden\(rg, gh, goldenDir\(\), new Set\(rg\)\)/],
  ['done --finished forces the RED check golden', /const red = redCheckName\([^\n]*\n\s*if \(red\) for \(const g of checkGoldens\(dir, red\)[^\n]*regen\.add\(g\)/],
];
for (const [n, re] of WIRES) { ok(re.test(GO), n); const br = GO.replace(re, 'X'); if (br !== GO && !re.test(br)) { breaks++; console.log(`  ✓ wiring "${n}" removed is caught`); } }
console.log(`goldenredcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
