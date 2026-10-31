#!/usr/bin/env node
// potioncolorcheck.mjs — #10807. ItemColors -> PotionUtil.getColor(stack) on the tinted layer of
// potion / splash_potion / lingering_potion / tipped_arrow, per STACK. Prints "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const M = loadEngine({ extra: ['02g_items.js', '07q_effects.js', '07z_potion.js'], dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
const IT = M.Items, Po = M.Potion;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const st = (name, tag) => ({ i: IT.of(name), n: 1, d: 0, t: tag });
const run = () => {
  const col = (name, tag) => IT.stackColor(st(name, tag));
  for (const n of ['potion', 'splash_potion', 'lingering_potion', 'tipped_arrow']) {
    ok(IT.stackTintOf(IT.of(n)) !== null, n + ' has a per-stack tint layer');
    const sw = col(n, { Potion: 'minecraft:swiftness' }), he = col(n, { Potion: 'minecraft:healing' });
    ok(sw === Po.colorOf('swiftness') && sw === 8171462, n + ' swiftness colour (StatusEffects.SPEED 8171462)');
    ok(he === Po.colorOf('healing') && he === 16262179, n + ' healing colour (INSTANT_HEALTH 16262179)');
    ok(sw !== he, n + ': two potions differ');
    ok(col(n, { Potion: 'minecraft:water' }) === Po.DEFAULT_POTION_COLOR, n + ' water');
    ok(col(n, undefined) === Po.DEFAULT_POTION_COLOR, n + ' no tag = default colour');
    const cu = col(n, { CustomPotionEffects: [{ Id: 1, effect: 'speed', duration: 100, amplifier: 0 }] });
    ok(cu === Po.colorOf(undefined, [{ effect: 'speed', duration: 100, amplifier: 0 }]), n + ' custom effects colour');
    ok(col(n, { CustomPotionColor: 0x123456 }) === 0x123456, n + ' CustomPotionColor wins');
  }
  ok(IT.stackColor(st('stone')) === -1 && IT.stackTintOf(IT.of('stone')) === null, 'stone is not per-stack');
};
run();
const baseFails = fails.slice();
// anti-vacuity: each break must turn the check red
let breaks = 0;
const caught = (label, brk, undo) => { const before = fails.length; brk(); run(); undo(); if (fails.length > before) breaks++; else baseFails.push('NOT CAUGHT: ' + label); fails.length = before; };
const ec = Po.EFFECT_COLOR.speed, cs = Po.colorOfStack, st0 = IT.stackTint;
caught('colour table', () => { Po.EFFECT_COLOR.speed = 1; }, () => { Po.EFFECT_COLOR.speed = ec; });
caught('ignores the tag', () => { Po.colorOfStack = () => 16253176; }, () => { Po.colorOfStack = cs; });
caught('no tint layer table', () => { IT.stackTint = {}; }, () => { IT.stackTint = st0; });
caught('ignores CustomPotionColor', () => { Po.colorOfStack = (s) => cs({ t: s.t && { Potion: s.t.Potion, CustomPotionEffects: s.t.CustomPotionEffects } }); }, () => { Po.colorOfStack = cs; });
console.log(`potioncolorcheck: ${pass} ok, ${breaks} breaks caught`);
for (const f of baseFails.slice(0, 20)) console.log('  FAIL ' + f);
console.log(`${breaks} breaks caught`);
process.exit(baseFails.length === 0 && breaks === 4 ? 0 : 1);
