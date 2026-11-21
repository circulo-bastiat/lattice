// Class-level coverage map (#11465, Track F item 1 of #11464). One command regenerates it:
//   node tools/classmap.mjs [--write] [--quiet]      (default writes docs/audits/classmap.md + tools/classmap.json)
// One row per top-level class of .decomp 1.18.2: class | module | wired | stages | proof | verdict.
// METHOD (static, and it says what it cannot see - see the CANNOT_SEE block, printed in the .md):
//  link   : a src/ module "ports" a class when the class's simple name is cited in it (header comments, name tables, `// Class.method`).
//  wired  : module-level call graph of src/ (module A -> B when A mentions an NS symbol B defines), BFS from the real entry
//           modules. tools/ never count (unit-API-only calls do not make a port wired, #11224).
//  stages : stages.d stage files citing the class name; proof type R referee / V vanilla data / G golden / C check.
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENTRY = ['17_main.js', '04d_column.js', '14_player.js', '13_input.js', '15m_title.js', '04_worldgen.js', '09_jobs.js', '07_world.js'];  // worldgen runs in worker bundles built from 04_worldgen/09_jobs
const OUT_PKG = /^net\/minecraft\/(client\/(realms|resource|gl|texture|util|network|main|option|toast\/.*Realms|font|sound\/.*Loader)|realms|datafixer|network\/(encryption|packet)|server\/(dedicated|rcon|filter|network|gui|command\/(Debug|Perf))|util\/(crash|profiler|thread|logging|dynamic|Util|Lazy)|obfuscate|resource|test|gametest|data|SharedConstants|MinecraftVersion)/;
const OUT_NAME = /(Archaeolog|Emote|Skin|Realms|Telemetry|Narrator|Snooper|Yggdrasil|Datafix|Crash|Jfr|Debug)/;

