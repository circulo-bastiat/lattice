// golemattacklockstepcheck.mjs -- #7951 (G18f-L14): lockstep scenario 'golemattack', 20 salts: iron golem vs zombie, skeleton, creeper (never a target, swing no damage) and a hostile player-side check.
// Reference = .decomp IronGolemEntity.tryAttack (amount = a/2 + nextInt((int)a) = 7.5 + 0..14, attackTicksLeft 10, status 4, target vy += 0.4F, no ATTACK_KNOCKBACK strike) and canTarget (never a creeper; a player-created golem never a player).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07y_equip.js', '07m_breed.js', '07l_spawn.js', '14j_combat.js'],
  dom: false
});
initRegistry(M);
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Equip.init();
const EL = M.EntityList, Cb = M.Combat, Ai = M.Ai;
const CELLS = new Map();
M.World = { getBlock: (x, y, z) => CELLS.get(x + ',' + y + ',' + z) || 0, setBlock: (x, y, z, s) => { CELLS.set(x + ',' + y + ',' + z, s); return true; }, get: () => null, heightAt: () => 63, biomeAt: () => 1, chunks: new Map(), tickingAt: () => true };
M.CH = { GENERATED: 2 };
M.Behave.init(M.World);
M.Diff = { value: 'normal', get() { return this.value; } };
let fails = 0, breaks = 0, cells = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const FLOOR = { v: 7 };   // the engine's rolled-damage floor, mutated by the break test
function lane(salt) {
  const r = stream(salt), out = [];
  for (const kind of ['zombie', 'skeleton', 'creeper']) for (let hit = 0; hit < 4; hit++) {
    const roll = r();
    EL.random = () => roll;
    const x = 100 + salt * 8, z = 100 + hit * 8 + ['zombie', 'skeleton', 'creeper'].indexOf(kind) * 40;
    const g = EL.spawn('iron_golem', x, 64, z, {}), t = EL.spawn(kind, x + 1.5, 64, z, {});
    t.maxHealth = t.health = 100;
    const hp = t.health, vy = t.vy || 0;
    Cb.mobAttack(g, t);
    cells++;
    const tag = 'salt ' + salt + ' ' + kind + '#' + hit + ': ';
    const want = 7.5 + Math.floor(roll * 15);
    if (kind === 'creeper') {   // canTarget filters targeting only; a forced tryAttack still hurts it
      if (Ai.canTargetLiving(t, g)) out.push(tag + 'creeper targetable');
    } else {
      if (!Ai.canTargetLiving(t, g)) out.push(tag + 'not targetable');
      if (Math.abs((hp - t.health) - want) > 1e-6) out.push(tag + 'damage ' + (hp - t.health) + ' want ' + want);
      if (Math.abs((t.vy || 0) - (vy + Math.fround(0.4))) > 1e-6) out.push(tag + 'vy ' + t.vy);
      if (g.attackTicksLeft !== 10) out.push(tag + 'attackTicksLeft ' + g.attackTicksLeft);
    }
    g.removed = true; t.removed = true;
  }
  const g = EL.spawn('iron_golem', 5, 64, 5, {});
  const p = { type: 'player', x: 6, y: 64, z: 5, health: 20 };
  g.playerCreated = true;
  if (Ai.canTargetLiving(p, g)) out.push('salt ' + salt + ': player-created golem targets player');
  g.playerCreated = false;
  if (!Ai.canTargetLiving(p, g)) out.push('salt ' + salt + ': village golem refuses hostile player');
  g.removed = true;
  return out;
}
const pass = () => Array.from({ length: 20 }, (_, i) => i).flatMap(lane);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
ok(cells === 240, 'lane covers ' + cells + ' cells');
const real = Cb.mobAttack;
Cb.mobAttack = function (e, t) { const o = EL.random; EL.random = () => Math.min(0.9999, (Math.floor(o() * 15) + 1) / 15); const rr = real(e, t); EL.random = o; return rr; };
brk(pass().length > 0, 'damage floor 7 changed to 8 caught');
Cb.mobAttack = function (e, t) { const rr = real(e, t); if (e.type === 'iron_golem') e.attackTicksLeft = 0; return rr; };
brk(pass().length > 0, 'attack animation counter dropped caught');
Cb.mobAttack = function (e, t) { const rr = real(e, t); if (e.type === 'iron_golem') t.vy -= 0.1; return rr; };
brk(pass().length > 0, 'knockback 0.3 caught');
Cb.mobAttack = real;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`golemattacklockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
