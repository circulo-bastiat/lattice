#!/usr/bin/env node
// effectinstcheck.mjs — #293 (G23): StatusEffectInstance exact. `ES.upgrade`'s hidden-effect
// chain, `ES.update`'s resume, the LivingEntity add/set/remove/clear bookkeeping and its
// onStatusEffectApplied/Upgraded/Removed hooks, and the `ActiveEffects` NBT list — against
// .decomp/net/minecraft/entity/effect/StatusEffectInstance.java and LivingEntity.java:675-1003.
// Wiring: milk (Use.drinkFinish -> clearStatusEffects), the player record (P.toJSON/fromJSON),
// the mob records (MobNbt.serializeAll/restoreAll).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) console.log('   ✓ break caught: ' + m); else fails.push('anti-vacuity: ' + m); };
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

console.log('effectinstcheck — #293 (G23), StatusEffectInstance upgrade/update/NBT + LivingEntity effect bookkeeping');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07q_effects.js', '07z_potion.js',
  '07zw_mobnbt.js', '07s_raid.js', '14d_survival.js', '14l_use.js', '14_player.js'], dom: true });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const ES = M.Effects, Iv = M.Inventory, U = M.Use;
ok(ES && typeof ES.upgrade === 'function' && typeof ES.clearStatusEffects === 'function', 'ES.upgrade / clearStatusEffects exist');

const mob = () => ({ health: 20, maxHealth: 20, effects: {} });
const tickN = (e, n) => { for (let i = 0; i < n; i++) ES.tick(e); };

// 1. Strength II 0:22 over Strength I 3:00 — the 3:00 is parked, counts down underneath, resumes.
const strengthTail = () => {
  const e = mob();
  ES.addStatusEffect(e, 'strength', 3600, 0);
  const up = ES.addStatusEffect(e, 'strength', 440, 1);
  const s = e.effects.strength;
  if (!(up && s.amplifier === 1 && s.duration === 440 && s.hiddenEffect && s.hiddenEffect.amplifier === 0 && s.hiddenEffect.duration === 3600)) return false;
  tickN(e, 439);
  if (!(e.effects.strength.amplifier === 1 && e.effects.strength.duration === 1)) return false;
  ES.tick(e);                                              // 440th tick: II hits 0, I (3160 left) resumes
  const r = e.effects.strength;
  return !!r && r.amplifier === 0 && r.duration === 3600 - 440 && r.hiddenEffect === null;
};
ok(strengthTail(), 'Strength II 0:22 over Strength I 3:00 resumes Strength I with 2:38 (3160 ticks) left');

// 2. The resume fires onStatusEffectUpgraded(reapply=true) — absorption shows it: I parked under II.
const absorbResume = () => {
  const e = mob(); e.absorption = 0;
  ES.addStatusEffect(e, 'absorption', 100, 0);            // +4
  if (e.absorption !== 4) return false;
  ES.addStatusEffect(e, 'absorption', 10, 1);             // upgrade: remove(amp1)=-8 -> 0, apply(amp1)=+8
  if (e.absorption !== 8) return false;
  tickN(e, 10);                                            // resume at amp0: remove(amp0) -4, apply(amp0) +4
  return e.effects.absorption.amplifier === 0 && e.absorption === 8;
};
ok(absorbResume(), 'absorption: onApplied +4(amp+1), upgrade re-runs remove+apply at the NEW level, resume re-runs it again');

