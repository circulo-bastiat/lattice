#!/usr/bin/env node
// eatfxcheck.mjs — G19d-c (#178): the eating/drinking EFFECT cadence and the first-person pose.
// Vanilla: LivingEntity.tickItemStackUsage / shouldSpawnConsumptionEffects / spawnConsumptionEffects /
// spawnItemParticles / consumeItem, HeldItemRenderer.applyEatOrDrinkTransformation (all in .decomp).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets', 'items.meta.json'), 'utf8'));
const LJ = readFileSync(join(ROOT, '.decomp/net/minecraft/entity/LivingEntity.java'), 'utf8');
const HJ = readFileSync(join(ROOT, '.decomp/net/minecraft/client/render/item/HeldItemRenderer.java'), 'utf8');

// the decomp's own constants, read out of the source
ok(/\$\$0 % 4 == 0/.test(LJ) && /getMaxUseTime\(\) - 7/.test(LJ), 'decomp: cadence is %4 and max-7');
ok(/spawnConsumptionEffects\(\$\$0, 5\)/.test(LJ) && /spawnConsumptionEffects\(this\.activeItemStack, 16\)/.test(LJ), 'decomp: 5 per tick, 16 on finish');
ok(/pow\(\(double\)\$\$5, 27\.0\)/.test(HJ) && /\$\$7 \* 0\.6F/.test(HJ), 'decomp: pose uses ^27 and 0.6');

const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07q_effects.js', '07z_potion.js',
  '14d_survival.js', '14l_use.js', '14k_hand3d.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: meta.rawBytes });
const Iv = MCL.Inventory, U = MCL.Use, H3 = MCL.Hand3D || MCL.H3;
let snd = [], parts = [];
MCL.Sound = { play: (ev, o) => snd.push([ev, o]) };
MCL.Particle = { spawn: (t, x, y, z, vx, vy, vz, r, item) => { parts.push({ t, y, vy, item }); return true; } };

function run(name, tag) {
  const inv = Iv.create(); Iv.setItem(inv, 0, Iv.stack(name, 3, 0, tag || null));
  const P = { mode: 0, instabuild: false, slot: 0, inventory: inv, food: 6, saturation: 0, health: 20, effects: {},
    x: 0, y: 70, z: 0, yaw: 0, pitch: 0, exhaustion: 0, maxHealth: 20 };
  snd = []; parts = [];
  if (!U.drinkStart(P, Iv.getItem(inv, 0))) return null;
  const max = U.drinkMaxTicks(P), lefts = [], partsAt = [];
  for (let t = 0; t < max; t++) {
    P.useTicks += 1;
    const ns = snd.length, np = parts.length;
    if (U.consumeTick(P)) { lefts.push(max - (P.useTicks - 1) - 0); partsAt.push(parts.length - np); }
  }
  const sTick = snd.length, pTick = parts.length;
  U.drinkFinish(P);
  return { max, lefts, partsAt, sTick, pTick, sAll: snd.length, pAll: parts.length, snd };
}
const apple = run('apple');
ok(apple && apple.max === 32, 'apple holds 32');
// useTicks is bumped before consumeTick, so tick t sees left = max - t
ok(apple && apple.sTick === 6 && apple.pTick === 30, 'apple: 6 effect ticks x (1 sound, 5 particles), got ' + (apple && apple.sTick + '/' + apple.pTick));
ok(apple && apple.pAll - apple.pTick === 16, 'apple finish: 16 particles');
ok(apple && apple.snd.slice(0, 6).every(([e, o]) => e === 'entity.generic.eat' && (o.volume === 0.5 || o.volume === 1) && o.pitch >= 0.8 && o.pitch <= 1.2), 'eat sound: vol 0.5|1.0, pitch 1+-0.2');
const kelp = run('dried_kelp');
ok(kelp && kelp.max === 16 && kelp.sTick === 3 && kelp.pTick === 15, 'snack (dried_kelp 16): every 4th tick from the start (got ' + (kelp && kelp.sTick) + ')');
const pot = run('potion', { Potion: 'minecraft:regeneration' });
ok(pot && pot.sTick === 6 && pot.pTick === 0 && pot.pAll === 0, 'potion: drink sound, no particles');
ok(pot && pot.snd.slice(0, 6).every(([e, o]) => e === 'entity.generic.drink' && o.volume === 0.5 && o.pitch >= 0.9 && o.pitch <= 1.0), 'drink sound: vol 0.5, pitch 0.9..1.0');
ok(parts.every((p) => p.t === 'item_crack') && apple && apple.snd.length > 0, 'particles are item_crack');
// particle geometry: from the eye, in front of the face (yaw 0 -> +z), velocity y >= 0.15
run('apple');
ok(parts.length > 0 && parts.slice(0, 5).every((p) => p.y > 70 + 1.62 - 1 && p.y < 70 + 1.62 && p.vy >= 0.15 && p.vy <= 0.25 && p.item === 'apple'), 'particle height/velocity band');

// the pose
const M = () => { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
const m0 = H3.applyEatOrDrinkTransformation(M(), 32, 32);
ok(Math.abs(m0[12]) < 1e-9 && Math.abs(m0[13]) < 1e-9, 'pose: untouched at the start of the hold');
const m1 = H3.applyEatOrDrinkTransformation(M(), 1, 32);
ok(m1[12] > 0.4 && m1[13] < -0.3, 'pose: item at the mouth near the end (' + m1[12].toFixed(3) + ',' + m1[13].toFixed(3) + ')');
const m2 = H3.applyEatOrDrinkTransformation(M(), 16, 32);
ok(Math.abs(m2[13] - (0.1 - 0.5 * (1 - Math.pow(0.5, 27)))) < 1e-6, 'pose: nod 0.1 plus -0.5*g at half time (' + m2[13].toFixed(4) + ')');
const m3 = H3.applyEatOrDrinkTransformation(M(), 28, 32);
ok(Math.abs(m3[12] - 0.6 * (1 - Math.pow(0.875, 27))) < 1e-6, 'pose: x = 0.6*(1-f^27) at 28/32');

// ── anti-vacuity: each break must change a result above
const orig = U.shouldSpawnConsumptionEffects;
U.shouldSpawnConsumptionEffects = (s, l) => l % 4 === 0;   // drops the max-7 gate
const a2 = run('apple');
okAv(a2.sTick !== 6, 'no max-7 gate -> apple effect count changes (' + a2.sTick + ')');
U.shouldSpawnConsumptionEffects = (s, l) => (l <= 25);     // drops the %4
okAv(run('apple').sTick !== 6, 'no %4 -> cadence changes');
U.shouldSpawnConsumptionEffects = orig;
const origS = U.spawnItemParticles;
U.spawnItemParticles = (P, s, c, r) => origS(P, s, c + 1, r);
okAv(run('apple').pTick !== 30, 'particle count 6 -> caught');
U.spawnItemParticles = origS;
const lin = 0.6 * (1 - 0.875);   // a linear ramp instead of ^27
okAv(Math.abs(m3[12] - lin) > 0.1, 'pose: ^27 curve differs from a linear ramp (' + m3[12].toFixed(3) + ' vs ' + lin.toFixed(3) + ')');

console.log(` assertions passed .. ${pass}`);
console.log(`${breaks} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
