#!/usr/bin/env node
// shieldcheck.mjs — #862, shield blocking (ShieldItem / LivingEntity.blockedByShield / PlayerEntity.damageShield,
// takeShieldHit, disableShield; .decomp read whole). Drives the real Sv.hurt with a raised shield.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const load = (patch) => {
  const M = loadEngine({
    extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07y_equip.js', '14j_combat.js', '14d_survival.js', '14l_use.js'],
    patch,
  });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  if (M.Equip.init) M.Equip.init();
  return M;
};

function scenario(M) {
  const NS = M, Sv = NS.Survival, Use = NS.Use, Iv = NS.Inventory, IT = NS.Items;
  const out = {};
  const mk = () => {
    const P = { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, onGround: true, slot: 0, instabuild: false };
    P.inventory = Iv.create ? Iv.create() : Iv.newInventory();
    Sv.init(P);
    Iv.setItem(P.inventory, 0, Iv.stack('shield', 1, 0));
    return P;
  };
  const front = { type: 'zombie', x: 0, y: 64, z: -2 };   // yaw 0 looks toward -z
  const back = { type: 'zombie', x: 0, y: 64, z: 2 };
  let P = mk();
  out.startOk = Use.shieldStart(P, Iv.getItem(P.inventory, 0));
  P.useTicks = 4;
  out.warm = Use.isBlocking(P);
  P.useTicks = 5;
  out.up = Use.isBlocking(P);
  let h = P.health; Sv.hurt(P, 'mob', 4, front);
  out.frontHealth = h - P.health;
  out.kb = Math.abs(P.vz - 0.15) < 1e-6;   // LivingEntity.knockback literally: takeKnockback(0.5, defender - attacker) -> vz -0.5, halved, then base 0.4 the other way
  out.dur = Iv.getItem(P.inventory, 0).d;
  P = mk(); Use.shieldStart(P, Iv.getItem(P.inventory, 0)); P.useTicks = 5;
  h = P.health; Sv.hurt(P, 'mob', 4, back); out.backHealth = h - P.health;
  P = mk(); Use.shieldStart(P, Iv.getItem(P.inventory, 0)); P.useTicks = 5;
  h = P.health; Sv.hurt(P, 'mob', 2, front); out.smallDur = Iv.getItem(P.inventory, 0).d | 0;
  P = mk(); Use.shieldStart(P, Iv.getItem(P.inventory, 0)); P.useTicks = 5;
  Use.disableShield(P, true, () => 0.5);
  out.axeDisabled = !P.usingItem && P.shieldCooldown === 100;
  out.cooldownBlocks = !Use.shieldStart(P, Iv.getItem(P.inventory, 0));
  P = mk(); Use.shieldStart(P, Iv.getItem(P.inventory, 0)); P.useTicks = 5;
  Use.disableShield(P, false, () => 0.5);
  out.plainSurvives = P.usingItem === true;
  P = mk(); Use.shieldStart(P, Iv.getItem(P.inventory, 0)); P.useTicks = 5;
  Sv.hurt(P, 'mob', 4, { type: 'zombie', x: 0, y: 64, z: -2, equip: [Iv.stack('iron_axe', 1, 0)] });
  out.axeHit = P.shieldCooldown;
  return out;
}

console.log('shieldcheck — #862');
const M = load();
const r = scenario(M);
ok(r.startOk, 'shield raise starts');
ok(!r.warm, '4 ticks: not blocking yet');
ok(r.up, '5 ticks: blocking');
ok(r.frontHealth === 0, 'frontal hit fully blocked');
ok(r.kb, 'takeShieldHit (0.5) then base 0.4 knockback: vz 0.15 (literal .decomp order)');
ok(r.dur === 5, 'a 4-damage block costs 1+floor(4)=5 durability');
ok(r.backHealth > 0, 'hit from behind is not blocked');
ok(r.smallDur === 0, 'a hit under 3 costs no durability');
ok(r.axeDisabled, 'axe disable (chance 1.0) drops the guard for 100 ticks');
ok(r.cooldownBlocks, 'cooldown refuses re-raise');
ok(r.plainSurvives, 'non-axe disable at 0.25 chance vs roll 0.5 keeps guard');

// anti-vacuity: each break must flip the check
const brk = (name, file, from, to, key, want) => {
  let hit = false;
  let rr;
  try {
    rr = scenario(load((f, s) => { if (f === file && s.includes(from)) { hit = true; return s.replace(from, to); } return s; }));
  } catch (e) { rr = null; }
  const caught = hit && (!rr || String(rr[key]) !== String(want));
  breaks += caught ? 1 : 0;
  if (caught) console.log('   ✓ ' + name + ' caught');
  if (!caught) fails.push('anti-vacuity: break "' + name + '" not caught (matched=' + hit + ')');
};
brk('no warmup', '14l_use.js', 'P.useTicks >= Use.SHIELD_WARMUP_TICKS', 'true', 'warm', false);
brk('angle flipped', '14l_use.js', '/ len < 0', '/ len > 0', 'frontHealth', 0);
brk('no durability', '14l_use.js', 'st.d = (st.d | 0) + n;', '', 'dur', 5);
brk('no knockback', '14l_use.js', 'Cb.knockback(P, 0.5,', 'Cb.knockback(P, 0,', 'kb', true);
brk('axe ignored', '14l_use.js', "/_axe$/.test(nm)", 'false', 'axeHit', 100);

console.log('   ' + pass + ' checks passed, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('   ✗ ' + f); process.exit(1); }