// 3. Equal amplifier keeps the longer; weaker-but-longer is parked, not refused; nested chain.
const equalAmp = () => {
  const e = mob();
  ES.addStatusEffect(e, 'speed', 100, 0);
  const shorter = ES.addStatusEffect(e, 'speed', 50, 0);
  const longer = ES.addStatusEffect(e, 'speed', 200, 0);
  return shorter === false && longer === true && e.effects.speed.duration === 200 && e.effects.speed.hiddenEffect === null;
};
ok(equalAmp(), 'equal amplifier: a shorter one changes nothing (false), a longer one extends in place (true)');
const nested = () => {
  const e = mob();
  ES.addStatusEffect(e, 'speed', 50, 2);
  const r1 = ES.addStatusEffect(e, 'speed', 100, 1);      // weaker/longer: parked, not "changed"
  ES.addStatusEffect(e, 'speed', 200, 0);                 // hidden.upgrade(I 200): parked under II
  const s = e.effects.speed;
  if (!(r1 === false && s.amplifier === 2 && s.hiddenEffect.amplifier === 1 && s.hiddenEffect.hiddenEffect &&
        s.hiddenEffect.hiddenEffect.amplifier === 0 && s.hiddenEffect.hiddenEffect.duration === 200)) return false;
  tickN(e, 50);
  if (!(e.effects.speed.amplifier === 1 && e.effects.speed.duration === 50)) return false;
  tickN(e, 50);
  return e.effects.speed.amplifier === 0 && e.effects.speed.duration === 100;
};
ok(nested(), 'III 50 / II 100 / I 200: two-deep hidden chain resumes II with 50 left, then I with 100 left');

// 4. Flags: ambient only clears (or follows a change); showParticles/showIcon mismatch is a change.
const flags = () => {
  const e = mob();
  ES.addStatusEffect(e, 'luck', 100, 0, true, true);
  const a = ES.addStatusEffect(e, 'luck', 50, 0, false, true);    // !next.ambient && cur.ambient
  const b = ES.addStatusEffect(e, 'luck', 50, 0, true, true);     // ambient true over false: no change
  const c = ES.addStatusEffect(e, 'luck', 50, 0, false, false);   // particles + icon differ
  const l = e.effects.luck;
  return a === true && l.duration === 100 && b === false && c === true && l.showParticles === false && l.showIcon === false;
};
ok(flags(), 'upgrade flags: ambient drops to false, not up to true; particles/icon mismatch counts as a change');

// 5. Hooks + LivingEntity bookkeeping.
const book = () => {
  const e = mob(); e.absorption = 0;
  ES.addStatusEffect(e, 'absorption', 100, 1);            // +8
  ES.addStatusEffect(e, 'poison', 100, 0);
  const rm = ES.removeStatusEffect(e, 'poison'), rm2 = ES.removeStatusEffect(e, 'poison');
  ES.setStatusEffect(e, ES.instance('absorption', 20, 0));   // replace outright: remove(amp0)=-4, apply(amp0)=+4
  const afterSet = e.absorption === 8 && e.effects.absorption.amplifier === 0 && e.effects.absorption.duration === 20;
  const cl = ES.clearStatusEffects(e), cl2 = ES.clearStatusEffects(e);
  return rm === true && rm2 === false && afterSet && cl === true && cl2 === false &&
    Object.keys(e.effects).length === 0 && e.absorption === 4;
};
ok(book(), 'removeStatusEffect is a boolean with onRemoved; setStatusEffect replaces; clearStatusEffects runs onRemoved for each');
const hb = () => {
  const e = mob(); ES.addStatusEffect(e, 'health_boost', 5, 0); e.health = 28;
  tickN(e, 5);
  return !e.effects.health_boost && e.health === 20;
};
ok(hb(), 'health_boost expiring clamps health to max (HealthBoostStatusEffect.onRemoved)');
const mark600 = () => {
  const e = mob(); ES.addStatusEffect(e, 'speed', 1201, 0); let n = 0;
  const f = ES.onStatusEffectUpgraded; ES.onStatusEffectUpgraded = (...a) => { if (a[2] === false) n++; return f(...a); };
  tickN(e, 1201); ES.onStatusEffectUpgraded = f;
  return n === 2 && !e.effects.speed;
};
ok(mark600(), 'tickStatusEffects: every duration % 600 == 0 re-marks the swirls (onUpgraded, no reapply)');

