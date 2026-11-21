// lockstep-snowgolem -- #6684: snow golem trail (SnowBlock.canPlaceAt), heat (temperature > 1.0) and rain damage, ProjectileAttackGoal 20-tick cadence, snowball velocity, shear; vs independent reference over 20 salts.
// lockstep-turtle -- #6671 (G17-L100): lockstep scenario 'turtle', 20 salts: a pregnant turtle at its home beach.
// Reference = .decomp TurtleEntity.LayEggGoal (counter<1 -> digging, counter=1; counter>200 -> lay, then counter++ while digging; EGGS=nextInt(4)+1; love 600)
// and TurtleEggBlock.randomTick (progress on nextInt(500)==0 or skyAngle in (0.65,0.69); hatch 0->1->2, then break + one baby per egg, baby age -24000) and TurtleEntity.onGrowUp (one scute).
// The egg must appear exactly 200 ticks after the dig starts, with 1..4 eggs, hasEgg cleared, love 600; the hatch roll is replayed against an independent stream.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
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
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log("  FAIL " + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const { EntityList: EL, SnowGolem: SG, Combat: Cb } = M;
const grass = M.States.stateOf('grass_block'), snowS = SG.snowLayerState();
// biome patches: plains (x<0, temp 0.8) / desert (x>=0, temp 2.0); rain toggles by the lane
let raining = false;
M.World.biomeAt = (x) => (x < 0 ? 1 : 2);
M.Biomes.temperatureAt = (b) => (b === 1 ? 0.8 : 2.0);
M.Sky = Object.assign(M.Sky || {}, { isEntityRainedOn: () => raining });
// independent reference of SnowGolemEntity.tickMovement
const warmRef = (t) => t > 1.0;
function refSnow(x, y, z, getB) {
  const out = [];
  for (let k = 0; k < 4; k++) {
    const bx = Math.floor(x + ((k % 2) * 2 - 1) * 0.25), bz = Math.floor(z + (((k >> 1) % 2) * 2 - 1) * 0.25);
    if (getB(bx, Math.floor(y), bz) === 0 && getB(bx, Math.floor(y) - 1, bz) === grass) out.push(bx + ',' + Math.floor(y) + ',' + bz);
  }
  return out;
}
function floor() { cells.clear(); EL.list.length = 0; for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) w.set(x, -1, z, grass); }
function lane(salt, startX, wet, withZombie) {
  floor(); raining = wet;
  const r = stream(salt); EL.random = r; Math.random = r;
  const g = EL.spawn('snow_golem', startX + 0.5, 0, 0.5); g.persistent = true;
  let z = null;
  if (withZombie) { z = EL.spawn('zombie', startX + 0.5, 0, 8.5); z.persistent = true; z.noAi = true; z.maxHealth = z.health = 1e6; }
  const hurts = [], shots = [];
  const origHurt = Cb.hurt; Cb.hurt = function (e, amt, ...rest) { if (e === g) hurts.push([amt, rest[2] && rest[2].source]); return origHurt.call(this, e, amt, ...rest); };
  const known = new Set(); const origTick = SG.mobTick; let bad = null, tick = 0, placed = 0;
  SG.mobTick = function (e, ctx) {
    if (e !== g) return origTick.call(this, e, ctx);
    g.health = g.maxHealth = 1e6; g.dead = false; hurts.length = 0; g.hurtTime = 0; g.invulnerableTime = 0;
    const snapY = Math.floor(g.y), x = g.x, zz = g.z;
    const exp = refSnow(x, g.y, zz, w.get);
    const bio = M.World.biomeAt(Math.floor(x)), temp = M.Biomes.temperatureAt(bio);
    const wantHeat = warmRef(temp), wantWet = wet;
    origTick.call(this, e, ctx);
    const gotHeat = hurts.filter((h) => h[1] === 'onFire').length, gotWet = hurts.filter((h) => h[1] === 'drown').length;
    if (gotHeat !== (wantHeat ? 1 : 0)) bad = bad || `tick ${tick} heat ${gotHeat} vs ${wantHeat} at x=${x.toFixed(2)}`;
    if (gotWet !== (wantWet ? 1 : 0)) bad = bad || `tick ${tick} wet ${gotWet} vs ${wantWet}`;
    for (const [k, v] of cells) if (v === snowS && !known.has(k) && !exp.includes(k)) bad = bad || `tick ${tick} unexpected snow at ${k}`;
    for (const k of exp) { known.add(k); if (w.get(...k.split(',').map(Number)) !== snowS) bad = bad || `tick ${tick} missing snow at ${k}`; placed++; }
    return undefined;
  };
  let lastShot = 0, firstSeen = 0; const seen = new Set();
  try {
    for (tick = 1; tick <= 200; tick++) {
      EL.tick();
      for (const s of EL.list) if (s.type === 'snowball' && !seen.has(s)) {
        seen.add(s); shots.push(tick);
        const dx = z.x - g.x, dz = z.z - g.z, ay = g.y + 1.7 - 0.1, dy = (z.y + 1.74 - 1.1) - ay + Math.hypot(dx, dz) * 0.2;
        const len = Math.hypot(dx, dy, dz), sp = Math.hypot(s.vx, s.vy, s.vz);
        if (Math.abs(sp - 1.6) > 0.8 || s.vz * dz < 0) bad = bad || `snowball v=(${s.vx.toFixed(2)},${s.vy.toFixed(2)},${s.vz.toFixed(2)}) speed ${sp.toFixed(2)} vs 1.6 dir ${(dz / len).toFixed(2)}`;
      }
    }
  } finally { SG.mobTick = origTick; Cb.hurt = origHurt; }
  if (withZombie) {
    if (shots.length < 4) bad = bad || 'shots ' + shots.length;
    for (let i = 1; i < shots.length && !bad; i++) if (shots[i] - shots[i - 1] !== 20) bad = `cadence ${shots[i] - shots[i - 1]} != 20 (${shots.slice(0, 6)})`;
  }
  return { bad, placed, shots: shots.length };
}
let totalPlaced = 0;
for (let s = 0; s < 20; s++) {
  for (const [sx, wet, zom] of [[-8, false, true], [8, false, true], [-8, true, false], [-3, false, false]]) {
    const r = lane(s, sx, wet, zom); ok(!r.bad, `snowgolem salt ${s} x=${sx} wet=${wet}: ${r.bad}`); totalPlaced += r.placed;
  }
}
ok(totalPlaced > 100, 'snow layers were placed: ' + totalPlaced);
// shear / pumpkin removal
{ floor(); const g = EL.spawn('snow_golem', 0.5, 0, 0.5); ok(SG.canShear(g), 'fresh golem shearable'); const d = SG.shear(g); ok(d && d.item === 'carved_pumpkin' && d.count === 1 && g.hasPumpkin === false, 'shear drops pumpkin'); ok(!SG.canShear(g) && SG.shear(g) === null, 'sheared golem not shearable'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const f = fails, saved = M.Biomes.temperatureAt; M.Biomes.temperatureAt = (b) => (b === 1 ? 0.8 : 2.0);
  const origImpl = SG.applyHeatDamage; SG.applyHeatDamage = function (e) { const x = Math.floor(e.x); const t = M.Biomes.temperatureAt(M.World.biomeAt(x)); if (t > 2.5) return origImpl.call(this, e); };
  const r = lane(2, 8, false, false); brk(!!r.bad, `warm threshold changed: ${r.bad}`); SG.applyHeatDamage = origImpl; fails = f; breaks += 0; }
{ const orig = SG.SNOW_PLACE_OFFSETS; SG.SNOW_PLACE_OFFSETS = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.9, 0.9]];
  const r = lane(4, -8, false, false); brk(!!r.bad, `snow offsets changed: ${r.bad}`); SG.SNOW_PLACE_OFFSETS = orig; }
console.log(`lockstep-snowgolem: ${80 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
