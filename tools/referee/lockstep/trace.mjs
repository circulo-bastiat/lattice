// trace.mjs -- #4987 (G17-L1): ONE per-tick trace schema for lockstep (#4984), two emitters, one comparator.
//   row  = { tick, <FIELD>: value ... }   a trace = array of rows, one per tick
//   serverRow(tick, snbt)  : real 1.18.2 server (`data get entity` parsed by snbt.mjs) -> row
//   engineRow(tick, e)     : MC-Lite entity (headless harness, RNG fed the pinned sequence) -> row
//   compareTraces(a, b, o) : FIRST divergent tick + field; doubles compared bit-for-bit unless FIELDS[f].tol is set
// Missing fields (null) on EITHER side are skipped, so a lane can compare only what both emitters know.
export const FIELDS = {
  pos: { n: 3 }, vel: { n: 3 }, yaw: {}, bodyYaw: {}, headYaw: {}, onGround: {}, health: {}, air: {}, fireTicks: {}, frozen: {},
  goals: {},      // [[priority, name], ...] running goals
  path: {},       // [[x,y,z], ...] path nodes
  target: {},     // uuid / id string or null
  attributes: {}, // { name: value } BASE values
  attributesEff: {}, // { name: value } EFFECTIVE (EntityAttributeInstance.getValue: base + modifiers: baby, sprint, effects)
  effects: {},    // [[id, amplifier, duration], ...] active status effects sorted by id
  hurtTime: {}, invulnerableTime: {}, lastDamage: {}, // damage-gate timing: HurtTime NBT, timeUntilRegen (agent log), lastDamageTaken
  rng: {},        // "seed,seed,.." 48-bit java.util.Random.seed of the entity's randoms (entity, navigation, look control) after the tick
  fallDistance: {}, // Entity.fallDistance (float; Entity.fall: -dy while airborne, 0 on ground / in water)
  fluid: {},      // [touchingWater, submergedInWater, inLava]
  held: {}, armour: {},   // item ids
  drops: {},      // [[id, count], ...]
  sounds: {},     // [[id, volume, pitch], ...] this tick
  particles: {},  // [[id, count], ...] this tick
  vehicle: {},    // #6264: uuid of the entity ridden, or null
  passengers: {}, // #6264: [uuid] in passenger-list order (d.Passengers)
  seat: {},       // #6264: rider y minus vehicle y (getMountedHeightOffset + getHeightOffset); server: x.seat from the agent
  entities: {},   // #6291: every NON-subject entity [[type, x, y, z, vx, vy, vz], ...] in spawn order (arrows, orbs, items, babies)
  sheared: {},    // #6301: SheepEntity.isSheared
  blocks: {},     // #6293: world changes this tick [[x, y, z, oldState, newState], ...] sorted; states are registry "name[prop=v,..]" strings, not raw ids
};
const num = (v) => (v == null ? null : typeof v === 'number' ? v : Number(String(v).replace(/[a-z]$/i, '')));
const nums = (a) => (Array.isArray(a) ? a.map(num) : null);
// Server particle log line (SeedAgent, ServerWorld.spawnParticles / ParticleS2CPacket): "<id>:<count>,<id>:<count>" per tick.
// Same shape as the engine's Px.tally object. Both become [[id,count],...] sorted by id; an empty tick is [].
export function particlesOf(x) {
  const m = typeof x === 'string' ? x.split(',').filter(Boolean).map((t) => { const i = t.lastIndexOf(':'); return [t.slice(0, i).replace('minecraft:', ''), Number(t.slice(i + 1))]; })
    : x ? Object.entries(x) : null;
  if (!m) return null;
  const acc = {}; for (const [k, c] of m) acc[k] = (acc[k] || 0) + c;
  return Object.keys(acc).sort().map((k) => [k, acc[k]]);
}
// Agent log line per server-side playSound: `SND <tick> <id> <volume> <pitch>` (floats as Java prints them). -> { tick: [[id, vol, pitch]] }
export function parseSoundLog(text) {
  const out = {};
  for (const ln of String(text).split('\n')) {
    const m = /^SND (\d+) (\S+) (\S+) (\S+)$/.exec(ln.trim()); if (!m) continue;
    (out[+m[1]] = out[+m[1]] || []).push([m[2].replace('minecraft:', ''), Number(m[3]), Number(m[4])]);
  }
  return out;
}
// Agent log line per tick: `TGT <tick> <uuid|none>` (MobEntity.getTarget()). -> { tick: uuid|null }
export function parseTargetLog(text) {
  const out = {};
  for (const ln of String(text).split('\n')) {
    const m = /^TGT (\d+) (\S+)$/.exec(ln.trim()); if (m) out[+m[1]] = m[2] === 'none' ? null : m[2];
  }
  return out;
}

