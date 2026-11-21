#!/usr/bin/env node
// fishcastcheck.mjs — G17-F1: FishingRodItem.use cast/retract (07zzq_fishing.js).
// 8 (yaw,pitch) pairs: exactly one bobber, vanilla velocity (FishingBobberEntity ctor), P.fishHook set,
// throw sound; a second use removes it. Then injected faults must each be caught (D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
console.log('fishcastcheck — G17-F1: fishing rod cast');

const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
  '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07f_redstone.js', '07h_entities.js',
  '07i_entitylist.js', '14b_physics.js', '14e_gamemode.js', '14d_survival.js', '07q_effects.js', '14j_combat.js',
  '14l_use.js', '07zzq_fishing.js', '02j_sounds.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const W = { getBlock: () => 0, setBlock() { return true; }, blockLightAt: () => 15 };
MCL.World = W; MCL.Behave.init(W); MCL.BlockEntities.init(); MCL.Entities.init(); MCL.EntityList.init(); MCL.Combat.init();
MCL.Use.init(W);
const { Inventory: Iv, EntityList: EL, Fishing: Fi } = MCL;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
Math.random = () => 0.5;   // Cb.gauss(0.5...) is deterministic; the expected value uses the same source

const sounds = [];
MCL.Sound.entitySound = (ev, x, y, z, vol, pitch) => sounds.push({ ev, vol, pitch });

const PAIRS = [[0, 0], [Math.PI / 2, 0.3], [Math.PI, -0.5], [-Math.PI / 2, 1.0], [1, 0.2], [2.5, -1.2], [4, 0.7], [0.3, -0.1]];
function run() {
  const bad = [];
  for (const [yaw, pitch] of PAIRS) {
    const P = { inventory: Iv.create(), slot: 0, ex: 0, ey: 64, ez: 0, x: 0, y: 64, z: 0, EYE: 1.62, yaw, pitch, fishHook: null };
    Iv.setItem(P.inventory, 0, Iv.stack('fishing_rod', 1, 0));
    const stack = Iv.getItem(P.inventory, 0);
    const n0 = EL.list.filter((e) => e.type === 'fishing_bobber' && !e.removed).length;
    sounds.length = 0;
    const r = Fi.use(P, stack);
    const bobs = EL.list.filter((e) => e.type === 'fishing_bobber' && !e.removed);
    if (!r || bobs.length !== n0 + 1) { bad.push('spawn@' + yaw); continue; }
    const e = bobs[bobs.length - 1];
    const yv = (yaw - Math.PI) * 180 / Math.PI, pv = -pitch * 180 / Math.PI;
    // independent re-derivation: unit look vector * (0.6/|v| + 0.5 + gauss*0.0045) with the pitch clamp
    const D = Math.PI / 180, dx = Math.sin(yaw), dz = -Math.cos(yaw);
    const dy = Math.max(-5, Math.min(5, Math.tan(pitch)));
    const hl = Math.hypot(dx, dz) || 1, L = Math.sqrt(1 + dy * dy);
    const gs = MCL.Combat.gauss(Math.random) * 0.0045, k = 0.6 / L + 0.5 + gs;
    const want = [dx * k, dy * k, dz * k];
    const got = [e.vx, e.vy, e.vz];
    if (got.some((g, i) => Math.abs(g - want[i]) > 1e-4)) bad.push('vel@' + yaw + ',' + pitch + ' ' + got.map((v) => v.toFixed(4)) + ' vs ' + want.map((v) => v.toFixed(4)));
    if (P.fishHook !== e) bad.push('fishHook@' + yaw);
    if (!sounds.length || sounds[0].ev !== 'entity.fishing_bobber.throw' || sounds[0].vol !== 0.5) bad.push('sound@' + yaw);
    // second use retracts
    const r2 = Fi.use(P, stack);
    if (!r2 || !e.removed && EL.list.includes(e) || P.fishHook) bad.push('retract@' + yaw);
    if (EL.list.filter((x) => x.type === 'fishing_bobber' && !x.removed).length !== n0) bad.push('count@' + yaw);
  }
  return bad;
}

console.log('\n1. 8 (yaw,pitch) casts + retracts');
const bad0 = run();
ok(bad0.length === 0, 'vanilla cast: ' + bad0.join('; '));
ok(Fi.use({ inventory: Iv.create() }, Iv.stack('dirt', 1, 0)) === false, 'a non-rod is refused');

console.log('\n2. anti-vacuity — injected faults');
let breaks = 0;
const origUse = Fi.use, origSpeed = Fi.SPEED, origSound = Fi.CAST_SOUND;
function fault(name, apply, undo) {
  apply(); const bad = run(); undo();
  breaks++; ok(bad.length > 0, 'anti-vacuity: fault "' + name + '" not caught');
  if (bad.length) console.log('  ✓ fault caught: ' + name);
}
fault('wrong speed 0.6 -> 0.9', () => { Fi.SPEED = 0.9; }, () => { Fi.SPEED = origSpeed; });
fault('no fishHook set', () => { Fi.use = (P, s) => { const r = origUse(P, s); if (r && P.fishHook) P.fishHook.removed = false; const h = P.fishHook; P.fishHook = null; P._h = h; return r; }; }, () => { Fi.use = origUse; });
fault('sound id swapped', () => { Fi.CAST_SOUND = Fi.RETRIEVE_SOUND; }, () => { Fi.CAST_SOUND = origSound; });
fault('retract leaves the bobber', () => { Fi.use = (P, s) => { if (P.fishHook) { P.fishHook = null; return true; } return origUse(P, s); }; }, () => { Fi.use = origUse; });

if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`OK  ${pass} checks passed, 0 failures; fishing cast matches FishingRodItem.use; ${breaks} breaks caught`);
