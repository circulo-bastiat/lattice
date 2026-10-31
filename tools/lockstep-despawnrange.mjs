#!/usr/bin/env node
// lockstep-despawnrange -- #7943 (G18c-L8): lockstep lane 'despawnrange', 20 salts x 3000 ticks. Monster/animal/water/ambient/raider mobs at 20/40/70/100/140 blocks, with and without persistence (name tag, leash, picked-up item), against an oracle of MobEntity.checkDespawn + tickNewAi (immediate range by SpawnGroup, start range 32, counter > 600 then nextInt(800)==0, counter reset inside 32, +1/+2 bumps, canImmediatelyDespawn overrides) on identical random streams. Items (ItemEntity 6000-age despawn) are not MobEntity.checkDespawn and stay with the item lane.
//
// and thunder; Spawn.RULES.zombie (spawner reason, so only the light + difficulty gates) against an oracle re-derived from .decomp HostileEntity.isSpawnDark /
// canSpawnInDark on identical random streams (sky > nextInt(32) refuses; block > 0 refuses; thunder uses max(block, sky-10) else ambient darkness; <= nextInt(8)),
// the peaceful gate, the final stream state, and Spawn.isAcceptablePosition (d2 <= 576 refuses: never closer than 24).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };

const EXTRA = ['14h_brigadier.js', '15g_commands.js', '02f_tags.js', '02g_items.js', '02i_text.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
  '14j_combat.js', '07za_explosion.js', '03b_noise.js', '07zd_slime.js', '07q_effects.js', '14f_inventory.js', '07zw_mobnbt.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Text.init({ lang: b64('lang.bin'), langBytes: rdj('lang.meta.json').rawBytes, langOverrides: readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const EL = M.EntityList, Spawn = M.Spawn, Sl = M.Slime, W = M.World;
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; EL.init(); M.Ai.init(); Spawn.init(); Sl.init();
M.Diff.value = 'normal'; Spawn.CLEAR_CHECK = false;


const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
W.getLight = () => 0; W.loadedAt = () => true; W.tickingAt = () => true;
M.Sky = { dayTime: 0, moonPhase: () => 0, darknessNow: () => 0, isThundering: () => false };
M.Player = { x: 0, y: 64, z: 0 };
M.Diff.value = 'normal';
let rs = null;
EL.wr = () => rs();
EL.remove = (e) => { e.removed = true; };

// SpawnGroup ranges from .decomp: [name, immediate, bump]
const SG = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/entity/SpawnGroup.java'), 'utf8');
const imm = {}; for (const m of SG.matchAll(/\("(\w+)", -?\d+, \w+, \w+, (\d+)\)/g)) imm[m[1]] = +m[2];
const TYPES = [['zombie', 'monster', 0], ['cow', 'creature', 0], ['squid', 'water_creature', 0], ['cod', 'water_ambient', 0], ['bat', 'ambient', 0], ['pillager', 'monster', 2]];
const DIST = [20, 40, 70, 100, 140];
const PERS = ['none', 'nametag', 'leash', 'pickup'];
let START = 32;
// oracle: canImmediatelyDespawn by kind (MobEntity true; AnimalEntity false; FishEntity !fromBucket && !hasCustomName)
const canImm = (ty, o) => ty === 'cow' ? false : (ty === 'cod' ? !o.name : true);
const oracleTick = (o, f) => {
  if (o.dead) return;
  const persistent = o.pers === 'leash' || o.pers === 'pickup';
  if (!persistent && !(o.ty === 'cow' && false)) {
    const d2 = o.d * o.d, ir = imm[o.grp], start = START;
    if (d2 > ir * ir && canImm(o.ty, o)) { o.dead = true; return; }
    if (o.c > 600 && f(800) === 0 && d2 > start * start && canImm(o.ty, o)) { o.dead = true; return; }
    else if (d2 < start * start) o.c = 0;
  } else o.c = 0;
  o.c += 1 + o.bump;
};

function run(salt) {
  const out = { div: '', gone: 0 };
  rs = stream(salt); const rb = stream(salt), fb = (k) => Math.floor(rb() * k);
  const init = stream(salt + 1000);
  const mobs = [];
  for (const [ty, grp, bump] of TYPES) for (const d of DIST) for (const p of PERS) {
    const c0 = Math.floor(init() * 700);
    const e = { type: ty, x: d, y: 64, z: 0, despawnCounter: c0, persistent: p === 'leash' || p === 'pickup', customName: p === 'nametag' ? 'Bob' : null, age: 5000 };
    mobs.push({ e, o: { ty, grp, bump, d, c: c0, name: p === 'nametag', pers: p, dead: false }, tag: `${ty}@${d}/${p}` });
  }
  for (let t = 0; t < 3000 && !out.div; t++) {
    for (const m of mobs) {
      if (m.e.removed) { if (!m.o.dead) { out.div = `salt ${salt} tick ${t} ${m.tag} engine removed, vanilla alive`; break; } continue; }
      Spawn.despawnOne(m.e); oracleTick(m.o, fb);
      if (!!m.e.removed !== m.o.dead) { out.div = `salt ${salt} tick ${t} ${m.tag} engine ${!!m.e.removed} vanilla ${m.o.dead}`; break; }
      if (!m.o.dead && m.e.despawnCounter !== m.o.c) { out.div = `salt ${salt} tick ${t} ${m.tag} counter ${m.e.despawnCounter} vs ${m.o.c}`; break; }
    }
    if (!out.div && rs() !== rb()) out.div = `salt ${salt} tick ${t} random stream drift`;
  }
  out.gone = mobs.filter((m) => m.o.dead).length; out.alive = mobs.length - out.gone;
  return out;
}

const all = () => { const r = []; for (let s = 0; s < 20; s++) r.push(run(s)); return r; };
const runs = all();
const div = runs.filter((r) => r.div).map((r) => r.div);
ok(div.length === 0, 'divergences: ' + div[0]);
ok(runs.every((r) => r.gone > 20 && r.alive > 20), 'lane vacuous: gone/alive ' + runs[0].gone + '/' + runs[0].alive);
ok(JSON.stringify(run(3)) === JSON.stringify(runs[3]), 'not deterministic');

let caught = 0;
const tryBreak = (name, apply, undo) => { apply(); const x = all().some((r) => r.div); undo(); n++; if (x) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
const oOdds = Spawn.DESPAWN_ROLL_ODDS, oIdle = Spawn.DESPAWN_IDLE_TICKS, oCat = JSON.stringify(Spawn.CATEGORY.monster), oCI = Spawn.canImmediatelyDespawn;
tryBreak('1/400 roll', () => { Spawn.DESPAWN_ROLL_ODDS = 1 / 400; }, () => { Spawn.DESPAWN_ROLL_ODDS = oOdds; });
tryBreak('idle gate 300', () => { Spawn.DESPAWN_IDLE_TICKS = 300; }, () => { Spawn.DESPAWN_IDLE_TICKS = oIdle; });
tryBreak('immediate range 90', () => { Spawn.CATEGORY.monster.despawn = 90; }, () => { Spawn.CATEGORY.monster = JSON.parse(oCat); });
tryBreak('start range 16', () => { Spawn.CATEGORY.monster.noDespawn = 16; }, () => { Spawn.CATEGORY.monster = JSON.parse(oCat); });
tryBreak('animals despawn', () => { Spawn.canImmediatelyDespawn = () => true; }, () => { Spawn.canImmediatelyDespawn = oCI; });
console.log(`${n} assertions, despawnrange: ${caught} breaks caught, ${div.length} divergences${div[0] ? ' ' + div[0] : ''}`);
