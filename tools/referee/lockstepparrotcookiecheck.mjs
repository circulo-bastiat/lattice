// lockstep-parrotcookie -- #6945 (G17-L205): 20 salts, wild parrot + scripted player with seeds and a cookie.
// Reference = .decomp ParrotEntity.interactMob: seed -> (silent? no sound) nextInt(10)==0 tames (owner=player); cookie -> POISON 900 then damage(Float.MAX_VALUE);
// PlayerEntity.tickMovement drop: shoulders dropped (after 20 ticks) on fall>0.5 / water. Engine and reference draw the same stream; compared per attempt.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07k_goals.js', '07t_fly.js'], dom: false });
const Fl = M.Fl || M.Flight || Object.values(M).find((v) => v && v.feed && v.mountOnto);
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 777) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const SEEDS = ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'];
let effects = [], hits = [], spawned = [];
M.Effects = { ready: true, addStatusEffect: (e, id, d, a) => effects.push([id, d, a]) };
M.Combat = { hurt: (e, dmg) => { hits.push(dmg); e.dead = true; } };
M.EntityList = { remove: (e) => { e.removed = true; }, spawn: (t, x, y, z, o) => spawned.push([t, x, y, z, o]) };
M.MobNbt = { fieldsFor: () => ['tamed', 'owner', 'variant'] };
function lane(salt) {
  effects = []; hits = []; spawned = [];
  const re = stream(salt), rr = stream(salt), p = { x: 0, y: 64, z: 0, onGround: true, inWater: false, fallDistance: 0 };
  const e = { type: 'parrot', x: 1, y: 64, z: 1, variant: salt % 5, silent: true };
  let tamedAt = -1;
  for (let i = 0; i < 40 && !e.tamed; i++) {
    const r = Fl.feed(e, SEEDS[(salt + i) % 4], { random: re });
    const ref = Math.floor(rr() * 10) === 0;
    if (!r || !r.consumed) return `feed ${i} not consumed`;
    if (!!e.tamed !== ref) return `attempt ${i}: tamed ${!!e.tamed} vs ${ref}`;
    if (ref && e.owner !== 'player') return 'owner not set';
    if (ref) tamedAt = i;
  }
  if (tamedAt < 0) return null;
  if (!Fl.mountOnto(e, p) || !e.removed || !p.shoulderLeft || p.shoulderLeft.type !== 'parrot' || p.shoulderLeft.tamed !== true || p.shoulderLeft.owner !== 'player' || p.shoulderLeft.variant !== salt % 5) return 'shoulder NBT wrong';
  for (let t = 1; t <= 25; t++) {
    Fl.tickShoulders(p);
    if (t === 10) { p.fallDistance = 2; Fl.tickShoulders(p); p.fallDistance = 0; if (!p.shoulderLeft) return 'dropped inside the 20-tick grace'; }
  }
  p.fallDistance = 0; p.inWater = true; Fl.tickShoulders(p);
  if (p.shoulderLeft || spawned.length !== 1 || spawned[0][4].owner !== 'player') return 'no drop in water';
  const c = { type: 'parrot', tamed: true, owner: 'player' };
  const r = Fl.feedCookie(c, 'cookie', { now: 0 });
  if (!r || !r.killed || !c.dead) return 'cookie did not kill';
  if (effects.length !== 1 || effects[0][0] !== 'poison' || effects[0][1] !== 900) return 'poison missing';
  if (hits[0] !== 3.4028235e38) return 'hit not Float.MAX_VALUE';
  return null;
}
const run = () => { let bad = null; for (let s = 0; s < 20 && !bad; s++) { const r = lane(s); if (r) bad = `salt ${s}: ${r}`; } return bad; };
let b = run(); ok(!b, b);
let tamedN = 0; for (let s = 0; s < 20; s++) { const r = stream(s); for (let i = 0; i < 40; i++) if (Math.floor(r() * 10) === 0) { tamedN++; break; } }
ok(tamedN > 10, `salts exercise taming (${tamedN})`);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const d = Fl.TAME_CHANCE_DENOM; Fl.TAME_CHANCE_DENOM = 4; brk(!!run(), 'taming roll 1-in-10 -> 1-in-4'); Fl.TAME_CHANCE_DENOM = d;
const fc = M.Effects.addStatusEffect; M.Effects.addStatusEffect = () => {}; brk(!!run(), 'cookie poison removed'); M.Effects.addStatusEffect = fc;
const dm = Fl.COOKIE_DAMAGE; Fl.COOKIE_DAMAGE = 1; brk(!!run(), 'cookie damage not lethal'); Fl.COOKIE_DAMAGE = dm;
console.log(`lockstep-parrotcookie: 24 assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
