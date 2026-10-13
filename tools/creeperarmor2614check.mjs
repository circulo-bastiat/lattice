#!/usr/bin/env node
// creeperarmor2614check.mjs — #2614: CreeperChargeFeatureRenderer (creeper_armor.png on the 2.0-dilated creeper model when charged).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, "anti-vacuity: " + m); console.log("   ✓ " + m); };
const rd = (f) => readFileSync(join(ROOT, f), 'utf8');

ok(/CREEPER_ARMOR, CreeperEntityModel\.getTexturedModelData\(new Dilation\(2\.0F\)\)/.test(rd('.decomp/net/minecraft/client/render/entity/model/EntityModels.java')), '.decomp CREEPER_ARMOR is the 2.0 dilation');
ok(!!JSON.parse(rd('assets/mob-geometry.json')).layers.creeper_armor, 'creeper_armor has packed geometry');
const rows = (t) => rd('tools/golden/models-1.18.2.tsv').split('\n').filter((l) => l.startsWith(t + '\t')).map((l) => l.split('\t'));
const base = rows('creeper'), arm = rows('creeper_armor');
ok(arm.length === 6 && arm.length === base.length, 'creeper_armor has the six creeper boxes');
ok(arm.every((r) => r[19] === '2'), 'creeper_armor rows carry grow 2');
ok(arm.every((r, i) => [4, 5, 6].every((k) => +r[k] === +base[i][k] - 2) && [7, 8, 9].every((k) => +r[k] === +base[i][k] + 4)), 'boxes are the creeper boxes grown by 2');
ok(/creeper_armor: P\('creeper\/creeper_armor\.png'\)/.test(rd('tools/extract-mob-textures.mjs')), 'creeper_armor.png is extracted');
ok(/e\.type === 'creeper' && e\.charged[\s\S]{0,300}texKey: 'creeper_armor'/.test(rd('src/07j_entityrender.js')), 'renderer pushes the armor pass for a charged creeper');

okAv(arm.every((r) => r[19] !== '0'), 'an undilated armor model would be caught');
okAv(!/e\.type === 'creeper' && e\.charged[\s\S]{0,300}texKey: 'creeper_armor'/.test('if (e.type === "creeper") {}'), 'a missing renderer branch would be caught');
okAv(arm.length > 0, 'a missing layer would be caught');

console.log(`creeperarmor2614check (#2614, creeper armor layer)\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
