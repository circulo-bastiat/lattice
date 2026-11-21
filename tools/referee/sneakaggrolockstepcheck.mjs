// sneakaggrolockstepcheck.mjs -- #8841 (G17-L249): lockstep scenario 'sneakaggro', 20 salts: a player walks toward a zombie, skeleton and spider from a seeded distance while sneaking / invisible with 0-4 armour pieces / wearing a mob head; per tick the target id, and the first tick the target is set. Reference = .decomp LivingEntity.getAttackDistanceScalingFactor (sneak x0.8; invisible x0.7*max(0.1, armour/4); skeleton+skull, zombie+head, creeper+head x0.5) feeding TargetPredicate.test (dist <= max(follow*scale, 2)), written independently below.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07q_effects.js', '07zf_bat.js'];
const M = loadEngine({ extra: EXTRA, dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.EntityList.init(); M.Ai.init();
const { EntityList: EL, Ai, Items: It, Inventory: Iv, Effects: Fx } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const ARMOUR = ['iron_boots', 'iron_leggings', 'iron_chestplate', 'iron_helmet'];
const HEADS = ['iron_helmet', 'zombie_head', 'skeleton_skull', 'creeper_head', 'carved_pumpkin'];
const MOBS = ['zombie', 'skeleton', 'spider'];
const FOLLOW = { zombie: 35, skeleton: 16, spider: 16 };
function refScale(mob, st) {
  let d = 1;
  if (st.sneak) d *= 0.8;
  if (st.invis) { let f = st.worn / 4; if (f < 0.1) f = 0.1; d *= 0.7 * f; }
  const h = st.head;
  if ((mob === 'skeleton' && h === 'skeleton_skull') || (mob === 'zombie' && h === 'zombie_head') || (mob === 'creeper' && h === 'creeper_head')) d *= 0.5;
  return d;
}
function mkPlayer(st) {
  const slots = new Array(41).fill(null);
  const pieces = st.slots;   // item names (or null) feet..head
  pieces.forEach((n, i) => { if (n) slots[Iv.ARMOR_START + i] = { i: It.of(n), n: 1 }; });
  const P = { type: 'player', x: 0, y: 0, z: 0, width: 0.6, height: 1.8, crouching: st.sneak, inventory: { slots }, effects: [], activeEffects: {} };
  return P;
}
function lane(salt, mob) {
  const r = stream(salt * 7 + MOBS.indexOf(mob));
  const worn = Math.floor(r() * 5);
  const slots = [0, 1, 2, 3].map((i) => (i < worn ? ARMOUR[i] : null));
  const head = r() < 0.5 ? HEADS[Math.floor(r() * HEADS.length)] : null;
  if (head) slots[3] = head;
  const wornN = slots.filter(Boolean).length;
  const st = { sneak: r() < 0.5, invis: r() < 0.6, worn: wornN, head: slots[3], slots };
  if (!st.sneak && !st.invis && !(head)) st.sneak = true;
  const P = mkPlayer(st);
  M.Player = P;
  if (st.invis) Fx.addStatusEffect(P, 'invisibility', 2000, 0, false, true);
  EL.list.length = 0;
  const e = EL.spawn(mob, 0, 5, 0); e.persistent = true; e.followRange = FOLLOW[mob]; e.followBonus = 0; e.x = 0; e.y = 5; e.z = 0;
  const fr = FOLLOW[mob], sc = refScale(mob, st), range = Math.max(fr * sc, 2);
  const goal = new Ai.NearestAttackableTargetGoal(e, () => [P], { sight: false });
  const start = Math.max(range, fr * 0.5) + 1 + r() * 2.5;
  const step = 0.1;
  let got = -1, ref = -1;
  for (let t = 0; t < 600; t++) {
    const dist = start - step * t;
    P.x = dist; P.y = 5; P.z = 0;
    e.target = null;
    if (ref < 0 && Math.hypot(P.x - e.x, P.y - e.y, P.z - e.z) <= range) ref = t;
    if (goal.canUse() && got < 0) got = t;
    if (got >= 0 || t > 590) break;
  }
  if (got !== ref) return `salt ${salt} ${mob} ${JSON.stringify({ sneak: st.sneak, invis: st.invis, worn: wornN, head: st.head })} first target tick engine ${got} ref ${ref}`;
  return null;
}
const pass = () => { const out = []; for (let s = 0; s < 20; s++) for (const m of MOBS) { const v = lane(s, m); if (v) out.push(v); } return out; };
const base = pass();
ok(base.length === 0, 'lane: ' + base.length + ' divergences ' + base.slice(0, 2).join(' | '));
const bs = M.Bat.attackScale;
M.Bat.attackScale = (P, o) => { const c = P.crouching; P.crouching = false; const v = bs(P, o); P.crouching = c; return v; };
brk(pass().length > 0, 'sneak factor 1 caught'); M.Bat.attackScale = bs;
M.Bat.attackScale = (P, o) => { const v = bs(P, o); return Fx.hasStatusEffect(P, 'invisibility') ? v / Math.max(0.1, P.inventory.slots.slice(36, 40).filter(Boolean).length / 4) * 0.5 : v; };
brk(pass().length > 0, 'invisible ignores armour caught'); M.Bat.attackScale = bs;
M.Bat.attackScale = (P, o) => bs(P, null);
brk(pass().length > 0, 'head factor missing caught'); M.Bat.attackScale = bs;
ok(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`sneakaggrolockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
