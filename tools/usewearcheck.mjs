// usewearcheck -- #4188: Use.damage must roll Unbreaking (ItemStack.damage: each point negated when rand(level+1) > 0)
// and play ENTITY_ITEM_BREAK when the tool breaks. Shears/sheep route through it; so does every other tool.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const A = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14f_inventory.js', '14j_combat.js', '14l_use.js'], dom: false });
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(A, 'items.meta.json'), 'utf8')).rawBytes });
M.Sound = M.Sound || {};
const Iv = M.Inventory, shearsId = M.Items.of('shears');

function wear(lvl, n, dmg) {
  let total = 0, sounds = 0;
  const realSound = M.Sound && M.Sound.entitySound;
  if (M.Sound) M.Sound.entitySound = (ev) => { if (ev === 'entity.item.break') sounds++; };
  for (let i = 0; i < n; i++) {
    const st = { i: shearsId, c: 1, d: 0, t: lvl ? { Enchantments: [{ id: 'minecraft:unbreaking', lvl }] } : null };
    const P = { inventory: Iv.create ? Iv.create() : { slots: [] }, slot: 0, instabuild: false, x: 0, y: 0, z: 0 };
    dmg(P, st); total += st.d;
  }
  if (M.Sound) M.Sound.entitySound = realSound;
  return { avg: total / n, sounds };
}
const use = (P, st) => M.Use.damage(P, st, 1);
ok(shearsId != null && M.Items.durability[shearsId] === 238, 'shears have 238 durability');
ok(Math.abs(wear(0, 4000, use).avg - 1) < 1e-9, 'no Unbreaking: 1 wear per use');
ok(Math.abs(wear(3, 20000, use).avg - 0.25) < 0.02, 'Unbreaking III: ~1/4 wear per use');
ok(Math.abs(wear(1, 20000, use).avg - 0.5) < 0.02, 'Unbreaking I: ~1/2 wear per use');
okAv(Math.abs(wear(3, 2000, (P, st) => { st.d += 1; }).avg - 0.25) > 0.5, 'plain stack.d += 1 (old behaviour) fails the Unbreaking III check');
// break sound: a stack one point from breaking, no Unbreaking
{
  let sounds = 0; const real = M.Sound.entitySound; M.Sound.entitySound = (ev) => { if (ev === 'entity.item.break') sounds++; };
  const st = { i: shearsId, c: 1, d: 237, t: null };
  M.Use.damage({ inventory: Iv.create ? Iv.create() : { slots: [] }, slot: 0, instabuild: false, x: 0, y: 0, z: 0 }, st, 1);
  M.Sound.entitySound = real;
  ok(sounds === 1, 'breaking the shears plays entity.item.break');
  sounds = 0; M.Sound.entitySound = (ev) => { if (ev === 'entity.item.break') sounds++; };
  M.Use.damage({ inventory: Iv.create ? Iv.create() : { slots: [] }, slot: 0, instabuild: false, x: 0, y: 0, z: 0 }, { i: shearsId, c: 1, d: 0, t: null }, 1);
  M.Sound.entitySound = real;
  okAv(sounds === 0, 'a use that does not break plays nothing (so the break-sound check can fail)');
}
console.log(`${pass} checks passed, ${fails.length} failed`);
console.log(` breaks caught ...... ${breaks}`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
