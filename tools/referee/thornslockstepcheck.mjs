// thornslockstepcheck.mjs -- #6722 (G17-L126): lockstep scenario 'thorns': zombie / skeleton arrow / cow dummy hit a player in Thorns I/II/III armour; 20 salts.
// Reference = .decomp ThornsEnchantment: shouldApply = random.nextFloat() < 0.15F * level; getDamageAmount = level > 10 ? level - 10 : 1 + random.nextInt(4);
// onUserDamaged: the roll comes FIRST, nextInt(4) only after a hit, armour piece takes damage 2. One shared java.util.Random: each tick the attacker's own
// roll (nextFloat) is drawn first, so the thorns draws must follow it in order. Per tick [rolls, reflected damage, durability, rng state] go through compareTraces.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['07_world.js', '07q_effects.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '02m_jrandom.js'] });
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
const probe = (r) => Object.assign(Object.create(Object.getPrototypeOf(r)), r).nextInt(1000000);
const Iv = M.Inventory, ES = M.Effects, Cb = M.Combat;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i);
const KINDS = ['zombie', 'skeleton_arrow', 'cow'], TICKS = 200, MAXD = 240;
const params = (s) => ({ level: 1 + s % 3, kind: KINDS[s % 3], seed: s * 7919 + 13 });
function reference(p) {
  const r = new M.JRandom(p.seed), rows = []; let dur = 0, broke = false;
  for (let t = 1; t <= TICKS; t++) {
    r.nextFloat();                                   // the attacker's own attack roll
    let trig = 0, dmg = 0;
    if (!broke && r.nextFloat() < 0.15 * p.level) { trig = 1; dmg = p.level > 10 ? p.level - 10 : 1 + r.nextInt(4); dur += 2; if (dur >= MAXD) broke = true; }
    rows.push({ tick: t, goals: [[0, 'roll' + trig], [1, 'dmg' + dmg], [2, 'dur' + (broke ? 'gone' : dur)], [3, 'rng' + probe(r)]], pos: [0, 0, 0], vel: [0, 0, 0] });
  }
  return rows;
}
function engine(p) {
  const r = new M.JRandom(p.seed), rows = [], rng = () => r.nextFloat();
  const inv = Iv.create(), slot = Iv.ARMOR_START + 2;
  inv.slots[slot] = Iv.stack('iron_chestplate', 1, 0, { Enchantments: [{ id: 'minecraft:thorns', lvl: p.level }] });
  const P = { inventory: inv }, atk = { kind: p.kind };
  const hurt = Cb.hurt; let got = 0;
  Cb.hurt = (e, d, a, b, src) => { got = (src && src.source === 'thorns' && e === atk) ? d : -1; return true; };
  for (let t = 1; t <= TICKS; t++) {
    rng();                                           // attacker's own roll
    got = 0;
    const trig = ES.thornsOnUserDamaged(P, atk, rng) ? 1 : 0;
    const st = inv.slots[slot], gone = Iv.isEmpty(st);
    rows.push({ tick: t, goals: [[0, 'roll' + trig], [1, 'dmg' + got], [2, 'dur' + (gone ? 'gone' : st.d)], [3, 'rng' + probe(r)]], pos: [0, 0, 0], vel: [0, 0, 0] });
  }
  Cb.hurt = hurt;
  return rows;
}
const run = (s) => { const p = params(s); return compareTraces(reference(p), engine(p), { fields: ['goals'] }); };
const res = salts.map((s) => ({ s, d: run(s) }));
ok(res.every((r) => !r.d), 'zero divergences: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
ok(ES.thornsDamageAmount(13, () => 0.9) === 3 && ES.thornsDamageAmount(3, () => 0.99) === 4 && ES.thornsDamageAmount(3, () => 0) === 1, 'damage: level>10 ? level-10 : 1+nextInt(4)');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
ES.THORNS_CHANCE_PER_LEVEL = 0.1;
brk(salts.some((s) => run(s)), 'chance 0.15 -> 0.1 is reported'); ES.THORNS_CHANCE_PER_LEVEL = 0.15;
ES.THORNS_ARMOR_DAMAGE = 1;
brk(salts.some((s) => run(s)), 'armour damage 2 -> 1 is reported'); ES.THORNS_ARMOR_DAMAGE = 2;
const td = ES.thornsDamageAmount; ES.thornsDamageAmount = (l, g) => td(l, g) + 1;
brk(salts.some((s) => run(s)), 'reflected damage +1 is reported'); ES.thornsDamageAmount = td;
console.log(`thornslockstepcheck: ${breaks + 2} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
