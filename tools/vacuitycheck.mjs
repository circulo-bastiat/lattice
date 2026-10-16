// Static gate for the known classes of vacuous check (#7708). Reads every file named by tools/stages.d/*.json.
// Classes: V1 constant-true condition in ok()/assert; V2 text mutation with no found-check (no-op break);
// V3 SKIP + exit 0 with no hard-fail path; V4 missing file / no break list. Known offenders: tools/vacuity-waivers.json.
// Usage: node tools/vacuitycheck.mjs [--write-waivers]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export function analyze(text) {
  const out = [];
  if (/\b(ok|assert|check|expect)\s*\([^;\n]*(\|\|\s*true\b|&&\s*true\b)/.test(text) || /\b(ok|assert)\s*\(\s*(true|1|!0)\s*[,)]/.test(text)) out.push('V1');
  const mutates = /\.split\([^)\n]*\)\.join\(|\brep\s*\(|\.replace(All)?\(/.test(text) && /break/i.test(text);
  if (mutates && !/includes\(|indexOf\(|not found|no-op|noop|\.test\(|\.match\(/i.test(text)) out.push('V2');
  if (/\bSKIP/.test(text) && /process\.exit\(\s*0\s*\)/.test(text) && !/process\.exit\(\s*1\s*\)|exitCode\s*=\s*1|hosted-unfit/.test(text)) out.push('V3');
  if (!/break/i.test(text)) out.push('V4');
  return out;
}
const read = f => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };
function scan() {
  const found = {};
  for (const sf of fs.readdirSync(path.join(root, 'tools/stages.d')).filter(f => f.endsWith('.json'))) {
    let st; try { st = JSON.parse(read('tools/stages.d/' + sf)); } catch { found[sf] = ['V4']; continue; }
    for (const s of [].concat(st)) {
      if (!s.file) continue;
      const t = read(s.file);
      const v = t === null ? ['V4'] : analyze(t);
      if (v.length) found[s.file] = v;
    }
  }
  return found;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wf = path.join(root, 'tools/vacuity-waivers.json');
  const found = scan();
  if (process.argv.includes('--write-waivers')) {
    const w = {}; for (const [f, v] of Object.entries(found)) w[f] = { classes: v, issue: 7708 };
    fs.writeFileSync(wf, JSON.stringify({ why: 'Known vacuity offenders awaiting the hand audits (#7704-#7707). Each needs an issue number; remove an entry when fixed. Only NEW offenders fail.', waivers: w }, null, 1) + '\n');
  }
  const waivers = JSON.parse(fs.readFileSync(wf, 'utf8')).waivers;
  let bad = 0;
  for (const [f, v] of Object.entries(found)) {
    const w = waivers[f];
    if (!w || !w.issue || !v.every(c => w.classes.includes(c))) { bad++; console.log('VACUOUS ' + f + ' ' + v.join(',')); }
  }
  for (const f of Object.keys(waivers)) if (!found[f]) console.log('note: stale waiver ' + f);
  // anti-vacuity: plant each class and show it is caught
  const plants = {
    V1: "ok(x === 1 || true, 'a'); // breaks",
    V2: "const b = src.split('a').join('b'); // breaks list",
    V3: "console.log('SKIP no gpu'); process.exit(0); // breaks",
    V4: "console.log('hi');",
  };
  let caught = 0;
  for (const [c, t] of Object.entries(plants)) if (analyze(t).includes(c)) caught++; else { bad++; console.log('PLANT NOT CAUGHT ' + c); }
  if (analyze("ok(x); if(!src.includes('a')) throw 1; src.split('a').join('b'); // breaks").length) { bad++; console.log('clean sample flagged'); }
  console.log(`${Object.keys(found).length} flagged, ${Object.keys(waivers).length} waived, ${bad} new; ${caught} breaks caught`);
  process.exit(bad ? 1 : 0);
}
