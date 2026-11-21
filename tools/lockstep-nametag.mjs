#!/usr/bin/env node
// lockstep-nametag -- #7077 (G17-L214): scripted player uses a name tag on a cow, a zombie, a vindicator "Johnny" and a sheep "jeb_".
// Engine trace per tick (customName, persistent, alive, the Johnny target's legality, jeb_ colour, name tag stack count) is compared with
// compareTraces (exact doubles) against an oracle built from .decomp NameTagItem.useOnEntity / VindicatorEntity.setCustomName+TargetGoal /
// SheepWoolFeatureRenderer (jeb_). 20 salts. Breaks (source patches: Johnny's target filter reversed, persistence not set, ...) must diverge.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const TICKS = 160, USE_AT = { cow: 5, zombie: 6, vindicator: 7, sheep: 8 };
const NAMES = { cow: 'Bessie', zombie: 'Zed', vindicator: 'Johnny', sheep: 'jeb_' };
const ILLAGER = new Set(['vindicator', 'pillager', 'evoker', 'illusioner']);
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js', '14l_use.js'];
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

function build(patch) {
  const MOB = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
  const M = loadEngine({ extra: BASE_MODS.concat(MOB), dom: false, initReg: true, patch });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
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
  if (M.Goat && M.Goat.init) M.Goat.init();
  M.Player.init();
  M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
  if (M.Diff && M.Diff.set) M.Diff.set('normal');
  const stone = M.States.stateOf('stone');
  for (let x = -4; x <= 26; x++) for (let z = -6; z <= 6; z++) w.set(x, -1, z, stone);
  return { M, w, init: Object.assign({}, M.Player) };
}

const jebOracle = (order, fleece, age, id) => {   // SheepWoolFeatureRenderer.method_4198, partial 0
  const i0 = (Math.floor(age / 25) + id) % 16, i1 = (i0 + 1) % 16, t = (age % 25) / 25;
  const a = fleece(order[i0]), b = fleece(order[i1]);
  return [0, 1, 2].map((k) => a[k] * (1 - t) + b[k] * t);
};

