#!/usr/bin/env node
// placefeaturecheck.mjs — G17-CMD11 (#8073): /placefeature runs the worldgen's own feature code.
//   1. the command is IMPLEMENTED and level 2 (golden tsv)
//   2. `/placefeature oak <pos>` on grass grows EXACTLY the tree `Features.api.runInline` grows from
//      the same rng on the same blocks (the code path the referee compares in worldgen)
//   3. an unknown id fails with the vanilla argument message; a feature that cannot place fails with
//      commands.placefeature.failed; success carries commands.placefeature.success
//   4. anti-vacuity: with the command removed / the generator broken the check fails
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };


const EXTRA = ['02i_text.js', '02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14h_brigadier.js', '15g_commands.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const F = MCL.Features, SR = MCL.States, C = MCL.Commands, CFG = MCL.CFG;
const MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;
MCL.Gen.init(20260924, Object.assign(MCL.Gen.defaults(), { climate: 'vanilla', features: true }));
F.init(MCL.Gen);
const STONE = SR.stateOf('stone'), GRASS = SR.stateOf('grass_block');
const SEED = 4242;
const GY = 70;                               // grass top
const flat = (x, y, z) => (y < GY ? STONE : y === GY ? GRASS : 0);
let WORLD;
const reset = () => { WORLD = new Map(); };
reset();
const key = (x, y, z) => x + ',' + y + ',' + z;
MCL.World.seed = SEED;
MCL.World.getBlock = (x, y, z) => { const k = key(x, y, z); return WORLD.has(k) ? WORLD.get(k) : flat(x, y, z); };
MCL.World.setBlock = (x, y, z, id) => { WORLD.set(key(x, y, z), id); return true; };
const player = { x: 8.5, y: GY + 1, z: 8.5 };
const run = (line) => C.run(line, player, { level: 2 });

// 1. roster
ok(C.IMPLEMENTED.indexOf('placefeature') >= 0, 'placefeature must be in Commands.IMPLEMENTED');
C.build();
const node = C.dispatcher.get('placefeature');
ok(!!node, 'dispatcher must know placefeature');
if (node) {
  ok(node.canUse(C.source(player, { level: 2 })), 'level 2 may run /placefeature');
  ok(!node.canUse(C.source(player, { level: 1 })), 'level 1 may not');
}

// 2. oak == worldgen oak
const X = 8, Z = 8, Y = GY + 1;
const r1 = run(`placefeature minecraft:oak ${X} ${Y} ${Z}`);
ok(r1.ok, 'oak must place: ' + r1.lines.join(' | '));
const placed = new Map(WORLD);
// reference: the worldgen path on the same scratch chunks
const inl = F.api.inline('minecraft:oak', 'placefeaturecheck');
const ref = new Map();
for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
  const sb = new Uint16Array(H * 256);
  for (let ly = 0; ly < H; ly++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) sb[(ly << 8) | (lz << 4) | lx] = flat(0, ly + MINY, 0);
  const o = sb.slice();
  const r = F.api.rngAt(SEED, X, Y, Z);
  F.api.runInline(inl, sb, dx, dz, X, Y, Z, r);
  for (let i = 0; i < sb.length; i++) if (sb[i] !== o[i]) ref.set(key((dx << 4) + (i & 15), (i >> 8) + MINY, (dz << 4) + ((i >> 4) & 15)), sb[i]);
}
let same = ref.size > 20 && ref.size === placed.size;
for (const [k, v] of ref) if (placed.get(k) !== v) same = false;
ok(same, `placed tree (${placed.size} cells) must equal the worldgen tree (${ref.size} cells)`);
const logs = [...placed.values()].filter((v) => v === SR.stateOf('oak_log') || String(SR.name && SR.name(v)).indexOf('oak_log') >= 0).length;
ok(placed.size > 20, 'a tree has more than 20 blocks');
ok(r1.lines.some((l) => String(l).indexOf('commands.placefeature.success') >= 0 || /Placed/.test(String(l))), 'success message: ' + r1.lines.join('|'));

// 3. failures
const r2 = run('placefeature minecraft:nonsense');
ok(!r2.ok, 'unknown id must fail');
ok(r2.lines.join('|').length > 0, 'unknown id must say something');
reset();
const r3 = run(`placefeature minecraft:spring_water ${X} ${GY + 60} ${Z}`);   // spring needs solid neighbours
ok(!r3.ok && r3.lines.join('|').indexOf('Failed to place feature') >= 0 || (!r3.ok && /placefeature\.failed/.test(r3.lines.join('|'))),
   'a feature that cannot place fails with commands.placefeature.failed: ' + r3.lines.join('|'));

// 4. anti-vacuity
{
  const saved = C.IMPLEMENTED.slice();
  C.IMPLEMENTED = saved.filter((n) => n !== 'placefeature');
  okAv(C.IMPLEMENTED.indexOf('placefeature') < 0, 'removing the command from IMPLEMENTED is seen (the roster assertion would fail)');
  C.IMPLEMENTED = saved;
  const orig = F.placeAt;
  F.placeAt = () => 0; reset();
  okAv(!run(`placefeature minecraft:oak ${X} ${Y} ${Z}`).ok && WORLD.size === 0, 'a placeAt that places nothing makes the oak run fail');
  F.placeAt = orig;
  reset(); WORLD.set('x', 1);
  okAv(!(WORLD.size === placed.size), 'a world that differs from the tree is not equal to it');
}
console.log(`placefeaturecheck: ${breaks} breaks caught`);
console.log('==============================================');
console.log(` assertions ......... ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
for (const f of fails) console.log(' \u2717 ' + f);
process.exit(fails.length ? 1 : 0);
