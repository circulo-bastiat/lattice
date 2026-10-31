// lockstep-attackeffect -- #6862 (G17-L161): on-hit effects by difficulty, 20 salts. Reference = .decomp CaveSpiderEntity.tryAttack (Normal 7 s / Hard 15 s poison, Easy none),
// HuskEntity.tryAttack (140 * (int)localDifficulty hunger, empty hand), WitherSkeletonEntity.tryAttack (wither 200t), StrayEntity.createArrowProjectile (slowness 600t on the arrow).
// Reference = .decomp LivingEntity.applyArmorToDamage (DamageUtil.getDamageLeft: f=2+toughness/4, clamp(armor-dmg/f, armor/5, 20), dmg*(1-g/25)),
// applyEnchantmentsToDamage (protection EPF summed over the 4 pieces, cap 20, dmg*(1-EPF/25)), PlayerInventory.damageArmor (max(1, floor(dmg/4)) per piece),
// blockedByShield (attacker in front) -> damageShield (dmg>=3 costs 1+floor(dmg)) + takeShieldHit (axe: disableShield, 100-tick cooldown), and the
// MeleeAttackGoal cooldown (20 ticks). Trials: leather / iron / diamond+Protection IV, with and without a raised shield, sword and axe zombie.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '14i_hand.js', '14l_use.js', '07w_passive.js', '07d_mining.js', '07e_loot.js'];
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
{ const table = {};
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r(c[6]), r(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table); }


// lockstep-healthboost -- #8763 (G17-L233): Health Boost II (+4*(amp+1) MAX_HEALTH ADDITION, 100 ticks) on pig, zombie, player at health 20 and 7 (and 28 set after applying).
// Reference = .decomp StatusEffects.HEALTH_BOOST: onApplied adds the modifier (health NOT topped up); HealthBoostStatusEffect.onRemoved removes it, then health > maxHealth -> health = maxHealth.
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log("  FAIL " + m); } };
const { EntityList: EL, Combat: Cb, Survival: Sv, Effects: ES } = M;
const grass = M.States.stateOf('grass_block');
for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) w.set(x, -1, z, grass);
M.Sound = { play: () => {} };
function mk(kind) {
  EL.list.length = 0; M.Diff = { get: () => 'normal' };
  if (kind === 'player') { const e = { x: 0.5, y: 0, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, yaw: 0, type: 'player', slot: 0, inventory: { slots: new Array(46).fill(null) } }; Sv.init(e); M.Player = e; return e; }
  M.Player = { x: 0, y: 300, z: 60 }; const e = EL.spawn(kind, 0.5, 0, 0.5); e.persistent = true; e.noAi = true; return e;
}
const hurtIt = (kind, e, amt, t) => { if (kind === 'player') Sv.hurt(e, 'generic', amt); else Cb.hurt(e, amt, 1000 + t, false, { source: 'generic' }); };
// the hurt amount the unboosted entity takes (zombie natural armour etc.): the reference for "hurt amounts"
const dealtOf = (kind, amt) => { const e = mk(kind); e.health = e.maxHealth; hurtIt(kind, e, amt, 0); return e.maxHealth - e.health; };
function trial(kind, h0, amp, hitTick, hit) {
  const dealt = dealtOf(kind, hit), e = mk(kind);
  const base = e.maxHealth; let h = h0 === 7 ? Math.min(7, base) : base; // 20 = full, 7 = low, 28 = full + the 8 boost
  e.health = h;
  ES.addStatusEffect(e, 'health_boost', 100, amp);
  const add = 4 * (amp + 1), bad = [];
  if (h0 === 28) { h = base + 8; e.health = h; }
  for (let t = 0; t <= 104; t++) {
    const wantMax = t < 100 ? base + add : base;
    if (t === hitTick) { hurtIt(kind, e, hit, t); h = Math.max(0, h - dealt); }
    if (h > wantMax) h = wantMax;
    if (e.maxHealth !== wantMax) { bad.push(`tick ${t}: maxHealth ${e.maxHealth} vs ${wantMax}`); break; }
    if (Math.abs(e.health - h) > 1e-6) { bad.push(`tick ${t}: health ${e.health} vs ${h}`); break; }
    if (e.health <= 0) break;
    ES.tick(e);
  }
  return bad.join('; ') || null;
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20 && !bad; s++) for (const kind of ['pig', 'zombie', 'player']) for (const h0 of [20, 7, 28]) {
    const hit = h0 === 7 ? 1 + (s % 3) : 2 + (s % 6), b = trial(kind, h0, 1, 10 + s * 4, hit); n++;
    if (b) { bad = `salt ${s} ${kind} h0=${h0}: ${b}`; break; }
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 180, 'trials ' + base.n);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const H = ES.TYPE_HOOKS.health_boost;
{ const o = H.onApplied; H.onApplied = (e, a) => { e.maxHealth += 2 * (a + 1); }; brk(!!run().bad, '+4 -> +2'); H.onApplied = o; }
{ const o = H.onRemoved; H.onRemoved = (e, a) => { e.maxHealth -= 4 * (a + 1); }; brk(!!run().bad, 'onRemoved clamp removed'); H.onRemoved = o; }
{ const o = H.onApplied; H.onApplied = (e, a) => { o(e, a); e.health = e.maxHealth; }; brk(!!run().bad, 'health topped up on apply'); H.onApplied = o; }
console.log(`lockstep-healthboost: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