// one run: engine trace and oracle trace, row t = state after t world ticks
function run(H, salt, FAR) {
  const { M } = H, EL = M.EntityList, P = M.Player, Pa = M.Passive;
  const r = stream(salt); EL.random = r; Math.random = r;
  if (M.wrandReset) M.wrandReset();
  EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0;
  P.init(); if (M.Diff && M.Diff.set) M.Diff.set('normal'); M.Gamemode.set(P, M.Gamemode.SURVIVAL);
  const still = () => { P.x = FAR ? -3.5 : 12.5; P.y = 0; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false; P.health = 20; };
  still(); P.invulnerable = 0; P.lastHurt = 0; P.exhaustion = 0;
  const at = { cow: 8.5, zombie: 4.5, vindicator: 16.5, sheep: 1.5 }, mob = {};
  for (const k of Object.keys(at)) { mob[k] = EL.spawn(k, at[k], 0, 0.5); if (!mob[k]) throw new Error('spawn ' + k); mob[k].vx = mob[k].vy = mob[k].vz = 0; }
  const pill = EL.spawn('pillager', 15.0, 0, 0.5); pill.persistent = true;   // an illager next to Johnny: never a target
  const tag = (n) => M.Inventory.stack('name_tag', 1, 0, { display: { Name: n } });
  const stacks = {}; for (const k of Object.keys(mob)) stacks[k] = tag(NAMES[k]);
  let everTargeted = false;
  const eng = [], ora = [], order = Pa.DYE_COLOR_ORDER;
  for (let t = 0; t < TICKS; t++) {
    for (const k of Object.keys(mob)) if (USE_AT[k] === t) M.Use.entityUse(P, mob[k], stacks[k]);
    const row = { tick: t }, orow = { tick: t };
    for (const k of Object.keys(mob)) {
      const e = mob[k], named = t >= USE_AT[k];
      row[k + 'Name'] = e.customName == null ? '' : e.customName;       orow[k + 'Name'] = named ? NAMES[k] : '';
      row[k + 'Persist'] = !!e.persistent;                               orow[k + 'Persist'] = named;
      row[k + 'Alive'] = !e.removed && !e.dead;                          orow[k + 'Alive'] = true;
      row[k + 'Tags'] = stacks[k].n;                                     orow[k + 'Tags'] = named ? 0 : 1;   // consumed in survival
    }
    const tg = mob.vindicator.target;
    row.johnnyTargetLegal = !tg || (!ILLAGER.has(tg.type) && tg !== mob.vindicator);   orow.johnnyTargetLegal = true;
    if (tg) everTargeted = true;
    row.johnnyTargets = t >= 150 ? everTargeted : true;                                          orow.johnnyTargets = true;   // sight + 16-block range: a legal victim is in view by tick 150
    row.jeb = Pa.jebColorAt(mob.sheep, 0);
    orow.jeb = jebOracle(order, Pa.fleeceColor, mob.sheep.age || 0, mob.sheep.id || 0);
    row.cowJeb = mob.cow.customName === 'jeb_'; orow.cowJeb = false;
    eng.push(row); ora.push(orow);
    still(); EL.tick(); for (const k of ['cow', 'zombie', 'sheep']) mob[k].health = 1e6;   // Johnny may fight; only his target choice is under test
  }
  return { eng, ora, fields: Object.keys(eng[0]).filter((f) => f !== 'tick') };
}

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const H = build();
let johnnyTargeted = 0;
for (const s of SALTS) {
  const { eng, ora, fields } = run(H, s);
  const d = compareTraces(eng, ora, { fields });
  ok(d === null, `salt ${s}: divergence ${JSON.stringify(d)}`);
  ok(eng.length === TICKS, `salt ${s}: rows`);
  if (eng.some((r) => r.johnnyTargets && r.tick >= 150)) johnnyTargeted++;
  if (s === 0) {
    ok(eng.some((r, t) => t > 0 && JSON.stringify(r.jeb) !== JSON.stringify(eng[t - 1].jeb)), 'jeb never cycled');
    ok(eng[TICKS - 1].zombieAlive && eng[TICKS - 1].zombiePersist, 'zombie kept');
  }
  const mut = eng.map((r, t) => (t === 100 ? { ...r, jeb: [r.jeb[0] + 1e-9, r.jeb[1], r.jeb[2]] } : r));
  if (s === 0) { const m = compareTraces(mut, ora, { fields }); if (m?.tick === 100) breaks++; else { bad++; console.log('NOT CAUGHT jeb 1e-9'); } }
}
ok(johnnyTargeted === SALTS.length, `Johnny held a target on ${johnnyTargeted}/20 salts`);

// source-patched engines: each break must diverge from the oracle on some salt
const BR = {
  'Johnny target filter reversed': (f, t) => f === '07k_goals.js' ? t.replace("!(o.type === 'vindicator'", "(o.type === 'vindicator'") : t,
  'persistence not set': (f, t) => f === '14l_use.js' ? t.replace('e.persistent = true;\n      // `VindicatorEntity.setCustomName()', 'e.persistent = false;\n      // `VindicatorEntity.setCustomName()') : t,
  'tag not consumed': (f, t) => f === '14l_use.js' ? t.replace('if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);\n      return true;\n    }\n    return false;', 'return true;\n    }\n    return false;') : t,
};
for (const [name, fn] of Object.entries(BR)) {
  let changed = false;
  const HB = build((f, t) => { const o = fn(f, t); if (o !== t) changed = true; return o; });
  ok(changed, `break "${name}": patch did not apply`);
  let hit = false;
  for (const s of SALTS) { const { eng, ora } = run(HB, s, true); if (compareTraces(eng, ora, { fields: name.startsWith('Johnny') ? ['johnnyTargetLegal'] : Object.keys(eng[0]).filter((f) => f !== 'tick') })) { hit = true; break; } }
  if (hit) breaks++; else { bad++; console.log('NOT CAUGHT ' + name); }
}
console.log(`${SALTS.length * 2 + 7} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${TICKS} ticks)`);
process.exit(bad ? 1 : 0);
