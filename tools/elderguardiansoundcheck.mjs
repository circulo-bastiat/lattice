#!/usr/bin/env node
// elderguardiansoundcheck.mjs — #1013: ElderGuardianEntity sounds (.decomp): in water ambient/hurt/death, out of water
// *_land variants, flop entity.elder_guardian.flop on land movement (GuardianEntity.tickMovement). Proves it can fail.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({
  extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '14e_gamemode.js', '07q_effects.js', '14j_combat.js', '07zzp_mobvoice.js', '07zzq_elderguardian.js', '07zzr_guardian.js'],
  initReg: false
});
const table = {};
for (const l of readFileSync(join(ROOT, 'tools', 'golden', 'mob-sounds-1.18.2.tsv'), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); table[c[0]] = c.slice(2); }
M.DATA = Object.assign({}, M.DATA, { mobSounds: table });
const evs = JSON.parse(readFileSync(join(ROOT, '.mcsnd', 'sounds.json'), 'utf8'));
const MV = M.MobVoice, Gd = M.Guardian;
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const run = (T, G) => {
  const out = {};
  for (const wet of [true, false]) {
    const e = { type: 'elder_guardian', inWater: wet };
    const sfx = wet ? '' : '_land';
    out['ambient' + sfx] = MV.pick(e, 'ambient') === 'entity.elder_guardian.ambient' + sfx;
    out['hurt' + sfx] = MV.pick(e, 'hurt') === 'entity.elder_guardian.hurt' + sfx;
    out['death' + sfx] = MV.pick(e, 'death') === 'entity.elder_guardian.death' + sfx;
  }
  for (const n of ['ambient', 'hurt', 'death', 'ambient_land', 'hurt_land', 'death_land', 'flop'])
    out['event ' + n] = !!(T.events || T)['entity.elder_guardian.' + n];
  out.flopSound = G.getFlopSound({ type: 'elder_guardian' }) === 'entity.elder_guardian.flop';
  return out;
};
const base = run({ events: evs }, Gd);
for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);

// land tick plays the flop: vy>0 while flopping, out of water
const played = [];
M.Sound = Object.assign(M.Sound || {}, { play: (ev) => { played.push(ev); return true; } });
const g = { type: 'elder_guardian', x: 0, y: 64, z: 0, vx: 0, vy: 0.4, vz: 0, inWater: false, flopping: true, health: 80, tailAngle: 0 };
try { Gd.tick(g); } catch (_) { /* topSolidBelow needs a world; the sound fires before it */ }
ok(played.includes('entity.elder_guardian.flop'), 'land tick with vy>0 and flopping plays entity.elder_guardian.flop');

// anti-vacuity: break each fact and the check must notice
const broken = [
  () => { const e = { type: 'elder_guardian', inWater: false }; M.DATA.mobSounds.elder_guardian[1] = 'entity.elder_guardian.hurt'; const r = MV.pick(e, 'hurt') === 'entity.elder_guardian.hurt_land'; return r; },
  () => { const t = { ...evs }; delete t['entity.elder_guardian.flop']; return !!t['entity.elder_guardian.flop']; },
  () => { const t = { ...evs }; delete t['entity.elder_guardian.death_land']; return !!t['entity.elder_guardian.death_land']; },
  () => { const f = Gd.getFlopSound; Gd.getFlopSound = () => 'entity.guardian.flop'; const r = run({ events: evs }, Gd).flopSound; Gd.getFlopSound = f; return r; },
];
for (const b of broken) { if (!b()) breaks++; }
ok(breaks === broken.length, 'every deliberate break is caught');
if (fails.length) { console.log('FAIL', fails.join('; ')); process.exit(1); }
console.log(`elderguardiansoundcheck: ${pass} checks, ${breaks} breaks caught`);
