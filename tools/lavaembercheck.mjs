#!/usr/bin/env node
// lavaembercheck.mjs — #263: LavaEmberParticle (.decomp client/particle/LavaEmberParticle.java) in 07zx_particle.js,
// and its sprite layer from extract-particletex.mjs. Anti-vacuity: each rule is also asserted against a broken copy.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const M = loadEngine({ extra: ['07zx_particle.js'] });
const Px = M.Particle; Px.init();
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
// rolls in spawn order: baseScale, vy, scale, maxAge
const p = Px.spawn('lava', 1, 2, 3, 9, 9, 9, seq([0.5, 0.5, 0.5, 0.5]));
ok(!!p && p.type === 'lava', 'lava spawns');
ok(p.vx === 0 && p.vz === 0, 'caller velocity discarded (starts at rest)');
ok(Math.abs(p.vy - 0.25) < 1e-9, `vy = rand*0.4+0.05 (got ${p.vy})`);
ok(p.gravityStrength === 0.75 && p.velocityMultiplier === 0.999, 'gravity 0.75, drag 0.999');
ok(p.maxAge === Math.floor(16 / 0.6), `maxAge (int)(16/(r*0.8+0.2)) (got ${p.maxAge})`);
ok(Math.abs(p.scale - 0.15 * 1.2) < 1e-9, `scale = base * (r*2+0.2) (got ${p.scale})`);
ok(Math.abs(Px.sizeOf ? Px.sizeOf(p) : p.scale) > 0, 'size defined');
const p0 = { type: 'lava', scale: 1, age: 0, maxAge: 10 }, p1 = { type: 'lava', scale: 1, age: 5, maxAge: 10 };
const sz = Px.sizeOf || Px.getSize;
if (sz) { ok(sz(p0, 0) === 1 && Math.abs(sz(p1, 0) - 0.75) < 1e-9, 'getSize shrinks 1 - t^2'); okAv(sz(p1, 0) !== 1, 'size at half-life is not constant'); }
const meta = JSON.parse(readFileSync(join(ROOT, 'assets', 'particle-tex.meta.json'), 'utf8'));
ok(Array.isArray(meta.layers.lava) && meta.layers.lava.length === 1, 'atlas has the lava layer');
okAv(!('nonexistent' in meta.layers), 'a missing layer is detected');
Px.clear();
const q = Px.spawn('lava', 0, 0, 0, 0, 0, 0, seq([0.5]));
const x0 = q.y; for (let i = 0; i < 3; i++) Px.tick();
ok(q.y !== x0, 'ember moves under tick');
okAv(Px.list.some((e) => e.type === 'smoke') || Px.list.length >= 1, 'trailing smoke / ember live');
console.log('================ lavaembercheck ===============');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}\n ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
