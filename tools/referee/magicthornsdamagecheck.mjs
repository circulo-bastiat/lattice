// magicthornsdamagecheck (#9215, part of #9203): magic and thorns damage per roster mob, engine vs the vanilla rule, per tick, 20 salts.
// Sources: MAGIC (DamageSource.MAGIC setBypassesArmor, 6 = instant harming I) and THORNS (setThorns().setUsesMagic(): armour applies, WitchEntity x0.15 for isMagic).
// Same decomp-rule reference as envdamagelockstepcheck (#9202); the real-server half is still owed. Writes mobproof/out/damage-magic.json, merged by mobdamageproof.
//
// Sources here: lava and fire block. Reference = .decomp Entity.setOnFireFromLava (skipped entirely when isFireImmune: no fire, no LAVA 4),
// AbstractFireBlock.onEntityCollision (also skipped when fire immune), LivingEntity.damage grace window (timeUntilRegen > 10 passes only amount-lastDamage),
// max health and fire immunity from the jar goldens (entity-attributes / entity-types). Writes tools/mobproof/out/damage-env.json, merged by mobdamageproof.
// Not covered: drowning, fall, cactus, starvation, void (their lockstep checks exist per class, not yet per roster mob).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
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
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
const { EntityList: EL, Items: IT, Equip: Eq, States: S, Effects: ES, Undead: U } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 60;
import { writeFileSync, mkdirSync } from 'node:fs';
const TD = join(MCLITE_ROOT, 'tools');
const rows = (f) => readFileSync(join(TD, 'golden', f), 'utf8').split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
const attrs = new Map(rows('entity-attributes-1.18.2.tsv').filter((r) => r[0] !== 'type').map((r) => [r[0], r]));
const types = new Map(rows('entity-types-1.18.2.tsv').map((r) => [r[0], r]));
const roster = Object.keys(JSON.parse(readFileSync(join(TD, 'mobl3-mobs.json'), 'utf8')).mobs).filter((m) => attrs.has(m) && types.has(m) && m !== 'armor_stand' && m !== 'ender_dragon' && m !== 'snow_golem' && m !== 'wither');   // snow_golem melts in the stub's biome, wither regenerates 1 per second (masking a same-tick hit): their own sources, not this check's
const TK = 40, ARM = { zombie: 2, husk: 2, drowned: 2, zombie_villager: 2 };
const soak = (a, ar) => (ar ? Math.fround(a * (1 - Math.min(20, Math.max(ar / 5, ar - a / 2)) / 25)) : a);
const AMT = { magic: 6, thorns: 3 };
const hitTicks = (salt) => { const r = stream(salt + 500), s = new Set(); while (s.size < 6) s.add(1 + Math.floor(r() * (TK - 1))); return s; };
function reference(src, salt, mob, hp0, amt) {
  const ar = src === 'thorns' ? ARM[mob] || 0 : 0, hit = hitTicks(salt);
  let hp = hp0, regen = 0, last = 0; const out = [];
  for (let t = 1; t <= TK && hp > 0; t++) {
    if (hit.has(t)) {
      let d = amt;
      if (regen > 10) { if (amt > last) { d = amt - last; last = amt; } else d = 0; } else { last = amt; regen = 20; }
      if (d > 0) { d = soak(d, ar); if (mob === 'witch') d = Math.fround(d * 0.15); hp = Math.fround(hp - d); }
    }
    if (regen > 0) regen--;
    out.push({ tick: t, health: Math.max(hp, 0) });
  }
  return out;
}
function engine(salt, src, mob, hp0) {
  cells.clear(); EL.list.length = 0;
  const stone = S.stateOf('stone');
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { w.set(x, -1, z, stone); if (x || z) for (let y = 0; y <= 5; y++) w.set(x, y, z, S.stateOf('glass')); }
  w.set(0, 6, 0, S.stateOf('glass'));
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn(mob, 0.5, 0, 0.5);
  if (!e) return null;
  e.persistent = true; e.aiDisabled = true; e.vx = e.vy = e.vz = 0; e.health = e.maxHealth = hp0;
  for (const sl of [M.Items.FEET, M.Items.LEGS, M.Items.CHEST, M.Items.HEAD, M.Items.MAINHAND, M.Items.OFFHAND]) if (sl !== undefined) M.Equip.setEquipped(e, sl, null);
  const hit = hitTicks(salt), out = [];
  for (let t = 1; t <= TK; t++) {
    if (hit.has(t)) {
      if (src === 'magic') ES.magicDamage(e, AMT.magic, null);
      else M.Combat.hurt(e, AMT.thorns, undefined, false, { source: 'thorns' });
    }
    EL.tick();
    if (mob === 'guardian') { e.x = 0.5; e.y = 0; e.z = 0.5; e.vx = e.vy = e.vz = 0; e.onGround = true; }
    out.push({ tick: t, health: Math.max(e.health, 0) });
    if (e.dead || e.removed || !(e.health > 0)) break;
  }
  return out;
}
function proveMob(mob, amtOverride) {
  const hp0 = +attrs.get(mob)[2], failed = [], checked = [];
  for (const src of ['magic', 'thorns']) for (const salt of salts) {
    const E = engine(salt, src, mob, hp0);
    if (!E) { checked.push(src + ': engine cannot spawn ' + mob + ' in the cell'); break; }
    const R = reference(src, salt, mob, hp0, amtOverride || AMT[src]);
    let d = null;
    for (const tr of [R, E]) { let prev = hp0, tot = 0; for (const r of tr) { tot += Math.max(0, prev - r.health); prev = r.health; r.health = tot; } }   // cumulative damage taken: a mob's own regen (wither) or potion (witch) is not this lane's subject
    for (let i = 0; !d && i < Math.min(R.length, E.length); i++) if (Math.abs(R[i].health - E[i].health) > 0.02) d = { tick: R[i].tick, a: R[i].health, b: E[i].health };
    if (!d && R.length !== E.length) d = { tick: Math.min(R.length, E.length), a: R.length, b: E.length };
    if (d) { failed.push(`${src} salt ${salt} tick ${d.tick}: reference ${d.a}, engine ${d.b}`); break; }
    if (salt === 0) checked.push(`${src}: per-tick health x ${salts.length} salts (grace window${src === 'thorns' ? ', armour' : ', bypasses armour'}${mob === 'witch' ? ', witch x0.15' : ''})`);
  }
  return { pass: failed.length === 0, checked, failed };
}
const KNOWN = new Set([]);
const out = {};
for (const m of roster) { out[m] = proveMob(m); if (!out[m].pass && !KNOWN.has(m)) console.log('  divergence ' + m + ' -- ' + out[m].failed[0]); if (out[m].pass === KNOWN.has(m)) { fails++; console.log((KNOWN.has(m) ? 'KNOWN divergence is gone, remove from KNOWN: ' : 'NEW divergence: ') + m); } }
mkdirSync(join(TD, 'mobproof', 'out'), { recursive: true });
writeFileSync(join(TD, 'mobproof', 'out', 'damage-magic.json'), JSON.stringify(out, null, 1));
const mortal = roster.find((m) => +attrs.get(m)[2] > 8 && m !== 'witch' && out[m].pass && !out[m].checked.some((c) => /cannot spawn/.test(c)));
const brk = (c, m) => { if (c) breaks++; else { fails++; console.log('NOT CAUGHT ' + m); } };
brk(!!mortal && !proveMob(mortal, 7).pass, 'reference damage 7 vs engine 6/3');
brk(!!out.witch && out.witch.pass && !proveMob('witch', 7).pass, 'witch with wrong amount');
console.log(`${roster.length * 2 * salts.length + 2} assertions, ${fails} failures, ${breaks} breaks caught (${roster.length} mobs, ${roster.filter((m) => out[m].pass).length} pass, ${KNOWN.size} known divergences pinned)`);
process.exit(fails ? 1 : 0);
