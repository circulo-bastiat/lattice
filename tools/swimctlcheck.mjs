// #4311: every Ai.SwimGoal registration is JUMP-only (vanilla SwimGoal.java:12 setControls(JUMP)).
import fs from 'node:fs';
const re = /gs\.add\(\d+,\s*([^,]+),\s*new Ai\.SwimGoal/g;
function scan(src) { const bad = []; let n = 0, m; while ((m = re.exec(src))) { n++; if (m[1].trim() !== 'Ai.JUMP') bad.push(m[0]); } return { n, bad }; }
const src = ['07k_goals.js', '07t_fly.js'].map(f => fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')).join('\n');
const r = scan(src);
if (r.n < 4 || r.bad.length) { console.log('FAIL', r.n, r.bad); process.exit(1); }
let caught = 0;
if (scan(src.replace('gs.add(1, Ai.JUMP, new Ai.SwimGoal', 'gs.add(1, Ai.MOVE | Ai.JUMP, new Ai.SwimGoal')).bad.length) { caught++; console.log("✓ break caught"); }
if (scan(src.replace(/Ai\.JUMP, new Ai\.SwimGoal/, 'Ai.MOVE, new Ai.SwimGoal')).bad.length) { caught++; console.log("✓ break caught"); }
if (caught !== 2) { console.log('FAIL breaks'); process.exit(1); }
console.log(`OK  ${r.n} checks passed, 0 failures; ${caught} breaks caught`);