// 6. NBT: every key, the nested HiddenEffect, byte amplifier, ShowIcon defaulting to ShowParticles.
const nbtTrip = () => {
  const e = mob();
  ES.addStatusEffect(e, 'strength', 3600, 0, true, false, true);
  ES.addStatusEffect(e, 'strength', 440, 1, true, false, true);
  const l = ES.save(e), t = l[0];
  if (!(l.length === 1 && t.Id === 5 && t.Amplifier === 1 && t.Duration === 440 && t.Ambient === true &&
        t.ShowParticles === false && t.ShowIcon === true && t.HiddenEffect && t.HiddenEffect.Id === 5 &&
        t.HiddenEffect.Amplifier === 0 && t.HiddenEffect.Duration === 3600)) return false;
  const e2 = mob(); ES.load(e2, JSON.parse(JSON.stringify(l)));
  const s = e2.effects.strength;
  if (!(s && s.amplifier === 1 && s.ambient && !s.showParticles && s.showIcon && s.hiddenEffect && s.hiddenEffect.duration === 3600)) return false;
  tickN(e2, 440);
  return e2.effects.strength.amplifier === 0 && e2.effects.strength.duration === 3160;
};
ok(nbtTrip(), 'writeNbt/fromNbt round-trip carries HiddenEffect, and the reloaded chain still resumes');
const nbtEdges = () => {
  const e = mob(); ES.load(e, [{ Id: 1, Amplifier: -56, Duration: 9 }, { Id: 16, Amplifier: 0, Duration: 9, ShowParticles: false }, { Id: 99, Duration: 5 }]);
  const w = ES.writeNbt(ES.instance('speed', 1, 200));
  return e.effects.speed.amplifier === 0 && e.effects.speed.showParticles === true && e.effects.speed.showIcon === true &&
    e.effects.night_vision.showIcon === false && Object.keys(e.effects).length === 2 && w.Amplifier === -56;
};
ok(nbtEdges(), 'fromNbt: negative byte amplifier -> 0, ShowParticles default true, ShowIcon defaults to it, unknown Id dropped; (byte)200 == -56');
const aeKey = () => {
  const t1 = ES.writeActiveEffects(mob(), {});
  const e = mob(); ES.addStatusEffect(e, 'glowing', 20, 0);
  const t2 = ES.writeActiveEffects(e, {});
  return !('ActiveEffects' in t1) && Array.isArray(t2.ActiveEffects) && t2.ActiveEffects.length === 1;
};
ok(aeKey(), 'ActiveEffects written only when the map is non-empty');

// 7. Wiring: player record, mob records, milk.
const playerTrip = () => {
  const P = M.Player; P.hotbar = new Int32Array(9); P.selectSlot = () => {}; P.effects = {};
  ES.addStatusEffect(P, 'strength', 3600, 0); ES.addStatusEffect(P, 'strength', 440, 1);
  const o = JSON.parse(JSON.stringify(P.toJSON()));
  P.effects = {}; ES.addStatusEffect(P, 'poison', 50, 0);
  P.fromJSON(o);
  const s = P.effects.strength;
  const good = !P.effects.poison && s && s.amplifier === 1 && s.hiddenEffect && s.hiddenEffect.duration === 3600;
  delete o.ActiveEffects; P.fromJSON(o);
  return good && Object.keys(P.effects).length === 0;
};
ok(playerTrip(), 'player: P.toJSON writes ActiveEffects, P.fromJSON restores it (and an old save without it loads none)');
const mobTrip = () => {
  const zm = Object.assign(mob(), { type: 'zombie', x: 1, y: 64, z: 2 });
  ES.addStatusEffect(zm, 'speed', 300, 0); ES.addStatusEffect(zm, 'speed', 100, 2);
  const spawned = [];
  M.EntityList = { list: [zm], spawn: (type, x, y, z) => { const n = Object.assign(mob(), { type, x, y, z }); spawned.push(n); return n; } };
  const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
  M.MobNbt.restoreAll(recs);
  const s = spawned[0] && spawned[0].effects.speed;
  return !!recs[0].ActiveEffects && !!s && s.amplifier === 2 && s.hiddenEffect && s.hiddenEffect.duration === 300;
};
ok(mobTrip(), 'mob: MobNbt.serializeAll writes ActiveEffects, restoreAll reads it back onto the respawned mob');
const milk = () => {
  const inv = Iv.create(); Iv.setItem(inv, 0, Iv.stack('milk_bucket', 1, 0));
  const P = { mode: 0, instabuild: false, slot: 0, inventory: inv, food: 10, saturation: 0, health: 10, maxHealth: 20,
    effects: {}, absorption: 0, x: 0, y: 0, z: 0, exhaustion: 0 };
  ES.addStatusEffect(P, 'absorption', 600, 0); ES.addStatusEffect(P, 'poison', 600, 0);
  let called = 0; const f = ES.clearStatusEffects; ES.clearStatusEffects = (e) => { called++; return f(e); };
  if (!U.drinkStart(P, Iv.getItem(inv, 0))) { ES.clearStatusEffects = f; return false; }
  for (let t = 0; t < 40 && P.usingItem; t++) { P.useTicks += 1; if (P.useTicks >= U.drinkMaxTicks(P)) { U.drinkFinish(P); break; } }
  ES.clearStatusEffects = f;
  return called === 1 && Object.keys(P.effects).length === 0 && P.absorption === 0;
};
ok(milk(), 'milk: Use.drinkFinish goes through clearStatusEffects (absorption hearts removed with it)');