// drops: ItemEntity snbt list (`data get entity` on item entities near the corpse, or the agent's dropStack hook) or
// engine [[id,count]] pairs -> canonical [[id,count],...] merged per id and sorted, so spawn order never matters.
export function normDrops(list) {
  if (!list) return null;
  const m = new Map();
  for (const x of list) {
    const [id, c] = Array.isArray(x) ? x : [x.Item ? x.Item.id : x.id, x.Item ? x.Item.Count : x.Count];
    const k = String(id).replace(/^minecraft:/, '');
    m.set(k, (m.get(k) || 0) + num(c));
  }
  return [...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
// PathNodes: the agent's per-tick dump of EntityNavigation.getCurrentPath() nodes (Path.getNode(i) x,y,z), as [{x,y,z}] or [[x,y,z]]; absent = no path logged
export function serverPath(p) {
  if (!Array.isArray(p)) return null;
  return p.map((n) => (Array.isArray(n) ? n.map(num) : [num(n.x), num(n.y), num(n.z)]));
}
// goals: the goal agent's per-tick log of GoalSelector.getRunningGoals, as [[priority, name]] or "p:name,p:name" (sorted by priority, name).
export function parseGoals(g) {
  if (g == null) return null;
  const a = typeof g === 'string' ? (g === '' ? [] : g.split(',').map((x) => x.split(':'))) : g.map((x) => (Array.isArray(x) ? x : String(x).split(':')));
  return a.map(([p, n]) => [Number(p), String(n)]).sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
}
// body/head yaw: `data get` exposes only Rotation, so the capture agent passes yBodyRot/yHeadRot in `x`
// (x.bodyYaw / x.headYaw, from the server's LivingEntity fields or the EntityHeadRotationS2CPacket); absent -> null.
// EntityAttributeInstance.computeValue: (base + sum ADDITION[0]) * (1 + sum MULTIPLY_BASE[1]) * prod (1 + MULTIPLY_TOTAL[2]); Modifiers = [{Name,Amount,Operation}]
export function effectiveValue(base, mods) {
  let add = 0, mb = 0, mt = 1;
  for (const m of mods || []) { const o = num(m.Operation), v = num(m.Amount); if (o === 0) add += v; else if (o === 1) mb += v; else mt *= 1 + v; }
  const b = base + add; return b * (1 + mb) * mt;
}
// Agent log line per tick per entity: `RNG <tick> <seed>[,<seed>..]` (java.util.Random.seed via reflection, decimal). -> { tick: 'seed,seed' }
export function parseRngLog(text) {
  const out = {};
  for (const ln of String(text).split('\n')) { const m = /^RNG (\d+) (\d+(?:,\d+)*)$/.exec(ln.trim()); if (m) out[+m[1]] = m[2]; }
  return out;
}
// MC-Lite NS.JRandom keeps the 48-bit seed as sh*2^24+sl; the JDK's seed field is the same number.
export function rngSeed(r) { return r ? (BigInt(r.sh) * 16777216n + BigInt(r.sl)).toString() : null; }
// Agent log line per entity per tick, walking ServerWorld.iterateEntities (entitiesByUuid / spawn order), subject excluded:
//   `ENT <tick> <type> <x> <y> <z> <vx> <vy> <vz>` -> { tick: [[type, x, y, z, vx, vy, vz]] }
export function parseEntLog(text) {
  const out = {};
  for (const ln of String(text).split('\n')) {
    const m = /^ENT (\d+) (\S+)((?: \S+){6})$/.exec(ln.trim()); if (!m) continue;
    (out[+m[1]] = out[+m[1]] || []).push([m[2].replace('minecraft:', ''), ...m[3].trim().split(' ').map(Number)]);
  }
  return out;
}
// Agent log line per changed block per tick (Probe diff of the arena snapshot, ServerWorld.setBlockState): `BLK <tick> <x> <y> <z> <old> <new>` -> { tick: [[x,y,z,old,new]] } sorted
const blkSort = (a) => a.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
export function parseBlockLog(text) {
  const out = {};
  for (const ln of String(text).split('\n')) {
    const m = /^BLK (\d+) (-?\d+) (-?\d+) (-?\d+) (\S+) (\S+)$/.exec(ln.trim()); if (!m) continue;
    (out[+m[1]] = out[+m[1]] || []).push([+m[2], +m[3], +m[4], m[5].replace('minecraft:', ''), m[6].replace('minecraft:', '')]);
  }
  for (const k in out) blkSort(out[k]);
  return out;
}
// engine side: diff two snapshots (Map "x,y,z" -> state string, built with World.getBlock mapped through the registry name+properties string)
export function blocksDiff(prev, cur) {
  const out = [], seen = new Set();
  for (const [k, v] of cur) { seen.add(k); const o = prev.has(k) ? prev.get(k) : 'air'; if (o !== v) out.push(k.split(',').map(Number).concat([o, v])); }
  for (const [k, o] of prev) if (!seen.has(k) && o !== 'air') out.push(k.split(',').map(Number).concat([o, 'air']));
  return blkSort(out);
}
// #6358: `ENTX <tick> <type> <id> <conv> <effId:amp:dur,..|->` -> { tick: [[type, id, conv, [[effId, amp, dur]]]] }
export function parseEntxLog(text) {
  const out = {};
  for (const ln of String(text).split('\n')) {
    const m = /^ENTX (\d+) (\S+) (-?\d+) (-?\d+) (\S+)$/.exec(ln.trim()); if (!m) continue;
    const eff = m[5] === '-' ? [] : m[5].split(',').map((f) => f.split(':').map(Number));
    (out[+m[1]] = out[+m[1]] || []).push([m[2].replace('minecraft:', ''), +m[3], +m[4], eff]);
  }
  return out;
}
// engine side: NS.EL.list minus the subject, in list (= spawn) order
export function entitiesOf(list, subject) {
  return list.filter((o) => o !== subject && !o.removed).map((o) => [String(o.type || o.kind || o.name), o.x, o.y, o.z, o.vx || 0, o.vy || 0, o.vz || 0]);
}
export function serverRow(tick, d, x = {}) {
  const att = {}; for (const a of d.Attributes || []) att[String(a.Name).replace('minecraft:', '').replace('generic.', '')] = num(a.Base);
  const eff = {}; for (const a of d.Attributes || []) eff[String(a.Name).replace('minecraft:', '').replace('generic.', '')] = effectiveValue(num(a.Base), a.Modifiers);
  const item = (x) => (x && x.id ? String(x.id) : null);
  return { tick, pos: nums(d.Pos), vel: nums(d.Motion), yaw: num((d.Rotation || [])[0]), bodyYaw: num(x.bodyYaw), headYaw: num(x.headYaw),
    onGround: d.OnGround == null ? null : !!num(d.OnGround), health: num(d.Health), air: num(d.Air), fireTicks: num(d.Fire), frozen: num(d.TicksFrozen),
    fallDistance: num(d.FallDistance), fluid: x.fluid || null,
    goals: parseGoals(d.RunningGoals), path: serverPath(d.PathNodes), target: x.target !== undefined ? (x.target ? String(x.target) : null) : d.AngryAt ? String(d.AngryAt) : null, attributes: d.Attributes ? att : null, attributesEff: d.Attributes ? eff : null,
    hurtTime: num(d.HurtTime), invulnerableTime: num(x.invulnerableTime), lastDamage: num(x.lastDamage),
    rng: x.rng || null, held: d.HandItems ? item(d.HandItems[0]) : null, armour: d.ArmorItems ? d.ArmorItems.map(item) : null,
    effects: d.ActiveEffects ? d.ActiveEffects.map((a) => [num(a.Id), num(a.Amplifier), num(a.Duration)]).sort((p, q) => p[0] - q[0]) : null,
    drops: normDrops(x.drops), sounds: x.sounds || null, particles: particlesOf(x.particles), entities: x.entities || null, blocks: x.blocks || null,
    vehicle: x.vehicle != null ? String(x.vehicle) : null, passengers: Array.isArray(d.Passengers) ? d.Passengers.map((p) => String(p.UUID != null ? p.UUID : p)) : null, seat: x.seat != null ? num(x.seat) : null };
}
// #6254: MC-Lite keeps gear in e.equip[slot] stacks; ev.gear = { Equip, Items } (the loaded engine) maps them to the server's HandItems[0] / ArmorItems ([feet,legs,chest,head]).
export function gearOf(e, gear) {
  if (!gear || !e || !e.equip) return { held: null, armour: null };
  const { Equip, Items } = gear, id = (slot) => { const st = Equip.getEquipped(e, slot); return st ? 'minecraft:' + Items.nameOf(st.i) : null; };
  return { held: id(Items.MAINHAND), armour: [Items.FEET, Items.LEGS, Items.CHEST, Items.HEAD].map(id) };
}
// #6260: ev.effectIds = NS.Effects.IDS (name -> raw id); e.effects = { name: {amplifier, duration} }
export function effectsOf(e, ids) {
  if (!ids || !e) return null;
  return Object.keys(e.effects || {}).filter((n) => n in ids).map((n) => [ids[n], e.effects[n].amplifier, e.effects[n].duration]).sort((p, q) => p[0] - q[0]);
}
export function engineRow(tick, e, ev = {}) {
  const g = gearOf(e, ev.gear);
  const v = (...k) => { for (const n of k) if (e[n] !== undefined) return e[n]; return null; };
  const a3 = (x, y, z) => (x == null ? null : [x, y, z]);
  return { tick, pos: a3(v('x'), v('y'), v('z')), vel: a3(v('vx'), v('vy'), v('vz')), yaw: v('yaw'), bodyYaw: v('yBodyRot', 'bodyYaw'),
    headYaw: v('yHeadRot', 'headYaw'), onGround: v('onGround'), health: v('health', 'hp'), air: v('air', 'squidAir'), fireTicks: v('fireTicks', 'fire'), frozen: v('frozenTicks', 'frozen'),
    fallDistance: v('fallDistance'), fluid: e.inWater === undefined ? null : [!!e.inWater, !!e.eyeInWater, !!e.inLava],
    goals: ev.goals || null, path: ev.path || (e && e.navPath ? e.navPath.map((n) => Array.isArray(n) ? n : [n.x, n.y, n.z]) : null), target: v('target') && v('target').id != null ? String(v('target').id) : null,
    attributes: v('attributes') || null, attributesEff: ev.attributesEff || v('attributesEff') || null, hurtTime: v('hurtTime'), invulnerableTime: v('invulnerableTime'), lastDamage: v('lastHurt', 'lastDamage'), rng: ev.rng || (e.random ? [e.random].concat(e.rngExtra || []).map(rngSeed).join(',') : null), held: g.held !== null ? g.held : v('held'), armour: g.armour || v('armour'), effects: effectsOf(e, ev.effectIds), drops: normDrops(ev.drops), sounds: ev.sounds || null, particles: particlesOf(ev.particles), entities: ev.entities || null, blocks: ev.blocks || null,
    vehicle: e.vehicle ? String(e.vehicle.id) : null, passengers: e.passengers ? e.passengers.map((p) => String(p.id)) : e.passenger ? [String(e.passenger.id)] : [],
    sheared: v('sheared'), seat: e.vehicle && e.y != null ? e.y - e.vehicle.y : null };
}
const bits = (x) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); return b.getBigUint64(0); };
function same(f, a, b, tol) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return tol != null ? Math.abs(a - b) <= tol : bits(a) === bits(b);
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && same(f, a[k], b[k], tol));
  }
  return false;
}
// returns null when equal, else { tick, field, a, b }. opts.tol = { field: epsilon } documents a non-exact field.
export function compareTraces(A, B, opts = {}) {
  const tol = opts.tol || {}, only = opts.fields || Object.keys(FIELDS);
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) for (const f of only) {
    const a = A[i][f], b = B[i][f];
    if (a == null || b == null) continue;
    if (!same(f, a, b, tol[f])) return { tick: A[i].tick, field: f, a, b };
  }
  if (A.length !== B.length) return { tick: n, field: '(length)', a: A.length, b: B.length };
  return null;
}
