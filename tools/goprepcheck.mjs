// tools/goprepcheck.mjs - `go.mjs start --loop` never generates workspaces' assets/ in its own call, and a workspace
// counts as ready only by its marker, never because an assets/ folder exists (28 Sept: generation takes ~2 min per
// workspace, a Cowork call is cut off at 3, so start --loop died every time and left a half-made assets/ that the
// next start took for a whole one). Pure: reads tools/go.mjs's source.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
function verdicts(src) {
  const bad = [];
  const ws = (src.match(/function workspace\(ref[^)]*\) \{[\s\S]*?\n\}/) || [''])[0];
  const prep = (src.match(/function prepDir\(dir\) \{[\s\S]*?\n\}/) || [''])[0];
  if (!prep) bad.push('prepDir() is gone');
  if (/existsSync\(join\(dir, 'assets'\)\)/.test(ws + prep)) bad.push("readiness is judged by assets/ existing, not by the marker");
  if (!/if \(ASSETS_DONE\(dir\)\) return;/.test(prep)) bad.push('prepDir() does not skip on the marker');
  // #1821: a marker whose assets/ was wiped must not count (runners 1,2,3,4,7, 2 Oct)
  const done = (src.match(/ASSETS_DONE = [^\n]*/) || [''])[0];
  if (!/existsSync\(ASSETS_OK\(dir\)\)/.test(done) || !/block-geometry\.meta\.json/.test(done)) bad.push('the marker counts although assets/block-geometry.meta.json is gone');
  if (!/block-geometry\.meta\.json'\)\)\) throw/.test(prep)) bad.push('the marker is written although generation produced no assets/');
  if (!/rmSync\(join\(dir, 'assets'\)/.test(prep)) bad.push('a half-made assets/ is not cleared before regenerating');
  if (prep.indexOf('writeFileSync(ASSETS_OK(dir)') < prep.indexOf("'--to', 'build'")) bad.push('the marker is written before generation finishes');
  if (!/workspace\(c\.ref, !flag\('--loop'\)\)/.test(src)) bad.push('start --loop generates every workspace in one call');
  if (!/\bprep: async/.test(src)) bad.push('there is no `go.mjs prep` for a worker to run');
  // 28 Sept: undeletable clones in /tmp filled the VM root; the base must follow the disk with room
  if (!/w === 'cowork' \? coworkBase\(\)/.test(ws)) bad.push('Cowork workspaces are pinned to /tmp whatever its free space');
  // #1706: a fresh runner checkout has no jars/.mcdata; prep must fetch them from the store before building
  if (prep.indexOf('cloud/bootstrap.mjs') < 0 || prep.indexOf('cloud/bootstrap.mjs') > prep.indexOf("'--to', 'build'")) bad.push('prepDir() does not bootstrap missing jars/.mcdata before the build');
  return bad;
}
// #5026: bootstrap reports Java (a runner without Java 17 is otherwise invisible until a needs-java worker burns a run)
const BOOT = readFileSync(new URL('./cloud/bootstrap.mjs', import.meta.url), 'utf8');
const bootBad = (b) => [!/say\('java'/.test(b) && 'bootstrap prints no java line', !/major < 17\) console\.log\(`WARN/.test(b) && 'bootstrap does not warn when Java is below 17'].filter(Boolean);
if (bootBad(BOOT).length) throw new Error('goprepcheck: ' + bootBad(BOOT).join('; '));
let bootCaught = 0; for (const m of [BOOT.replace("say('java'", "say('jav'"), BOOT.replace('major < 17) console.log(`WARN', 'major < 0) console.log(`WARN')]) if (bootBad(m).length) bootCaught++;
if (bootCaught !== 2) throw new Error('goprepcheck: bootstrap java breaks not caught');
const real = verdicts(SRC);
const BREAKS = [
  ['the 28 Sept code: gate on assets/ existing', (s) => s.replace('if (ASSETS_DONE(dir)) return;', "if (existsSync(join(dir, 'assets'))) return;")],
  ['marker alone vouches for assets/ (#1821)', (s) => s.replace(/ASSETS_DONE = [^\n]*/, 'ASSETS_DONE = (dir) => existsSync(ASSETS_OK(dir));')],
  ['marker written after a build that made nothing (#1821)', (s) => s.replace(/  if \(!existsSync\(join\(dir, 'assets', 'block-geometry\.meta\.json'\)\)\) throw[^\n]*\n/, '')],
  ['start --loop generates in its own call', (s) => s.replace("workspace(c.ref, !flag('--loop'))", 'workspace(c.ref)')],
  ['marker written first', (s) => s.replace(/(  writeFileSync\(ASSETS_OK\(dir\), new Date\(\)\.toISOString\(\)\);\n)/, '').replace("  rmSync(join(dir, 'assets')", "  writeFileSync(ASSETS_OK(dir), new Date().toISOString());\n  rmSync(join(dir, 'assets')")],
  ['workspaces pinned to /tmp (the 28 Sept disk leak)', (s) => s.replace("w === 'cowork' ? coworkBase()", "w === 'cowork' ? `/tmp/mc-x`")],
  ['half-made assets/ kept', (s) => s.replace(/  rmSync\(join\(dir, 'assets'\)[^\n]*\n/, '')],
  ['prep builds without fetching jars/.mcdata (#1706)', (s) => s.replace('cloud/bootstrap.mjs', 'cloud/nothing.mjs')],
];
let caught = 0;
for (const [name, br] of BREAKS) { const m = br(SRC); if (m !== SRC && verdicts(m).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const b of real) console.log(`  ✗ ${b}`);
const n = 10;
console.log(`goprepcheck: ${caught + bootCaught} breaks caught (of ${BREAKS.length + 2})`);
console.log(` assertions passed .... ${n - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
