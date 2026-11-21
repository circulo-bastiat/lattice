// Static coverage map (#7064, rung 4 of #4984): every non-trivial method of a pilot mob's decompiled class chain
// is mapped to a `// Class.method` citation in src/ or to a tools/golden/coverage-unreachable.tsv row (with a reason).
//   node tools/coveragemap.mjs --mob cow|zombie|creeper [--src <dir>] [--unreachable <tsv>] [--list]
// Non-trivial = body of 3+ lines; constructors, client-only (render/animation) names and abstract methods are skipped.
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEC = path.join(ROOT, '.decomp');
const START = { cow: 'CowEntity', zombie: 'ZombieEntity', creeper: 'CreeperEntity' };
const CLIENT = /^(shouldRender|render|getClient|getLerp|lerp|getHandSwing|updateLimbs|animate|spawnParticles|handleStatus|isGlowing|getTeamColor)/;

function findClass(name) {
  const hit = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name === name + '.java') hit.push(p);
    }
  })(path.join(DEC, 'net/minecraft'));
  return hit[0];
}
export function chain(start) {
  const out = []; let n = start;
  while (n) {
    const f = findClass(n); if (!f) break;
    const txt = fs.readFileSync(f, 'utf8'); out.push({ name: n, txt });
    const m = txt.match(/\bclass \w+(?:<[^{]*?>)? extends (\w+)/); n = m && m[1];
  }
  return out;
}
export function methods(cls) {
  const lines = cls.txt.split('\n'), res = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^    (?:(?:public|protected|private|static|final|synchronized)\s+)*(?:<[^>]+>\s+)?[\w<>\[\],.? ]+?\s+(\w+)\(.*\)(?: throws [\w, ]+)? \{$/);
    if (!m || m[1] === cls.name || /^\s+(return|new|else)\b/.test(lines[i])) continue;
    let j = i + 1; while (j < lines.length && lines[j] !== '    }') j++;
    if (j - i - 1 < 3 || CLIENT.test(m[1])) continue;
    res.push(m[1]);
  }
  return [...new Set(res)];
}
export function map(mob, srcDir, unrTsv) {
  const srcTxt = fs.readdirSync(srcDir, { recursive: true }).filter(f => /\.js$/.test(f))
    .map(f => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
  const unr = new Map();
  for (const l of fs.readFileSync(unrTsv, 'utf8').split('\n')) {
    const [k, why] = l.split('\t'); if (k && !k.startsWith('#') && why) unr.set(k, why);
  }
  const rows = [];
  for (const c of chain(START[mob])) for (const m of methods(c)) {
    const id = c.name + '.' + m;
    const re = new RegExp('\\b' + c.name + '\\.' + m + '\\b');
    rows.push(re.test(srcTxt) ? { id, st: 'MAPPED' } : unr.has(id) ? { id, st: 'UNREACHABLE', why: unr.get(id) } : { id, st: 'UNMAPPED' });
  }
  return rows;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const a = process.argv.slice(2), g = k => { const i = a.indexOf(k); return i < 0 ? null : a[i + 1]; };
  const mob = g('--mob'); if (!START[mob]) { console.error('usage: --mob cow|zombie|creeper'); process.exit(2); }
  const rows = map(mob, g('--src') || path.join(ROOT, 'src'), g('--unreachable') || path.join(ROOT, 'tools/golden/coverage-unreachable.tsv'));
  const c = s => rows.filter(r => r.st === s).length;
  if (a.includes('--list')) for (const r of rows) console.log(r.st + '\t' + r.id);
  else for (const r of rows) if (r.st === 'UNMAPPED') console.log('UNMAPPED ' + r.id);
  console.log(`${mob}: ${rows.length} methods, ${c('MAPPED')} mapped, ${c('UNREACHABLE')} unreachable, ${c('UNMAPPED')} UNMAPPED`);
  process.exit(c('UNMAPPED') ? 1 : 0);
}
