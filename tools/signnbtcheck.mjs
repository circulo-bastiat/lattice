#!/usr/bin/env node
// signnbtcheck.mjs — #8975: SignBlockEntity Text1..Text4 / Color / GlowingText NBT round trip.
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, fails = [], breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['02g_items.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js'], dom: false });
initRegistry(M);
M.BlockEntities.init();
const BE = M.BlockEntities;
const mk = () => BE.make ? BE.make('sign') : { lines: ['', '', '', ''], color: 'black', glowing: false };
const e = mk();
e.lines = ['a', 'b"q', '', 'd']; e.color = 'red'; e.glowing = true;
const t = BE.signToNbt(e);
ok(t.Text1 === '{"text":"a"}' && t.Text3 === '{"text":""}', 'Text1..4 are JSON text strings');
ok(t.Color === 'red' && t.GlowingText === 1, 'Color and GlowingText');
const back = BE.signFromNbt(mk(), t);
ok(JSON.stringify(back.lines) === JSON.stringify(e.lines) && back.color === 'red' && back.glowing === true, 'round trip');
ok(BE.signFromNbt(mk(), { Text1: 'plain', Text2: '"s"' }).lines.slice(0, 2).join('|') === 'plain|s', 'plain and string forms read');
// anti-vacuity: break the output and the round trip must notice
const bad = Object.assign({}, t, { Text2: '{"text":"X"}' });
if (BE.signFromNbt(mk(), bad).lines[1] !== e.lines[1]) breaks++;
const bad2 = Object.assign({}, t, { GlowingText: 0 });
if (BE.signFromNbt(mk(), bad2).glowing !== e.glowing) breaks++;
ok(breaks === 2, 'both breaks caught');
console.log(fails.length ? fails.join("\n") : `${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
