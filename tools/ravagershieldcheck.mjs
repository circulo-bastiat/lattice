#!/usr/bin/env node
// ravagershieldcheck.mjs — #846: a shield-blocked ravager bite reaches RavagerEntity.knockback (50% stunTick=40 +
// entity.ravager.stunned + pushAwayFrom, else private knockBack). (The attack sound is master's ravagerSay.)
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
    extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07y_equip.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07k_goals.js'],
    patch,
  });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  if (M.Equip.init) M.Equip.init();
  return M;
};
function scenario(M) {
  const Sv = M.Survival, Use = M.Use, Iv = M.Inventory, Ai = M.Ai;
  const sounds = [];
  M.MobVoice = { emit: (e, ev) => { sounds.push(ev); return true; } };   // master routes ravager sounds through MobVoice.emit (ravagerSay)
  const out = {};
  const mkP = () => {
    const P = { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, onGround: true, slot: 0, instabuild: false };
    P.inventory = Iv.create ? Iv.create() : Iv.newInventory();
    Sv.init(P);
    Iv.setItem(P.inventory, 0, Iv.stack('shield', 1, 0));
    Use.shieldStart(P, Iv.getItem(P.inventory, 0)); P.useTicks = 5;
    return P;
  };
  let stuns = 0, n = 200;
  for (let i = 0; i < n; i++) {
    const P = mkP(), r = { type: 'ravager', x: 0, y: 64, z: -2, ravagerStunTick: 0, ravagerRoarTick: 0 };
    sounds.length = 0;
    Sv.hurt(P, 'mob', 6, r);
    if (r.ravagerStunTick === 40) { stuns++; if (!sounds.includes('entity.ravager.stunned')) out.noStunSound = true; }
  }
  out.stuns = stuns; out.n = n;
  const P = mkP(), roar = { type: 'ravager', x: 0, y: 64, z: -2, ravagerStunTick: 0, ravagerRoarTick: 5 };
  Use.takeShieldHit(P, roar, () => 0);
  out.roarNoStun = roar.ravagerStunTick === 0;
  return out;
}
console.log('ravagershieldcheck — #846');
const r = scenario(load());
ok(r.stuns > 70 && r.stuns < 130, 'about half of ' + r.n + ' blocked bites stun (got ' + r.stuns + ')');
ok(!r.noStunSound, 'stun plays entity.ravager.stunned');
ok(r.roarNoStun, 'roaring ravager is not stunned');
const brk = (name, file, from, to, key, want) => {
  let hit = false, rr;
  try { rr = scenario(load((f, s) => { if (f === file && s.includes(from)) { hit = true; return s.replace(from, to); } return s; })); } catch (e) { rr = null; }
  const caught = hit && (!rr || (key === 'stuns' ? !(rr.stuns > 70 && rr.stuns < 130) : String(rr[key]) !== String(want)));
  if (caught) { breaks++; console.log('   ✓ ' + name + ' caught'); } else fails.push('anti-vacuity: "' + name + '" not caught (matched=' + hit + ')');
};
brk('unwired', '14l_use.js', "ty === 'ravager' && Ai &&", 'false &&', 'stuns');
brk('no stun sound', '07k_goals.js', "ravagerSay(e, 'entity.ravager.stunned');", '', 'noStunSound', undefined);
brk('roar gate gone', '07k_goals.js', "if ((e.ravagerRoarTick || 0) !== 0) return;", '', 'roarNoStun', true);
console.log('   ' + pass + ' checks passed, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('   ✗ ' + f); process.exit(1); }
