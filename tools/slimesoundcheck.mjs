#!/usr/bin/env node
// slimesoundcheck.mjs — #1005: slime/magma_cube landing particles, squish/jump/attack sounds, magma canSpawn.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
  '14j_combat.js', '07za_explosion.js', '03b_noise.js', '07zd_slime.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
MCL.EntityList.init(); MCL.Ai.init(); MCL.Spawn.init(); MCL.Slime.init();
const Sl = MCL.Slime, Spawn = MCL.Spawn;

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const sounds = [], parts = [];
MCL.Sound = { play: (id, o) => { sounds.push([id, o]); return true; } };
MCL.Particles = { spawn: (t, x, y, z, a, b, c, r, item) => { parts.push([t, item]); return {}; } };

// the validators are what the anti-vacuity breaks run against
const landingOk = (type, size, snd, pts) =>
  pts.length === size * 8 &&
  pts.every((p) => type === 'magma_cube' ? p[0] === 'flame' : (p[0] === 'item_crack' && p[1] === 'slime_ball')) &&
  snd.length === 1 && snd[0][0] === `entity.${type}.` + (size <= 1 ? 'squish_small' : 'squish') &&
  Math.abs(snd[0][1].volume - 0.4 * size) < 1e-9 && snd[0][1].pitch >= 0.8 / 0.8 - 0.2 / 0.8 && snd[0][1].pitch <= 1.2 / 0.8;
function land(type, size) {
  sounds.length = 0; parts.length = 0;
  const e = { type, size, x: 0, y: 64, z: 0, onGround: false };
  Sl.tickLanding(e);                       // airborne: nothing
  const quiet = sounds.length === 0 && parts.length === 0;
  e.onGround = true; Sl.tickLanding(e); e.onGroundLastTick = true;   // landing
  const res = [sounds.slice(), parts.slice()];
  sounds.length = 0; parts.length = 0; Sl.tickLanding(e);   // still on ground: nothing new
  return { quiet, res, again: sounds.length === 0 && parts.length === 0 };
}
for (const type of ['slime', 'magma_cube']) for (const size of [1, 2, 4]) {
  const r = land(type, size);
  ok(r.quiet && r.again, `${type}/${size}: particles/sound only on the landing tick`);
  ok(r.res[0].every((x) => x[1].source === 'neutral'), `${type}/${size}: squish plays in NEUTRAL (vanilla Entity.getSoundCategory; only HostileEntity overrides)`);
  ok(landingOk(type, size, r.res[0], r.res[1]), `${type}/${size}: landing burst ${JSON.stringify(r.res[0].map((s) => s[0]))} x${r.res[1].length}`);
}

// jump: pitch (r-r)*0.2+1 times 1.4 small / 0.8 big, vol 0.4*size
const jumpOk = (type, size, s) => {
  const small = size <= 1, ev = type === 'magma_cube' ? 'entity.magma_cube.jump' : (small ? 'entity.slime.jump_small' : 'entity.slime.jump');
  const k = small ? 1.4 : 0.8;
  return s.length === 1 && s[0][0] === ev && Math.abs(s[0][1].volume - 0.4 * size) < 1e-9 &&
    s[0][1].pitch >= 0.8 * k - 1e-9 && s[0][1].pitch <= 1.2 * k + 1e-9;
};
const jumps = [];
for (const type of ['slime', 'magma_cube']) for (const size of [1, 2]) {
  sounds.length = 0;
  const e = { type, size, x: 0, y: 64, z: 0, onGround: true, yaw: 0, slimeTicksUntilJump: 0, speedAttr: 0.3 };
  const mc = new Sl.MoveControl(e); mc.move(1.0); mc.tick();
  ok(e.jumping === true, `${type}/${size}: hop started`);
  ok(jumpOk(type, size, sounds), `${type}/${size}: jump sound ${JSON.stringify(sounds.map((s) => [s[0], s[1].pitch]))}`);
  jumps.push([type, size, sounds.slice()]);
}

