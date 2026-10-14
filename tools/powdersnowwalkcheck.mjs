#!/usr/bin/env node
// powdersnowwalkcheck.mjs -- #5656: PowderSnowBlock.getCollisionShape. Leather boots / rabbit / endermite /
// silverfish stand on powder snow, everything else sinks; falling_block and fallDistance>2.5 land on the 0.9 shape.
import { readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const M = loadEngine({ extra: ['02g_items.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07y_equip.js', '07i_entitylist.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(new URL('../assets/entities.json', import.meta.url), 'utf8')) });
M.Entities.init(); M.EntityList.init();
M.Items.init({ items: readFileSync(new URL('../assets/items.bin', import.meta.url)).toString('base64'), itemsBytes: JSON.parse(readFileSync(new URL('../assets/items.meta.json', import.meta.url), 'utf8')).rawBytes });
if (M.Equip.init) M.Equip.init();
const W = M.World, CH = M.CH, S = M.States, IT = M.Items, Ph = M.Physics;
const STONE = S.stateOf('stone') | 0, POW = S.stateOf('powder_snow') | 0;
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) { W.setBlock(x, 0, z, STONE); W.setBlock(x, 1, z, POW); }   // cell y=1..2, floor top 1
const dim = (t) => M.Entities.dimensions(t);

function drop(type, boots, fall0, steps) {
  const d = dim(type), e = { type, x: 0.5, y: 2.4, z: 0.5, vx: 0, vy: 0, vz: 0, width: d.width, height: d.height, onGround: false, fallDistance: fall0 || 0 };
  if (boots) M.Equip.setEquipped(e, IT.FEET, M.Equip.stackOf(boots));
  for (let i = 0; i < (steps || 20); i++) Ph.move(e, 0, -0.3, 0);
  return e.y;
}
function run() {
  ok(Math.abs(drop('player', 'leather_boots') - 2) < 1e-3, 'leather boots stand on top (y=2)');
  ok(Math.abs(drop('player', null) - 1) < 1e-3, 'bare player sinks to the bottom (y=1)');
  ok(Math.abs(drop('player', 'iron_boots') - 1) < 1e-3, 'iron boots sink');
  for (const t of ['rabbit', 'endermite', 'silverfish']) ok(Math.abs(drop(t, null) - 2) < 1e-3, t + ' stands');
  ok(Math.abs(drop('zombie', null) - 1) < 1e-3, 'zombie sinks');
  ok(Math.abs(drop('falling_block', null) - 1.9) < 1e-3, 'falling_block stopped by the 0.9 shape');
  ok(Math.abs(drop('player', null, 3, 2) - 1.9) < 1e-3, 'fallDistance>2.5 lands on the 0.9 shape');
}
run();
const orig = Ph.canWalkOnPowderSnow;
function caught(m, thunk) { breaks++; const f0 = fails.length, p0 = pass; thunk(); const hit = fails.length > f0; fails.length = f0; pass = p0; ok(hit, 'anti-vacuity: ' + m); }
caught('nobody walks', () => { Ph.canWalkOnPowderSnow = () => false; run(); Ph.canWalkOnPowderSnow = orig; });
caught('everybody walks', () => { Ph.canWalkOnPowderSnow = () => true; run(); Ph.canWalkOnPowderSnow = orig; });
console.log('powdersnowwalkcheck: ' + pass + ' checks, ' + breaks + ' breaks caught' + (fails.length ? '\n' + fails.join('\n') : ''));
process.exit(fails.length ? 1 : 0);
