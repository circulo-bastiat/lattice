// #11462: bench.yml must have pull-requests: read and take the PR number only when gh exits 0 and it is digits.
import fs from 'fs';
const src = fs.readFileSync(new URL('../.github/workflows/bench.yml', import.meta.url), 'utf8');
function verdict(s) {
  const e = [];
  if (!/permissions:[\s\S]*?\n\s+pull-requests: read/.test(s)) e.push('no pull-requests: read');
  if (!/if OUT=\$\(gh api[^\n]*\) && printf[^\n]*grep -Eq '\^\[0-9\]\+\$'/.test(s)) e.push('no digits-only guard');
  if (/PR=\$\(gh api/.test(s)) e.push('PR taken raw from gh');
  if (/title "[^"]*\(PR #\$PR\)"/.test(s)) e.push('title embeds raw PR');
  return e;
}
const base = verdict(src);
if (base.length) { console.log('FAIL: ' + base.join('; ')); process.exit(1); }
const muts = [
  s => s.replace('pull-requests: read', 'pull-requests: none'),
  s => s.replace("grep -Eq '^[0-9]+$'", 'true'),
  s => s.replace('PR=""', 'PR=$(gh api x)'),
  s => s.split('$PRT" --').join(' (PR #$PR)" --'),
];
let caught = 0;
for (const m of muts) if (verdict(m(src)).length) caught++;
if (caught !== muts.length) { console.log('FAIL: only ' + caught + ' breaks caught'); process.exit(1); }
console.log('bench.yml ok; ' + caught + ' breaks caught');