// anti-vacuity: break the hidden chain and the NBT key; each must be seen.
{
  const f = ES.upgrade;                                                // the pre-#293 rule: no hidden chain
  ES.upgrade = (cur, next) => {
    if (next.amplifier > cur.amplifier) { cur.amplifier = next.amplifier; cur.duration = next.duration; return true; }
    if (next.amplifier === cur.amplifier && next.duration > cur.duration) { cur.duration = next.duration; return true; }
    return false;
  };
  okAv(!strengthTail(), 'hidden chain dropped (the old simplified upgrade): Strength I tail no longer resumes');
  ES.upgrade = f;
}
{
  const f = ES.updateDuration; ES.updateDuration = (i) => --i.duration;   // hidden tail stops counting down
  okAv(!strengthTail(), 'hidden tail frozen (updateDuration skips the chain): resume comes back with 3600, not 3160');
  ES.updateDuration = f;
}
{
  const f = ES.writeNbt;
  ES.writeNbt = (i) => { const t = f(i); if (t.HiddenEffect) { t.Hidden = t.HiddenEffect; delete t.HiddenEffect; } return t; };
  okAv(!nbtTrip(), 'NBT key renamed (HiddenEffect -> Hidden): the round-trip loses the chain');
  ES.writeNbt = f;
}
{
  const f = ES.onStatusEffectUpgraded; ES.onStatusEffectUpgraded = () => {};
  okAv(!absorbResume(), 'onStatusEffectUpgraded hook removed: absorption upgrade/resume arithmetic breaks');
  ES.onStatusEffectUpgraded = f;
}
{
  const f = ES.clearStatusEffects; ES.clearStatusEffects = (e) => { e.effects = {}; return true; };   // the old bare wipe
  okAv(!book(), 'clearStatusEffects as a bare wipe (no onRemoved): absorption hearts survive milk');
  ES.clearStatusEffects = f;
}

// #943 -- WitherEntity.addStatusEffect returns false unconditionally: EVERY effect refused.
const witherRefuses = () => {
  const w = { type: 'wither', effects: {}, health: 300, maxHealth: 300 };
  return ['slowness', 'poison', 'weakness', 'wither', 'regeneration', 'speed'].every((n) => ES.addStatusEffect(w, n, 200, 0) === false) && Object.keys(w.effects).length === 0;
};
ok(witherRefuses(), 'wither refuses every status effect');
{
  const f = ES.canHaveStatusEffect; ES.canHaveStatusEffect = (e, n) => !(n === 'wither' && e.type === 'wither');   // old: only the wither effect refused
  okAv(!witherRefuses(), 'wither immunity narrowed to the wither effect: slowness applies');
  ES.canHaveStatusEffect = f;
}
// #943 -- WitherEntity.canStartRiding() = false.
const witherRides = () => { const w = { type: 'wither' }, v = { x: 0, y: 0, z: 0 }; return M.Raid.startRiding(w, v) === false && !w.vehicle; };
ok(witherRides(), 'wither cannot start riding');
{
  const f = M.Raid.startRiding; M.Raid.startRiding = (r, v) => { r.vehicle = v; return true; };
  okAv(!witherRides(), 'startRiding without the wither gate: wither mounts');
  M.Raid.startRiding = f;
}
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`effectinstcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