// attack: slime.attack vol 1.0 on a successful touch
{
  sounds.length = 0;
  const p = { x: 0, y: 64, z: 0 };
  MCL.Survival = Object.assign(MCL.Survival || {}, { hurt: () => true });
  const e = { type: 'slime', size: 2, x: 0, y: 64, z: 0, health: 4, attackDamage: 2 };
  Sl.ready = true; Sl.tickTouch(e, { players: () => [p] });
  ok(sounds.length === 1 && sounds[0][0] === 'entity.slime.attack' && sounds[0][1].volume === 1.0, 'touch plays entity.slime.attack');
}

// canSpawn: no light/biome/floor test; lava/water in the box refuses; peaceful refuses
const R = MCL.Reg, S = MCL.States;
const stateOf = (nm) => { for (let st = 1; st < S.block.length; st++) if (R.names[S.block[st]] === nm) return st; return 0; };
const lava = stateOf('lava'), water = stateOf('water');
let cells = {};
MCL.World.getBlock = (x, y, z) => cells[x + ',' + y + ',' + z] || 0;
const rule = () => Spawn.RULES.magma_cube(10, 40, 10);
ok(typeof Spawn.RULES.magma_cube === 'function' && Spawn.canPlace('magma_cube'), 'magma_cube has a placement rule');
MCL.Diff.value = 'normal';
ok(rule() === true, 'open air, no light/floor test: spawns');
cells = { '10,40,10': lava }; ok(rule() === false, 'lava in the box refuses');
cells = { '10,40,10': water }; ok(rule() === false, 'water in the box refuses');
cells = {}; MCL.Diff.value = 'peaceful'; ok(rule() === false, 'peaceful refuses'); MCL.Diff.value = 'normal';
ok(lava > 0 && water > 0, 'found lava/water states');

// anti-vacuity: corrupt the observations and the validators must fail
{
  const r = land('magma_cube', 2);
  const b = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
  b(!r.res[0].every((x) => Object.assign({}, x[1], { source: 'hostile' }).source === 'neutral'), 'hostile source is caught');
  b(!landingOk('magma_cube', 2, r.res[0], r.res[1].slice(1)), 'one particle short is caught');
  b(!landingOk('magma_cube', 2, [['entity.magma_cube.squish_small', r.res[0][0][1]]], r.res[1]), 'wrong squish event is caught');
  b(!landingOk('magma_cube', 2, [[r.res[0][0][0], Object.assign({}, r.res[0][0][1], { volume: 0.4 })]], r.res[1]), 'wrong volume is caught');
  b(!landingOk('slime', 2, [['entity.slime.squish', r.res[0][0][1]]], r.res[1]), 'flame particles on a slime are caught');
  const j = jumps.find((x) => x[0] === 'magma_cube' && x[1] === 2)[2];
  b(!jumpOk('magma_cube', 2, [[j[0][0], Object.assign({}, j[0][1], { pitch: 1.4 })]]), 'wrong jump pitch is caught');
  b(!jumpOk('magma_cube', 2, []), 'missing jump sound is caught');
}

{ // #4401: one shared wasOnGround flag, persisted; a restored grounded slime is silent on its first tick
  const quietAfter = (flag) => { sounds.length = 0; parts.length = 0;
    const e = { type: 'slime', size: 2, x: 0, y: 64, z: 0, onGround: true, onGroundLastTick: flag }; Sl.tickStretch(e);
    return sounds.length === 0 && parts.length === 0 && (flag || e.targetStretch !== 0); };
  ok(quietAfter(true), 'restored wasOnGround=true: no squish on the first tick');
  ok(!quietAfter(undefined), 'fresh (flag lost) grounded slime squishes -- what the persistence prevents');
  const nbt = readFileSync(join(MCLITE_ROOT, 'src/07zw_mobnbt.js'), 'utf8');
  const listed = (src) => /slime:\s*\[[^\]]*'onGroundLastTick'/.test(src);
  ok(listed(nbt), 'slime NBT list persists onGroundLastTick');
  breaks++; ok(!listed(nbt.replace("'onGroundLastTick'", "'x'")), 'anti-vacuity: dropping the NBT field is caught');
}

console.log(` assertions passed .. ${pass}`); console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log("  ✗ " + f);
if (fails.length) console.log(`${pass} assertions, ${fails.length} failures`);
if (fails.length) process.exit(1);
console.log(`slimesoundcheck — ${pass} assertions, 0 failures, ${breaks} breaks caught`);
