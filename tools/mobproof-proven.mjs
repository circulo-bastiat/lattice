// full.mjs hook (#7520): compare tools/mobproof-proven.json with the latest matrix; returns {regressed:[{mob,dimension}], proven:[..]}
import { readFileSync, writeFileSync } from 'node:fs';
import { DIMS } from './mobproof.mjs';
export function diffProven(M, list) {
  const regressed = [], keep = [];
  for (const m of list) { const r = M.rows[m], bad = r && DIMS.find((d) => r[d] !== 'green'); if (!r || bad) regressed.push({ mob: m, dimension: bad || 'missing' }); else keep.push(m); }
  const added = Object.keys(M.rows).filter((m) => M.rows[m].proven && !keep.includes(m));
  return { regressed, proven: [...keep, ...added].sort(), added };
}
export async function applyProven(gh, ghAll, M, file) {
  const j = JSON.parse(readFileSync(file, 'utf8')), d = diffProven(M, j.mobs);
  for (const x of d.regressed) {
    const title = `PROVEN ${x.mob} regressed: ${x.dimension}`;
    const ex = (await ghAll('/repos/{repo}/issues?state=open&labels=severe')).find((i) => i.title === title);
    if (!ex) await gh('POST', '/repos/{repo}/issues', { title, body: `${x.mob} was proven; dimension ${x.dimension} is now red/missing in the latest full run (tools/mobproof/matrix.md).`, labels: ['severe', '01 BUGS'] });
  }
  j.mobs = d.proven; writeFileSync(file, JSON.stringify(j, null, 1) + '\n'); return d;
}