export function listClasses(dec) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.java') && !e.name.includes('$')) out.push(path.relative(dec, p).replace(/\\/g, '/').replace(/\.java$/, ''));
    }
  })(path.join(dec, 'net'));
  return out;
}
export function scope(c) {
  const name = c.split('/').pop();
  if (/package-info$/.test(name) || c.includes('/unused/packageinfo')) return 'package-info stub';
  if (/^class_\d+$/.test(name)) return 'unmapped (no Yarn name)';
  if (OUT_PKG.test(c)) return 'client/server plumbing, no gameplay or picture';
  if (OUT_NAME.test(name)) return 'Bedrock-only / out of scope by name';
  return null;
}
const strip = (s) => s;
export function loadSrc(src) {
  const mods = {};
  for (const f of fs.readdirSync(src)) if (f.endsWith('.js')) mods[f] = fs.readFileSync(path.join(src, f), 'utf8');
  return mods;
}
export function moduleGraph(mods) {
  const defs = {}, owner = {};
  for (const [f, t] of Object.entries(mods)) {
    const s = new Set(); for (const m of t.matchAll(/\bNS\.(\w+)\s*=[^=]/g)) s.add(m[1]);
    for (const m of t.matchAll(/^\s*(?:var|function)\s+NS_(\w+)/gm)) s.add(m[1]);
    defs[f] = s; for (const n of s) (owner[n] ||= new Set()).add(f);
  }
  const edges = {};
  for (const [f, t] of Object.entries(mods)) {
    const e = (edges[f] = new Set());
    for (const m of t.matchAll(/\b(?:NS|MCL)\.(\w+)/g)) for (const o of owner[m[1]] || []) if (o !== f) e.add(o);
    // registration: B assigns into NS.X.<member> = ... ; the module that owns X then carries B (A -> B)
    // #11523: NS.X.register(...) / .registerStructure( is a registration too (04y registers 'fortress' into NS.Structures)
    for (const m of t.matchAll(/\bNS\.(\w+)\.register\w*\(/g)) for (const o of owner[m[1]] || []) if (o !== f) (edges[o] ||= new Set()).add(f);
    for (const m of t.matchAll(/\bNS\.(\w+)\.\w+\s*=[^=]/g)) for (const o of owner[m[1]] || []) if (o !== f) (edges[o] ||= new Set()).add(f);
  }
  return edges;
}
export function reach(edges, entry) {
  const seen = new Set(entry.filter((e) => edges[e])), q = [...seen];
  while (q.length) for (const n of edges[q.pop()] || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  return seen;
}
export function loadStages(root) {
  const dir = path.join(root, 'tools/stages.d'), res = [];
  for (const f of fs.readdirSync(dir)) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const s of [].concat(j)) {
      if (!s.file) continue; const p = path.join(root, s.file); if (!fs.existsSync(p)) continue;
      const t = fs.readFileSync(p, 'utf8');
      const proof = /vanillacheck|referee/i.test(t) ? 'R' : /\.decomp|\.mcdata/.test(t) ? 'V' : /golden/i.test(t) ? 'G' : 'C';
      res.push({ id: s.id, proof, words: new Set(t.match(/[A-Za-z_]\w{3,}/g) || []) });
    }
  }
  return res;
}
export function build(root = ROOT, opt = {}) {
  const dec = path.join(root, '.decomp');
  const classes = opt.classes || listClasses(dec), mods = opt.mods || loadSrc(path.join(root, 'src'));
  const edges = moduleGraph(mods), live = reach(edges, ENTRY), stages = opt.stages || loadStages(root);
  const wordMods = {}; // identifier -> {module: count}
  for (const [f, t] of Object.entries(mods)) for (const w of t.match(/[A-Z][A-Za-z0-9]{3,}/g) || []) ((wordMods[w] ||= {})[f] = (wordMods[w][f] || 0) + 1);
  const rows = [];
  for (const c of classes) {
    const name = c.split('/').pop(), sc = scope(c);
    const hit = wordMods[name] || {};
    const ms = Object.entries(hit).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    const mod = ms[0] || 'MISSING', wired = ms.some((m) => live.has(m));
    const st = stages.filter((s) => s.words.has(name)); const proofs = [...new Set(st.map((s) => s.proof))].sort().join('');
    let verdict;
    if (sc) verdict = 'out-of-scope'; else if (!ms.length) verdict = 'missing';
    else if (!wired) verdict = 'ported-unwired'; else if (!st.length) verdict = 'ported-unchecked'; else verdict = 'proven';
    rows.push({ class: c, module: mod, wired: ms.length ? wired : false, stages: st.slice(0, 5).map((s) => s.id), nstages: st.length, proof: proofs || '-', verdict, why: sc || '' });
  }
  const counts = {}; for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  return { rows, counts, live: [...live].length, modules: Object.keys(mods).length };
}
export const CANNOT_SEE = [
  'Module-level graph: a module counts as wired when any entry module reaches ANY symbol it defines; one dead class in a live module reads as wired. The runtime coverage run (owed, see issue) tightens this.',
  'Name link is by simple class name cited in src/: a port that never cites its Yarn name reads MISSING (false missing); a class named only in passing reads ported (false ported).',
  'Stage link is "stage file cites the class name": it does not prove the stage asserts anything about it, and a stage that drives a class only through a helper reads unchecked.',
  'Dynamic dispatch (NS[name](), table-driven registration, worker bundles loaded by string) is invisible to the static graph.',
  'unmapped class_NNNN files have no Yarn name and are not linked.',
];
export function render(r) {
  const c = r.counts, L = [];
  L.push('# Class-level coverage map (generated by `node tools/classmap.mjs`; do not edit)', '');
  L.push(`Verdicts: ${c.proven || 0} proven, ${c['ported-unchecked'] || 0} ported-unchecked, ${c['ported-unwired'] || 0} ported-unwired, ${c.missing || 0} missing, ${c['out-of-scope'] || 0} out-of-scope (${r.rows.length} classes, ${r.live}/${r.modules} src modules reachable from entry).`, '');
  const cc = path.join(ROOT, 'tools/classcover.json');
  if (fs.existsSync(cc)) {
    const j = JSON.parse(fs.readFileSync(cc, 'utf8')), e = Object.entries(j.modules);
    const ran = e.reduce((a, [, v]) => a + v[0], 0), tot = e.reduce((a, [, v]) => a + v[1], 0);
    L.push('## Runtime coverage (main thread; `node tools/classcover.mjs`)', '');
    L.push(`Boot + new world + ${j.playSec}s of play: ${ran}/${tot} functions ran across ${e.length} modules. Worker threads and unreached GUIs/dimensions are not seen. Modules under 40% executed (functions ran/total):`, '');
    for (const [m, v] of e.filter(([, v]) => v[1] >= 5 && v[0] / v[1] < 0.4).sort((a, b) => a[1][0] / a[1][1] - b[1][0] / b[1][1])) L.push(`- ${m}: ${v[0]}/${v[1]}`);
    L.push('');
  }
  L.push('## What the method cannot see', ...CANNOT_SEE.map((x) => '- ' + x), '');
  const byMod = {};
  for (const x of r.rows) if (x.verdict === 'ported-unchecked') (byMod[x.module] ||= []).push(x.class.split('/').pop());
  L.push('## ported-unchecked, by module', '');
  for (const [m, v] of Object.entries(byMod).sort((a, b) => b[1].length - a[1].length)) L.push(`- ${m} (${v.length}): ${v.slice(0, 12).join(', ')}${v.length > 12 ? ', …' : ''}`);
  for (const v of ['ported-unwired', 'missing']) {
    L.push('', `## ${v}`, '');
    for (const x of r.rows.filter((y) => y.verdict === v)) L.push(`- ${x.class}${x.module !== 'MISSING' ? ' (' + x.module + ')' : ''}`);
  }
  L.push('', '## proven (sample of stages)', '');
  for (const x of r.rows.filter((y) => y.verdict === 'proven')) L.push(`- ${x.class.split('/').pop()} | ${x.module} | ${x.proof} | ${x.stages.join(', ')}${x.nstages > 5 ? ' +' + (x.nstages - 5) : ''}`);
  return L.join('\n') + '\n';
}
if (import.meta.url === 'file://' + process.argv[1]) {
  const r = build();
  fs.mkdirSync(path.join(ROOT, 'docs/audits'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/audits/classmap.md'), render(r));
  fs.writeFileSync(path.join(ROOT, 'tools/classmap.json'), JSON.stringify({ counts: r.counts, rows: r.rows.map((x) => [x.class, x.module, x.wired ? 1 : 0, x.nstages, x.proof, x.verdict]) }));
  const c = r.counts;
  console.log(`classmap: ${c.proven || 0} proven, ${c['ported-unchecked'] || 0} ported-unchecked, ${c['ported-unwired'] || 0} ported-unwired, ${c.missing || 0} missing, ${c['out-of-scope'] || 0} out-of-scope (${r.rows.length} classes)`);
}
