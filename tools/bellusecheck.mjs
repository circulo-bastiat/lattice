#!/usr/bin/env node
// bellusecheck.mjs — #8062: BellBlock.onUse / isPointOnBell (.decomp BellBlock.java).
// Drives the real Use.blockUse against the real registry.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('bellusecheck — #8062 BellBlock.onUse / isPointOnBell');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
               '07t_fly.js', '07q_effects.js', '09b_sky.js', '07zo_bee.js', '07s_raid.js', '07zv7_vbbell.js', '07zzo_stats.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const {  States: S, BlockEntities: BE, World: W, EntityList: EL, Inventory: Iv, Behave: B, Use } = MCL;
MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
BE.init(); W.init(1); B.init(W); EL.init(); if (MCL.Ai && MCL.Ai.init) MCL.Ai.init();
if (Use.init) Use.init(W);


for (let cx = -1; cx < 4; cx++) { const ch = W.makeChunk(cx, 0); ch.state = MCL.CH.GENERATED; W.chunks.set(W.key(cx, 0), ch); }
const FN = ['east', 'west', 'up', 'down', 'south', 'north'];
let n = 0, rang = 0, sounds = [], events = [];
MCL.Sound = MCL.Sound || {}; MCL.Sound.play = (id) => { sounds.push(id); };
MCL.GameEvent = MCL.GameEvent || {}; MCL.GameEvent.emit = (t) => { events.push(t); };
const stat = () => (MCL.Stats && MCL.Stats.get ? MCL.Stats.get('bell_ring') : null);
const bell = (facing, att) => { let s = S.stateOf('bell'); s = B.setProp(s, 'facing', facing); return B.setProp(s, 'attachment', att); };
function click(facing, att, face, hy) {
  const x = 4 + 2 * (++n), y = 64, z = 4;
  W.setBlock(x, y, z, bell(facing, att), true); BE.create(x, y, z, 'bell');
  sounds = []; events = [];
  const P = { x: x + 0.5, y, z: z + 0.5, tface: face, thy: y + hy, mayBuild: true };
  const r = Use.blockUse(P, x, y, z, W.getBlock(x, y, z), null);
  const be = BE.get(x, y, z);
  return { r, ringing: !!be.ringing, side: be.lastSideHit, sounds: sounds.slice(), events: events.slice() };
}
let o = click('north', 'floor', 4, 0.5);   // face south (4), facing axis z == face axis z
ok(o.r === true && o.ringing, 'floor bell hit on the body along its facing axis must ring');
ok(o.side === 'south', 'lastSideHit must be the struck face, got ' + o.side);
ok(o.sounds.includes('block.bell.use'), 'must play block.bell.use');
ok(o.events.includes('ring_bell'), 'must emit ring_bell');
o = click('north', 'floor', 4, 0.9);
ok(!o.ringing, 'hit above 0.8124 (the post/top) must not ring');
o = click('north', 'floor', 2, 0.5);
ok(!o.ringing, 'hit on the top face must not ring');
o = click('north', 'floor', 0, 0.5);
ok(!o.ringing, 'floor bell struck across its facing axis must not ring');
o = click('north', 'ceiling', 0, 0.5);
ok(o.ringing, 'ceiling bell rings from any side face');
o = click('north', 'single_wall', 0, 0.5);
ok(o.ringing, 'wall bell rings on the perpendicular axis');
o = click('north', 'single_wall', 4, 0.5);
ok(!o.ringing, 'wall bell does not ring on the facing axis');

let caught = 0;
const caughtIt = (m) => { caught++; console.log('   ✓ broken: ' + m); };
const keep = Use.isPointOnBell; Use.isPointOnBell = () => true;
o = click('north', 'floor', 4, 0.95);
if (o.ringing) caughtIt('hit test removed -> a post/top hit rings');
o = click('north', 'single_wall', 4, 0.5);
if (o.ringing) caughtIt('hit test removed -> wrong-axis hit rings');
Use.isPointOnBell = keep;
ok(caught === 2, 'anti-vacuity: only ' + caught + '/2 breaks caught');

console.log('================ bellusecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${caught}`);
for (const m of fails) console.log(' - ' + m);
process.exit(fails.length ? 1 : 0);
