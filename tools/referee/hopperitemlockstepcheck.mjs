// hopperitemlockstepcheck.mjs -- #6792 (G17-L142): lockstep scenario 'hopperitem': item entities dropped on / beside a hopper, a chest above it, and a hopper-to-hopper tick order.
// Reference = .decomp HopperBlockEntity: serverTick (cooldown-- ; lastTickTime ; if !needsCooldown -> cooldown=0, insertAndExtract), insertAndExtract (insert if non-empty, `|=` extract if not full,
// success -> setTransferCooldown(8)), extract(World,Hopper) (container above wins; else getInputItemEntities: INSIDE box (2..14, 11..16 /16) then ABOVE box (0..16, y 1..2), first that transfers wins),
// extract(Inventory,ItemEntity) (transfer whole stack, discard when empty else setStack remainder), transfer(slot) (empty slot -> place; same item -> merge up to max; an EMPTY hopper that received
// an item gets cooldown 8 - (target.lastTickTime >= source.lastTickTime ? 1 : 0) when the source is a hopper), pickupDelay NOT consulted. Compared per tick over 20 salts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07zzq_brewing.js', '02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js', '14g_menu.js', '07_world.js', '07b_behaviour.js',
  '07c_blockentity.js', '07zy_composter.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zzr_minecart.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
const Inv = M.Inventory, BE = M.BlockEntities, W = M.World, B = M.Behave, S = M.States, CH = M.CH;
B.init(W); BE.init(); M.Entities.init();
function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  BE.clear();
}
function hopperAt(x, y, z) { W.setBlock(x, y, z, B.setProp(S.stateOf('hopper') | 0, 'facing', 'down')); return BE.get(x, y, z) || BE.create(x, y, z, 'hopper'); }
function lcg(seed) { let s = (seed * 2654435761) >>> 0; return (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) % n; }; }
const MAX = { cobblestone: 64, ender_pearl: 16, stick: 64 };
const NAMES = Object.keys(MAX);

// ---- vanilla reference model ----
function refTransfer(slots, name, n) {   // returns remaining; mutates slots [{name,n}|null]
  let moved = false;
  for (let i = 0; i < 5 && n > 0; i++) {
    if (!slots[i]) { const m = Math.min(n, MAX[name]); slots[i] = { name, n: m }; n -= m; moved = true; }
    else if (slots[i].name === name) { const m = Math.min(n, MAX[name] - slots[i].n); slots[i].n += m; n -= m; if (m > 0) moved = true; }
  }
  return n;
}
class Ref {
  constructor(slots, ents, chest) { this.slots = slots; this.ents = ents; this.cd = 0; this.chest = chest; }
  inBox(e, k) {
    const x0 = e.x - 0.125, x1 = e.x + 0.125, z0 = e.z - 0.125, z1 = e.z + 0.125, y0 = e.y, y1 = e.y + 0.25;
    if (k === 0) return x1 > 0.125 && x0 < 0.875 && z1 > 0.125 && z0 < 0.875 && y1 > 4 + 11 / 16 && y0 < 5;
    return x1 > 0 && x0 < 1 && z1 > 0 && z0 < 1 && y1 > 5 && y0 < 6;
  }
  tick() {
    this.cd--; if (this.cd > 0) return; this.cd = 0;
    if (this.slots.every((s) => !s)) { /* nothing to eject: the hopper faces air */ }
    if (this.slots.every((s) => s && s.n >= MAX[s.name])) return;
    let moved = false;
    if (this.chest) {
      for (let i = 0; i < this.chest.length && !moved; i++) {
        const c = this.chest[i]; if (!c) continue;
        if (refTransfer(this.slots, c.name, 1) === 0) { c.n--; if (c.n <= 0) this.chest[i] = null; moved = true; }
      }
    } else {
      for (const k of [0, 1]) {
        for (const e of this.ents) {
          if (e.removed || !this.inBox(e, k)) continue;
          const left = refTransfer(this.slots, e.item, e.count);
          if (left === 0) { e.removed = true; moved = true; } else if (left < e.count) { e.count = left; }
          if (left === 0) break;
        }
        if (moved) break;
      }
    }
    if (moved) this.cd = 8;
  }
}
// NOTE vanilla `extract(Inventory,ItemEntity)` reports success only when the entity is emptied; a partial merge shrinks it and the loop goes on to the next entity.

const snapE = (ents) => ents.map((e) => e.removed ? 'x' : e.count).join(',');
const snapS = (slots) => slots.map((s) => (s ? s.name + '*' + s.n : '-')).join(' ');
const engSlots = (h) => h.items.slice(0, 5).map((s) => (Inv.isEmpty(s) ? null : { name: M.Items.nameOf(s.i), n: s.n }));

