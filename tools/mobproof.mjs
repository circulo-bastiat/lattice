// Proof matrix (#7520): one row per roster mob, 7 dimensions, green/red/missing. Dan 15 Oct: a mob is PROVEN while all are green.
// Inputs: tools/mobproof/out/<dimension>.json = { <mob>: { pass, checked, notCovered, failed } }, tools/mobl3-mobs.json (roster),
// tools/referee/lanes.d (lockstep lane), tools/goalaudit-known.json (goals). Absent file / absent mob = MISSING, never green.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const DIMS = ['model', 'texture', 'animation', 'drops', 'spawn', 'lockstep', 'goals'];
const HERE = dirname(fileURLToPath(import.meta.url));
const rd = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export function buildMatrix(o = {}) {
  const tools = o.tools || HERE, out = o.out || join(tools, 'mobproof', 'out');
  const roster = Object.keys((rd(join(tools, 'mobl3-mobs.json')) || { mobs: {} }).mobs);
  const lanes = new Set(); const ld = join(tools, 'referee', 'lanes.d');
  if (existsSync(ld)) for (const f of readdirSync(ld)) { const j = rd(join(ld, f)); if (j && j.mob) lanes.add(j.mob); }
  const known = ((rd(join(tools, 'goalaudit-known.json')) || {}).filed || []).map((k) => String(k).split('|')[0]);
  const files = {}; for (const d of DIMS) files[d] = rd(join(out, d + '.json'));
  const rows = {};
  for (const m of roster) {
    const r = {};
    for (const d of DIMS) {
      const f = files[d], e = f && Object.prototype.hasOwnProperty.call(f, m) ? f[m] : null;
      let s = !e || typeof e.pass !== 'boolean' ? 'missing' : e.pass ? 'green' : 'red';
      if (d === 'lockstep' && !lanes.has(m)) s = s === 'red' ? 'red' : 'missing';
      if (d === 'goals' && known.includes(m) && s === 'green') s = 'red';
      r[d] = s;
    }
    r.proven = DIMS.every((d) => r[d] === 'green');
    rows[m] = r;
  }
  return { roster: roster.length, proven: roster.filter((m) => rows[m].proven).length, rows };
}

export function renderMd(M) {
  const c = { green: 'green', red: 'RED', missing: 'missing' };
  return `# Mob proof matrix - proven ${M.proven}/${M.roster}\n\n| mob | ${DIMS.join(' | ')} |\n|---|${DIMS.map(() => '---').join('|')}|\n` +
    Object.entries(M.rows).map(([m, r]) => `| ${m}${r.proven ? ' ✔' : ''} | ${DIMS.map((d) => c[r[d]]).join(' | ')} |`).join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const M = buildMatrix(); mkdirSync(join(HERE, 'mobproof'), { recursive: true });
  writeFileSync(join(HERE, 'mobproof', 'matrix.json'), JSON.stringify(M, null, 1));
  writeFileSync(join(HERE, 'mobproof', 'matrix.md'), renderMd(M));
  console.log(`mobproof: proven ${M.proven}/${M.roster}`);
}
