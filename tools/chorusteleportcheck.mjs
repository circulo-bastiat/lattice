#!/usr/bin/env node
// chorusteleportcheck — #6434: ChorusFruitItem.finishUsing's own loop (Enderman.chorusTeleport) uses the
// entity's OWN box and plays the teleport sound at the origin AND the destination. Shared by the fox and the player.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
console.log('chorusteleportcheck — #6434: chorus fruit teleport uses the eater\'s own box');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
          '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
          '07l_spawn.js', '14j_combat.js', '07zf_bat.js', '07zg_enderman.js', '07zw_mobnbt.js', '07q_effects.js', '07z_potion.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
const W = M.World, S = M.States, Em = M.Enderman;
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0;
for (let x = -12; x <= 12; x++) for (let z = -3; z <= 3; z++) for (let y = 60; y <= 68; y++) W.setBlock(x, y, z, stone);
for (let x = -12; x <= 12; x++) W.setBlock(x, 64, 0, 0);          // a 1-high tunnel along x

const plays = []; M.Sound = { play: (n, o) => plays.push([n, o.x, o.y, o.z]) };
const seq = [0.8125, 0.5, 0.5]; const mkR = () => { let i = 0; return () => seq[i++ % 3]; };   // +5 x, y+0, +0 z
const run = (w, h) => {
  plays.length = 0;
  const e = { x: 0.5, y: 64, z: 0.5, width: w, height: h, dead: false };
  const moved = Em.chorusTeleport(e, mkR(), { sound: 'entity.fox.teleport' });
  return { e, moved };
};
const fox = run(0.6, 0.7);
ok(fox.moved && Math.abs(fox.e.x - 5.5) < 1e-9 && fox.e.y === 64, 'fox-sized box lands 5 blocks along the 1-high tunnel');
ok(plays.length === 2 && plays[0][1] === 0.5 && plays[1][1] === 5.5 && plays.every((p) => p[0] === 'entity.fox.teleport'), 'sound counted at origin and destination');
const big = run(0.6, 2.9);
ok(!big.moved && big.e.x === 0.5 && plays.length === 0, 'an enderman-sized box refuses every spot in the tunnel, silently');
okAv(!run(0.6, 2.9).moved && run(0.6, 0.7).moved, 'swapping the box flips the verdict');
okAv(run(0.6, 0.7).moved === true && (() => { const r = run(0.6, 0.7); return plays.length === 2; })(), 'dropping a sound would be caught (2 plays)');
okAv(!(() => { const e = { x: 0.5, y: 64, z: 0.5, width: 0.6, height: 0.7 }; return Em.teleportTo(e, 5.5, 64, 0.5); })(), 'Enderman.teleportTo (enderman box) refuses what the fox box accepts');
console.log(`chorusteleportcheck: ${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
