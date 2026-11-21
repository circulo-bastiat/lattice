// arrowstucklockstepcheck.mjs -- #6612 (G17-L86): lockstep scenario 'arrowstuck': arrows embedded in wood / stone, player pickup, a pierce line of cows, crit rolls; 20 salts.
// Reference = .decomp PersistentProjectileEntity: onBlockHit shake = 7; tick() inGround branch `if (shake > 0) --shake`, age() `++life >= 1200` -> discard;
// onPlayerCollision/tryPickup (shake <= 0): ALLOWED gives the item, CREATIVE_ONLY discards only for a creative player (no item), DISALLOWED never;
// onEntityHit pierce: piercedEntities.size() >= pierceLevel+1 discards; crit adds nextInt(damage/2 + 2) capped at Integer.MAX_VALUE.
// Per tick the arrow's [shake, life, removed, item count] go through lockstep/trace.mjs compareTraces.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const M = loadEngine({ extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '02m_jrandom.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init(); M.EntityList.init(); M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, Iv = M.Inventory, W = M.World, CH = M.CH;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i);
const PK = ['allowed', 'creative_only', 'disallowed'], BLOCKS = ['oak_planks', 'stone'], Y = 8, TICKS = 1210;
const params = (s) => ({ pk: PK[s % 3], creative: (s >> 1) % 2 === 1, block: BLOCKS[s % 2], touch: s % 4 === 3 ? 0 : 3 + (s * 5) % 12, never: s % 5 === 4 });
function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  EL.clear();
}
function reference(p) {
  const rows = []; let shake = 7, life = 0, items = 0, gone = false;
  for (let t = 1; t <= TICKS; t++) {
    if (!gone) {
      if (shake > 0) shake--;
      const touching = !p.never && t > p.touch;
      if (touching && shake <= 0) {
        if (p.pk === 'allowed') { items++; gone = true; } else if (p.pk === 'creative_only' && p.creative) gone = true;
      }
      if (!gone) { life++; if (life >= 1200) gone = true; }
    }
    rows.push({ tick: t, goals: [[0, 'shake' + (gone ? 0 : shake)], [1, 'life' + (gone ? 0 : life)], [2, gone ? 'gone' : 'here'], [3, 'items' + items]], pos: [0, 0, 0], vel: [0, 0, 0] });
  }
  return rows;
}
function engine(p) {
  freshWorld();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) W.setBlock(x, Y, z, M.States.stateOf(p.block) | 0);
  const a = EL.spawn('arrow', 0.5, Y + 3, 0.5, { vx: 0, vy: -3, vz: 0, shooter: null });
  a.pickupType = p.pk; a.pickupItem = 'arrow';
  for (let i = 0; i < 20 && !a.stuck; i++) EL.tick();
  ok(a.stuck, 'the arrow embeds in ' + p.block);
  const P = { x: 40, y: Y + 1, z: 40, width: 0.6, height: 1.8, instabuild: p.creative, inventory: Iv.create(), syncHotbar() {} };
  M.Player = P;
  a.shake = 7; a.groundTicks = 0;
  const rows = [];
  for (let t = 1; t <= TICKS; t++) {
    if (!p.never && t === p.touch + 1) { P.x = a.x; P.y = a.y; P.z = a.z; }
    Cb.tickArrow(a);
    const gone = !!a.removed;
    rows.push({ tick: t, goals: [[0, 'shake' + (gone ? 0 : a.shake)], [1, 'life' + (gone ? 0 : a.groundTicks)], [2, gone ? 'gone' : 'here'], [3, 'items' + Iv.countOf(P.inventory, 'arrow')]], pos: [0, 0, 0], vel: [0, 0, 0] });
  }
  M.Player = null;
  return rows;
}
const run = (s) => { const p = params(s); return compareTraces(reference(p), engine(p), { fields: ['goals'] }); };
const res = salts.map((s) => ({ s, d: run(s) }));
ok(res.every((r) => !r.d), 'zero divergences: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
// pierce: a line of 4 cows, arrow with pierceLevel 0..2 stops after level+1 hits
function pierceHits(level) {
  freshWorld();
  for (let x = -3; x <= 12; x++) for (let z = -3; z <= 3; z++) W.setBlock(x, Y, z, M.States.stateOf('stone') | 0);
  const cows = [3, 5, 7, 9].map((x) => { const c = EL.spawn('cow', x + 0.5, Y + 1, 0.5); c.maxHealth = c.health = 1000; return c; });
  const a = EL.spawn('arrow', 0.5, Y + 1.3, 0.5, { vx: 3, vy: 0, vz: 0, shooter: null }); a.pierceLevel = level;
  for (let i = 0; i < 12; i++) EL.tick();
  return cows.filter((c) => c.health < c.maxHealth).length;
}
for (const l of [0, 1, 2]) ok(pierceHits(l) === l + 1, `pierceLevel ${l} hits ${l + 1} cows (got ${pierceHits(l)})`);
// crit: bonus = nextInt(floor(dmg/2) + 2), total capped at Integer.MAX_VALUE
const critOk = () => salts.every((s) => {
  const r = new M.JRandom(s + 1), q = new M.JRandom(s + 1);
  for (let i = 0; i < 40; i++) {
    const dmg = 1 + ((s * 7 + i * 3) % 14), d = q.nextDouble(), want = Math.min(Math.floor(d * (Math.floor(dmg / 2) + 2)) + dmg, 2147483647);
    if (Cb.arrowCritBonus(dmg, () => r.nextDouble()) !== want) return false;
    if (want < dmg || want > dmg + Math.floor(dmg / 2) + 1) return false;
  }
  return Cb.arrowCritBonus(2147483647, () => 0.99) === 2147483647;
});
ok(critOk(), 'crit rolls: dmg + nextInt(dmg/2+2), capped');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
Cb.ARROW_STUCK_TICKS = 1000;
brk(salts.some((s) => run(s)), 'despawn 1200 -> 1000 is reported'); Cb.ARROW_STUCK_TICKS = 1200;
const keep = Cb.PICKUP_ALLOWED, kc = Cb.PICKUP_CREATIVE_ONLY;
Cb.PICKUP_ALLOWED = kc; Cb.PICKUP_CREATIVE_ONLY = keep;
brk(salts.some((s) => run(s)), 'pickup flag allowed <-> creative_only swapped is reported'); Cb.PICKUP_ALLOWED = keep; Cb.PICKUP_CREATIVE_ONLY = kc;
const sk = Cb.ARROW_SHAKE_TICKS; const tp = Cb.tryArrowPickup; Cb.tryArrowPickup = function (e) { e.shake = 0; return tp.call(Cb, e); };
brk(salts.some((s) => run(s)), 'ignoring the shake gate is reported'); Cb.tryArrowPickup = tp;
console.log(`arrowstucklockstepcheck: ${breaks + 4} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