function lane(seed, withChest, cdOverride) {
  freshWorld();
  const R = lcg(seed), h = hopperAt(0, 4, 0);
  const slots = [null, null, null, null, null];
  for (let i = 0; i < 5; i++) if (R(3) === 0) { const nm = NAMES[R(3)]; slots[i] = { name: nm, n: 1 + R(MAX[nm]) }; }
  const ents = [];
  // one input box per salt (the union shape's box order is not checkable without the JVM): odd = INSIDE-only heights, even = ABOVE-only heights; some land outside both
  const yPick = () => (R(4) === 0 ? 4.0 + R(30) / 100 : (seed % 2 ? 4.46 + R(29) / 100 : 5.0 + R(95) / 100));
  for (let k = 0, c = 3 + R(5); k < c; k++) {
    const nm = NAMES[R(3)];
    ents.push({ type: 'item', item: nm, count: 1 + R(MAX[nm] + 8 > 64 ? 64 : MAX[nm] + 8), x: -0.4 + R(180) / 100, y: yPick(), z: -0.4 + R(180) / 100, width: 0.25, height: 0.25 });
  }
  const chest = withChest ? [null, null, null].map(() => (R(2) ? { name: NAMES[R(3)], n: 1 + R(4) } : null)) : null;
  const ref = new Ref(slots.map((s) => s && { ...s }), ents.map((e) => ({ ...e })), chest && chest.map((c) => c && { ...c }));
  for (let i = 0; i < 5; i++) h.items[i] = slots[i] ? Inv.stack(slots[i].name, slots[i].n) : null;
  const eents = ents.map((e) => ({ ...e }));
  M.EntityList = { list: eents, remove(x) { x.removed = true; }, random: Math.random };
  if (withChest) {
    W.setBlock(0, 5, 0, S.stateOf('chest') | 0);
    const c = BE.get(0, 5, 0) || BE.create(0, 5, 0, 'chest');
    for (let i = 0; i < 27; i++) c.items[i] = (chest[i] ? Inv.stack(chest[i].name, chest[i].n) : null);
  }
  h.cooldown = 0;
  for (let t = 0; t < 48; t++) {
    ref.tick(); BE.tickNo = (BE.tickNo || 0) + 1; BE.tickHopper(h);
    const a = snapS(ref.slots) + ' cd' + ref.cd + ' [' + snapE(ref.ents) + ']';
    const b = snapS(engSlots(h)) + ' cd' + (h.cooldown | 0) + ' [' + snapE(eents) + ']';
    if (a !== b) return `tick ${t}: ref ${a} | eng ${b}`;
  }
  return null;
}
// hopper above hopper: the tick-order cooldown (7 when the receiver ticked no earlier than the giver)
function orderLane(seed) {
  freshWorld();
  const A = hopperAt(0, 5, 0), Bh = hopperAt(0, 4, 0);
  M.EntityList = { list: [], remove() {}, random: Math.random };
  const n = 1 + (seed % 5);
  A.items[0] = Inv.stack('cobblestone', n); A.cooldown = 0; Bh.cooldown = 3;   // B on cooldown, so it cannot pull from A itself
  const bFirst = seed % 2 === 0;
  BE.tickNo = 100; A.lastTick = 99; Bh.lastTick = 99;
  // vanilla transfer(): B empty, receives from hopper A: cooldown 8 - (B.lastTickTime >= A.lastTickTime ? 1 : 0), read straight after A's tick
  if (bFirst) { BE.tickHopper(Bh); BE.tickHopper(A); } else { BE.tickHopper(A); }
  const want = bFirst ? 7 : 8;   // B first: B.lastTick(100) >= A.lastTick(100) -> 7; A first: B.lastTick(99) < 100 -> 8
  return (Bh.cooldown | 0) === want ? null : `B cooldown ${Bh.cooldown} want ${want} (bFirst ${bFirst})`;
}
let fails = 0, breaks = 0, asserts = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i + 1);
function all() { const bad = []; for (const s of salts) { for (const c of [false, true]) { const d = lane(s, c); if (d) bad.push(`salt ${s} chest ${c}: ${d}`); } const o = orderLane(s); if (o) bad.push(`salt ${s} order: ${o}`); } return bad; }
const bad = all();
ok(!bad.length, 'lockstep vs reference: ' + bad.slice(0, 3).join(' | '));
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const cd0 = BE.HOPPER_COOLDOWN;
BE.HOPPER_COOLDOWN = 7; brk(all().length > 0, 'transfer cooldown 8 -> 7'); BE.HOPPER_COOLDOWN = cd0;
const arm = BE.hopperArm; BE.hopperArm = () => {}; brk(all().length > 0, 'hopperArm (cooldown after an insert into an empty hopper) removed'); BE.hopperArm = arm;
const ex = Inv.maxStackSize; Inv.maxStackSize = () => 64; brk(all().length > 0, 'ender_pearl stack limit 16 -> 64'); Inv.maxStackSize = ex;
console.log(`hopperitemlockstepcheck: ${asserts + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
