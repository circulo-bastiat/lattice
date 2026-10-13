#!/usr/bin/env node
// lockstep-table -- #7063 (G17-L211): mob x dimension coverage table for the lockstep checks (#4984 phase 4).
// One row per tools/stages.d/lockstep-*.json stage: mob (id minus "lockstep-"), dimension, oracle, check id, faults caught,
// date, and a hash of the src/ lines the check covers. Covered lines = the 07*.js refs in the check (and the lane files it imports),
// "07x_name.js:a-b" for a line range, else the whole file; plus every 07*.js whose name word is inside the mob id; none at all -> 07k_goals.js. Table lives in tools/golden/lockstep-table.tsv.
//   node tools/lockstep-table.mjs            print the table, mark STALE / MISSING cells, exit 1 if any
//   node tools/lockstep-table.mjs --write    regenerate the tsv (date kept while the hash is unchanged)
// MCLITE_SRC_DIR overrides src/ (the check edits a temp copy).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.MCLITE_SRC_DIR || join(ROOT, 'src');
const TSV = process.env.MCLITE_LOCKSTEP_TSV || join(ROOT, 'tools/golden/lockstep-table.tsv');
const STAGES = join(ROOT, 'tools/stages.d');
const NETHER = /blaze|ghast|piglin|hoglin|zoglin|strider|wither_?skeleton|magma/, END = /enderdragon|ender_dragon|shulker|endcrystal/;

const srcFiles = readdirSync(SRC).filter((f) => /^07.*\.js$/.test(f));
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

export function rows() {
  const out = [];
  for (const sf of readdirSync(STAGES).filter((f) => /^lockstep-.*\.json$/.test(f)).sort()) {
    for (const st of JSON.parse(read(join(STAGES, sf)))) {
      if (!st.id?.startsWith('lockstep-') || st.id === 'lockstep-tablecheck') continue;
      const mob = st.id.slice(9), file = join(ROOT, st.file);
      let text = read(file);
      for (const m of text.matchAll(/from '(\.[^']*lockstep\/[^']+)'/g)) text += read(join(dirname(file), m[1]));
      const refs = new Map();
      for (const m of text.matchAll(/\b(07[0-9a-z]*_[a-z0-9_]+\.js)(?::(\d+)-(\d+))?/g)) {
        if (!srcFiles.includes(m[1])) continue;
        refs.set(m[2] ? `${m[1]}:${m[2]}-${m[3]}` : m[1], m[2] ? [m[1], +m[2], +m[3]] : [m[1]]);
      }
      {
        for (const f of srcFiles) { const w = f.replace(/^07[0-9a-z]*_|\.js$/g, ''); if (w.length >= 4 && mob.includes(w) && !refs.has(f)) refs.set(f, [f]); }
      }
      if (!refs.size) refs.set('07k_goals.js', ['07k_goals.js']);
      const h = createHash('sha256');
      for (const k of [...refs.keys()].sort()) {
        const [f, a, b] = refs.get(k), lines = read(join(SRC, f)).split('\n');
        h.update(k + '\n' + (a ? lines.slice(a - 1, b) : lines).join('\n') + '\n');
      }
      out.push({
        mob, dim: END.test(mob) ? 'end' : NETHER.test(mob) ? 'nether' : 'overworld',
        oracle: /MCLITE_LOCKSTEP_SERVER|runLane|rep0/.test(text) ? 'server-rep0' : 'engine-model',
        check: st.id, faults: (text.match(/\bcaught\(|breaks\+\+|breaks\+=/g) || []).length,
        hash: h.digest('hex').slice(0, 16), src: [...refs.keys()].join(','),
      });
    }
  }
  return out;
}

const COLS = ['mob', 'dim', 'oracle', 'check', 'faults', 'date', 'hash', 'src'];
export function load() {
  const m = new Map();
  for (const l of read(TSV).split('\n').slice(1)) { if (!l) continue; const c = l.split('\t'); m.set(c[3], Object.fromEntries(COLS.map((k, i) => [k, c[i]]))); }
  return m;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cur = rows(), old = load(), today = new Date().toISOString().slice(0, 10);
  if (process.argv.includes('--write')) {
    const lines = [COLS.join('\t'), ...cur.map((r) => { const o = old.get(r.check); r.date = o && o.hash === r.hash ? o.date : today; return COLS.map((k) => r[k]).join('\t'); })];
    writeFileSync(TSV, lines.join('\n') + '\n');
    console.log(`lockstep-table: wrote ${cur.length} rows to ${TSV}`);
  } else {
    let bad = 0;
    for (const r of cur) {
      const o = old.get(r.check);
      const st = !o ? 'MISSING' : o.hash !== r.hash ? 'STALE' : 'ok';
      if (st !== 'ok') bad++;
      console.log([r.mob, r.dim, r.oracle, r.check, r.faults, o?.date ?? '-', r.hash, st].join('\t'));
    }
    for (const k of old.keys()) if (!cur.some((r) => r.check === k)) { bad++; console.log(`${old.get(k).mob}\t\t\t${k}\t\t\t\tORPHAN`); }
    console.log(`lockstep-table: ${cur.length} rows, ${bad} stale/missing`);
    process.exit(bad ? 1 : 0);
  }
}
