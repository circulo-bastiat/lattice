// lockstep-summonnbt -- #7091: /summon NBT reads (Motion, Rotation, NoGravity, Invulnerable, Silent, Tags, Health, ActiveEffects, ArmorItems, creeper powered/Fuse) vs independent reference, 20 salts. (#6718: armor stand hit/break rules, drops, slotFromPosition thresholds, equipment swap by use, creative break, explosion kill; vs independent reference over 20 salts.
// and TurtleEggBlock.randomTick (progress on nextInt(500)==0 or skyAngle in (0.65,0.69); hatch 0->1->2, then break + one baby per egg, baby age -24000) and TurtleEntity.onGrowUp (one scute).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '15g_commands.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json'), monsterTypes: JSON.parse(/monsterTypes:\s*(\[[^\]]*\])/.exec(readFileSync(join(MCLITE_ROOT, 'src', '19_data.gen.js'), 'utf8'))[1]) });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.Mount.init();

const { EntityList: EL } = M;
const C = M.Commands || M.Cmd || Object.values(M).find((v) => v && typeof v.applyNbt === 'function');
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
let n = 0, fails = 0, breaks = 0;
function runAll() {
  const bad = [], eq = (salt, what, a, b) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(`salt ${salt}: ${what} ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
  for (let salt = 0; salt < 20; salt++) {
    const r = stream(salt), d = () => (r() - 0.5) * 4;
    const mot = [d(), d(), d()], rot = [Math.fround(r() * 360), Math.fround(r() * 90)];
    EL.list.length = 0;
    const z = EL.spawn('zombie', 0.5, 0, 0.5);
    const dur = 100 + Math.floor(r() * 1000), amp = Math.floor(r() * 4), hp = 1 + Math.floor(r() * 30);
    C.applyNbt(z, { Motion: mot, Rotation: rot, NoGravity: 1, Invulnerable: 1, Silent: 1, Tags: ['a', 't' + salt], Health: hp,
      ActiveEffects: [{ Id: 'minecraft:speed', Duration: dur, Amplifier: amp }], ArmorItems: [{}, {}, {}, { id: 'minecraft:iron_helmet', Count: 1 }] });
    eq(salt, 'motion', [z.vx, z.vy, z.vz], mot); eq(salt, 'rot', [z.yaw, z.pitch], rot);
    eq(salt, 'flags', [z.noGravity, z.invulnerable, z.silent], [true, true, true]); eq(salt, 'tags', z.tags, ['a', 't' + salt]);
    eq(salt, 'health', z.health, Math.min(z.maxHealth, hp));
    eq(salt, 'effect', z.effects.speed, { effect: 'speed', duration: dur, amplifier: amp });
    eq(salt, 'helmet', z.equip && z.equip[M.Items.HEAD] && z.equip[M.Items.HEAD].i, M.Items.of('iron_helmet'));
    const c = EL.spawn('creeper', 0.5, 0, 0.5), fz = 1 + Math.floor(r() * 60);
    C.applyNbt(c, { powered: 1, Fuse: fz });
    eq(salt, 'creeper', [c.charged, c.fuseTime], [true, fz]);
  }
  return bad;
}
const bad0 = runAll();
bad0.slice(0, 20).forEach((b) => console.log('  FAIL ' + b)); fails += bad0.length;
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = C.applyNbt; C.applyNbt = function (e, nbt) { o.call(this, e, Object.assign({}, nbt, { Motion: undefined })); };
  const f = fails, b = runAll(); C.applyNbt = o; fails = f; brk(b.length > 0, 'Motion read as zero (tick 0)'); }
{ const o = C.applyNbt; C.applyNbt = function (e, nbt) { o.call(this, e, nbt); if (e.effects) for (const k in e.effects) e.effects[k].duration++; };
  const f = fails, b = runAll(); C.applyNbt = o; fails = f; brk(b.length > 0, 'ActiveEffects duration off by one (tick 0)'); }
console.log(`lockstep-summonnbt: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
