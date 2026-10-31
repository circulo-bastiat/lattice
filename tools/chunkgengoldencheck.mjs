#!/usr/bin/env node
// chunkgengoldencheck.mjs — #1899 C2ME-1: every chunk the engine generates INLINE still hashes to
// tools/golden/chunkgen-golden.json (FNV-1a of sections + biome + heightmap + spawner/entity logs, 3 seeds x 21x21).
// A later C2ME unit may change when/where a chunk is built, never what it holds: this is the judge.
// Anti-vacuity: one block / biome / height / spawner / entity flipped in ONE chunk, and one corrupted golden
// entry, must each be caught.

import { readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
import { GOLDEN_FILE, GOLDEN_SEEDS, GOLDEN_R, hashSeed, hashColumn, goldenParams } from './chunkgenprofile.mjs';

let pass = 0; const fails = [];
const ok = (c, m, d) => { if (c) pass++; else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } };
const okAv = (c, m, d) => { if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

const g = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));
const M = loadEngine({});
ok(g.r === GOLDEN_R, 'golden radius matches the tool', g.r);
ok(JSON.stringify(g.params) === JSON.stringify(goldenParams(M)), 'golden generation params match the defaults the engine ships (regenerate with --golden --write if defaults moved on purpose)');

const n = (2 * GOLDEN_R + 1) ** 2;
for (const s of GOLDEN_SEEDS) {
  const want = g.seeds[s];
  ok(Array.isArray(want) && want.length === n, 'golden has ' + n + ' chunks for seed ' + s, want && want.length);
  const got = hashSeed(M, s, GOLDEN_R);
  let bad = 0; got.forEach((h, i) => { if (h !== want[i]) { if (++bad <= 3) console.log('DIFF seed ' + s + ' chunk #' + i + ' ' + h + ' != ' + want[i]); } });
  ok(bad === 0, 'seed ' + s + ': every one of ' + n + ' chunks hashes to the golden', bad + ' differ');
  if (bad) continue;

  // --- anti-vacuity, on the centre chunk (index = centre of the row-major 21x21) ---
  if (s !== GOLDEN_SEEDS[0]) continue;
  const mid = (n - 1) / 2;
  M.Gen.init(s, goldenParams(M));
  const mk = () => M.Gen.genColumn(0, 0);
  const col0 = mk();
  ok(hashColumn(col0) === want[mid], 'centre chunk regenerates to its golden hash');
  const breaks = {
    'one block flipped in one section (palette index data)': (c) => { const sec = c.sec.find((x) => x.u < 0); sec.d[0] ^= 1; },
    'one uniform section changed to another block': (c) => { const sec = c.sec.find((x) => x.u >= 0); sec.u = sec.u + 1; },
    'one block-light byte changed': (c) => { const sec = c.sec.find((x) => x.lu < 0); sec.l[5] ^= 1; },
    'one biome byte changed': (c) => { c.biome[17] ^= 1; },
    'one heightmap value changed': (c) => { c.hmap[3] += 1; },
    'a spawner log entry appended': (c) => { c.spawners = (c.spawners || []).concat([[1, 2, 3, 4]]); },
    'an entity yaw changed by one float step': (c) => { c.entities = (c.entities || []).concat([[1, 2, 3, 4, 0.5]]); },
  };
  for (const [name, f] of Object.entries(breaks)) {
    let c; try { c = mk(); f(c); } catch (e) { okAv(false, name + ' (setup threw: ' + e.message + ')'); continue; }
    okAv(hashColumn(c) !== want[mid], name + ' is caught by the golden compare');
  }
  // the whole-seed path: a mutate hook on ONE chunk of the 441 shows up as exactly one differing entry
  const mutated = hashSeed(M, s, GOLDEN_R, (c, cx, cz) => { if (cx === 3 && cz === -4) c.hmap[0] += 1; });
  const diff = mutated.filter((h, i) => h !== want[i]).length;
  okAv(diff === 1, 'a single-chunk mutation inside the full ' + n + '-chunk sweep differs in exactly one entry', diff);
  // a corrupted golden entry is a mismatch too
  const bent = want.slice(); bent[7] = bent[7].replace(/./, (ch) => (ch === '0' ? '1' : '0'));
  okAv(got.some((h, i) => h !== bent[i]), 'a corrupted golden entry is detected');
}

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   \u2717 ' + f);
process.exit(fails.length ? 1 : 0);
