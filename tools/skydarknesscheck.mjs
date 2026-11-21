// #1642: boss-bar darkenSky -> GameRenderer.skyDarkness -> lightmap tint (0.7,0.6,0.6), both backends.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../dist/mclite.html', import.meta.url), 'utf8');
const rules = [
  ['wither bar sets darkenSky', /bossBar = \{ name: 'Wither', percent: 1\.0, color: 'purple', darkenSky: true \}/],
  ['skyDarkness rises 1.0/s (0.05/tick)', /Math\.min\(1, sd \+ 1\.0 \* dtS\)/],
  ['skyDarkness falls 0.25/s (0.0125/tick)', /Math\.max\(0, sd - 0\.25 \* dtS\)/],
  ['frameState carries skyDarkness', /fs\.skyDarkness = G\.skyDarkness/],
  ['webgl2 uploads it in uParams.z', /uniform4f\(locs\.uParams, s\.fogFar, s\.skyScale, Math\.min\(s\.skyDarkness/],
  ['webgpu uploads it in params.z', /f\[26\] = Math\.min\(state\.skyDarkness/],
  ['webgl2 world tint', /vTint = ' \+ Gx\.tintMapExpr\('tint', 'wp', tintSample, sel, true, vec3\) \+ ' \* mix\(vec3\(1\.0\), vec3\(0\.7, 0\.6, 0\.6\), fract\(uParams\.z\)\)/],
  ['webgl2 entity tint', /etint \* mix\(vec3\(1\.0\), vec3\(0\.7, 0\.6, 0\.6\), fract\(uParams\.z\)\)/],
  ['webgpu world tint', /vec3<f32>\(0\.7, 0\.6, 0\.6\), fract\(uFrame\.params\.z\)\);',/],
  ['webgpu entity tint', /etint \* mix\(vec3<f32>\(1\.0\), vec3<f32>\(0\.7, 0\.6, 0\.6\), fract\(uFrame\.params\.z\)\)/],
];
let bad = 0;
for (const [n, re] of rules) { if (!re.test(html)) { console.log('FAIL', n); bad++; } }
let caught = 0;
for (const [n, re] of rules) { if (!re.test(html.replace(new RegExp(re.source, 'g'), ''))) caught++; else console.log('NOT CAUGHT', n); }
console.log(`${rules.length - bad}/${rules.length} rules hold; ${caught} breaks caught`);
process.exit(bad || caught !== rules.length ? 1 : 0);
