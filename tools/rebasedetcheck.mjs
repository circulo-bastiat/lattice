// rebasedetcheck (#10219): the goat and villager lockstep lanes are deterministic on the real server because SeedAgent re-bases World.random to a salt-only seed
// at the mob's first Entity.tick, and run.mjs turns it on for those two lanes only. Prints '<n> breaks caught'.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const L = join(dirname(fileURLToPath(import.meta.url)), 'referee', 'lockstep');
const agent = readFileSync(join(L, 'SeedAgent.java'), 'utf8'), run = readFileSync(join(L, 'run.mjs'), 'utf8');
const MOBS = [['goat', 'bjk', 'GOATREB', 'goatSeed'], ['villager', 'bnw', 'VILREB', 'villagerSeed']];
function verdict(a, r) {
  const p = [];
  for (const [m, cls, flag, fn] of MOBS) {
    if (!new RegExp(`static void ${fn}\\(Object e\\)[^]*?getName\\(\\)\\.equals\\("${cls}"\\)[^]*?worldSeed\\(fw\\.get\\(e\\)\\)\\.set`).test(a)) p.push(`${m}: re-base lost`);
    if (!a.includes(`if (${flag}) ${fn}(e);`)) p.push(`${m}: re-base not called from entx`);
    if (!a.includes(`if (${flag} && ENTXLOG == null && "axk".equals(name))`)) p.push(`${m}: Entity.tick hook not installed`);
    if (!r.includes(`mob === '${m}'`) || !r.includes(`-Dmclite.lockstep.rebase${m}=true`)) p.push(`${m}: run.mjs does not enable it`);
    if (!new RegExp(`// LANE:${m} #\\d+\\n\\s*if \\(agent && mob === '${m}'`).test(r)) p.push(`${m}: run.mjs edit not LANE-fenced`);
  }
  return p;
}
const base = verdict(agent, run);
if (base.length) { console.log('rebasedetcheck: FAIL ' + base.join('; ')); process.exit(1); }
const breaks = [
  ['goat re-base call removed', verdict(agent.replace('if (GOATREB) goatSeed(e);', ''), run)],
  ['villager re-base call removed', verdict(agent.replace('if (VILREB) villagerSeed(e);', ''), run)],
  ['goat class changed', verdict(agent.replace('.equals("bjk")', '.equals("zzz")'), run)],
  ['villager hook removed', verdict(agent.replace('VILREB && ENTXLOG == null', 'false && ENTXLOG == null'), run)],
  ['goat flag not passed', verdict(agent, run.replace('-Dmclite.lockstep.rebasegoat=true', ''))],
  ['villager unfenced', verdict(agent, run.replace('// LANE:villager #10219', '// x'))],
];
let caught = 0;
for (const [n, p] of breaks) { if (p.length) caught++; else console.log('FAIL: break not caught: ' + n); }
if (caught !== breaks.length) process.exit(1);
console.log(`rebasedetcheck: ${caught} breaks caught`);
