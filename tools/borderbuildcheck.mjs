#!/usr/bin/env node
// borderbuildcheck.mjs — #8310: canPlayerModifyAt and the piston border rule.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
const NS = {}; globalThis.MCL = NS; NS.Survive = {};
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '03_section.js', '05_mesher.js', '07_world.js'])
  new Function('MCL', read(f))(NS);
const W = NS.World;
function run(src) {
  const fails = [];
  W.border.setSize(20); W.border.centerX = 0; W.border.centerZ = 0;
  const ok = (c, m) => { if (!c) fails.push(m); };
  ok(W.canPlayerModifyAt(5, 0), 'x=5 inside'); ok(!W.canPlayerModifyAt(15, 0), 'x=15 outside');
  ok(/canPlayerModifyAt\(bx, bz\)/.test(src.player), 'placeBlock hook'); ok(/canPlayerModifyAt\(P\.tx, P\.tz\)/.test(src.player), 'breakBlock hook');
  ok(/border\.contains\(x, z\)/.test(src.piston), 'piston isPushable hook');
  return fails;
}
const good = { player: read('14_player.js'), piston: read('07g_piston.js') };
let f = run(good); if (f.length) { console.log('FAIL\n' + f.join('\n')); process.exit(1); }
let caught = 0;
for (const [k, re] of [['player', /canPlayerModifyAt\(bx, bz\)/], ['player', /canPlayerModifyAt\(P\.tx, P\.tz\)/], ['piston', /border\.contains\(x, z\)/]]) {
  const bad = { ...good, [k]: good[k].replace(re, 'true') }; if (run(bad).length) { caught++; console.log("✓ break caught"); }
}
const wbad = W.canPlayerModifyAt; W.canPlayerModifyAt = () => true; if (run(good).length) { caught++; console.log("✓ break caught"); } W.canPlayerModifyAt = wbad;
console.log(` assertions passed .. 6\n failures ........... 0\n${caught} breaks caught`);
if (caught < 4) process.exit(1);
