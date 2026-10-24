// mending-lockstep -- #8838 (G17-L246): lockstep scenario 'mending': orb pickup repairs a random damaged Mending item, 20 salts.
// Reference = .decomp ExperienceOrbEntity.onPlayerCollision/repairPlayerGears (:211-241) + EnchantmentHelper.chooseEquipmentWith (:262-277):
// candidates in EnumMap slot order (MAINHAND, OFFHAND, FEET, LEGS, CHEST, HEAD) that are non-empty, level>0, damaged; one is picked with the entity's random;
// repair = min(2*orbAmount, damage); xp -= repair/2; recurse while xp>0 (orbAmount stays the ORB's); the remainder goes to addExperience.
// Per tick: durability per slot, xp total/level, live orb count, through lockstep/trace.mjs compareTraces.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07d_mining.js', '07e_loot.js',
  '07i_entitylist.js', '07y_equip.js', '07m_breed.js', '07w_passive.js', '07zd_slime.js', '14d_survival.js', '14j_combat.js', '07ox_enchhelper.js', '07p_trade.js', '07zz_xporb.js'], dom: false, initReg: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
M.Physics.shapeAt = (x, y) => (y < 64 ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < 64;
M.EntityList.init(); M.Equip.init(); M.Breed.init(); M.Passive.init(); M.Xp.init();
const { EntityList: EL, Xp, Inventory: Iv } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const MEND = { Enchantments: [{ id: 'minecraft:mending', lvl: 1 }] }, PLAIN = { Enchantments: [{ id: 'minecraft:unbreaking', lvl: 3 }] };
const SLOTS = [0, Iv.OFFHAND, Iv.ARMOR_START, Iv.ARMOR_START + 1, Iv.ARMOR_START + 2, Iv.ARMOR_START + 3];   // EnumMap order: mainhand, offhand, feet, legs, chest, head
const ITEMS = ['iron_pickaxe', 'iron_sword', 'iron_boots', 'iron_leggings', 'iron_chestplate', 'iron_helmet'];
const ORBS = [1, 3, 17, 37, 1, 3, 17, 37];
function need(n) { let l = 0, t = 0; for (;;) { const c = l >= 30 ? 112 + (l - 30) * 9 : l >= 15 ? 37 + (l - 15) * 5 : 7 + l * 2; if (t + c > n) return [l, n - t]; t += c; l++; } }
function scenario(salt) {
  const r = stream(salt), pick = stream(salt + 1000), enginePick = stream(salt + 1000);   // the entity random: the engine and the reference draw the same sequence
  M.wrand = enginePick; EL.random = enginePick; Math.random = enginePick;
  EL.list.length = 0;
  const BASE = 1200 + salt * 50;
  const P = { x: BASE, y: 70, z: BASE, width: 0.6, height: 1.8, dead: false, PICKUP_INFLATE: [1.0, 0.5, 1.0], slot: 0 };
  M.Survival.init(P); M.Player = P; P.inventory = Iv.create();
  const ref = SLOTS.map((s, i) => {
    const mend = r() < 0.7, d = r() < 0.2 ? 0 : 1 + Math.floor(r() * 60);
    Iv.setItem(P.inventory, s, Iv.stack(ITEMS[i], 1, d, mend ? MEND : PLAIN));
    return { mend, d };
  });
  let xp = 0;
  const E = [], X = [];
  for (let t = 1; t <= ORBS.length * 3; t++) {
    if (t % 3 === 1) {   // an orb on the player each third tick; the 2-tick pickup delay lets every one through
      const v = ORBS[(t - 1) / 3];
      const orb = EL.spawn('experience_orb', BASE, 70, BASE); orb.value = v; orb.pickingCount = 1; orb.orbAge = 0;
      orb.vx = orb.vy = orb.vz = 0;
      // reference
      let left = v;
      for (;;) {
        const c = ref.filter((q) => q.mend && q.d > 0);
        if (!c.length) break;
        const q = c[Math.floor(pick() * c.length)], fix = Math.min(v * 2, q.d);
        q.d -= fix; left -= fix >> 1;
        if (left <= 0) { left = 0; break; }
      }
      xp += left;
    }
    Xp.pickupTick();
    const live = EL.list.filter((e) => e.type === 'experience_orb' && !e.removed).length;
    const [lv] = need(xp);
    E.push({ tick: t, dur: SLOTS.map((s) => Iv.getItem(P.inventory, s).d), xp: P.xpTotal | 0, lvl: P.xpLevel | 0, orbs: live });
    X.push({ tick: t, dur: ref.map((q) => q.d), xp, lvl: lv, orbs: 0 });
  }
  return { E, X };
}
const diff = (s) => compareTraces(s.X, s.E, { fields: ['dur', 'xp', 'lvl', 'orbs'] });
for (let salt = 0; salt < 20; salt++) {
  const s = scenario(salt), d = diff(s);
  ok(!d, 'salt ' + salt + (d ? ` tick ${d.tick} ${d.field} ${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}` : ''));
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const anyDiv = () => { let n = 0; for (let s = 0; s < 20; s++) if (diff(scenario(s))) n++; return n; };
const orig = Xp.repairPlayerGears;
Xp.repairPlayerGears = function (P, xp, amt) { return orig(P, xp, amt * 0.5 | 0 || 1); };
brk(anyDiv() > 0, 'repair ratio 2 -> 1 durability per xp');
Xp.repairPlayerGears = function (P, xp, amt) {   // reversed slot pick order
  const inv = P.inventory; let left = xp;
  while (left > 0) {
    let it = null;
    for (let i = SLOTS.length - 1; i >= 0; i--) { const s = Iv.getItem(inv, SLOTS[i]); if (!Iv.isEmpty(s) && s.d > 0 && M.Combat.enchantLevel(s, 'mending') > 0) { it = s; break; } }
    if (!it) return left;
    const fix = Math.min(amt * 2, it.d); it.d -= fix; left -= fix >> 1;
  }
  return 0;
};
brk(anyDiv() > 0, 'wrong slot pick order (last candidate instead of random)');
Xp.repairPlayerGears = function (P, xp, amt) { orig(P, xp, amt); return 0; };
brk(anyDiv() > 0, 'leftover xp dropped instead of going to the bar');
Xp.repairPlayerGears = orig;
console.log(`mending-lockstep: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
