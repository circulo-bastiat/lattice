#!/usr/bin/env node
// stepsourcecheck.mjs — #462: the player's own footsteps/fall land on the PLAYERS source
// (Entity.playSound uses getSoundCategory(); PlayerEntity => PLAYERS), so the Players slider
// silences them. Proves it can fail: each break corrupts the engine and the check must notice.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const sounds = readFileSync(join(SRC, '02j_sounds.js'), 'utf8');
const player = readFileSync(join(SRC, '14_player.js'), 'utf8');
let breaks = 0;
const fails = [];

function evaluate(snd, ply) {
  const out = [];
  const NS = {};
  new Function('MCL', snd)(NS);
  const S = NS.Sound;
  S.ready = true; S.byBlockId = [0]; S.types = [['s', 's', 's', 's', 's']];
  S.roles = ['break', 'place', 'hit', 'step', 'fall'];
  NS.States = { block: [0, 0] };
  S.play = (ev, o) => { out.push(o.source); return true; };
  S.blockStep(1, 0, 0, 0, null, 'player');
  S.blockFall(1, 0, 0, 0, null, 'player');
  S.blockBreak(1, 0, 0, 0, null);
  const res = [];
  res.push(out[0] === 'player' && out[1] === 'player');
  res.push(out[2] === undefined);
  res.push(/blockFall\([^)]*,\s*'player'\)/.test(ply));
  res.push(/S\.blockStep\([^)]*,\s*'player'\)/.test(ply));
  return res;
}
const good = evaluate(sounds, player);
const names = ['blockStep forwards source', 'blockBreak stays on block', 'player fall site passes \'player\'', 'player step site passes \'player\''];
good.forEach((g, i) => { if (!g) fails.push(names[i]); });
const bad = [
  evaluate(sounds.replace('listener: listener, source: source }', 'listener: listener }'), player),
  evaluate(sounds.replace("S.blockBreak = function (state, x, y, z, listener) { return blockPlay('break', state, x, y, z, listener);", "S.blockBreak = function (state, x, y, z, listener) { return blockPlay('break', state, x, y, z, listener, 'player');"), player),
  evaluate(sounds, player.replace(/(S\.blockStep\([^)]*),\s*'player'\)/g, '$1)')),
  evaluate(sounds.replace("blockPlay('fall', state, x, y, z, listener, source)", "blockPlay('fall', state, x, y, z, listener)"), player)
];
bad.forEach((b, i) => { if (b.every(Boolean)) fails.push('a broken engine passed'); else { breaks++; console.log('   ✓ break ' + (i + 1) + ' caught'); } });
console.log(fails.length ? 'FAIL ' + fails.join('; ') : 'ok: steps and falls route to the player source');
console.log(` assertions passed .. ${good.length - fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
// #4483: llama has exactly one step owner (EL.tickStep), and it plays through the #4003 gate (Ll.playSound).
const llSrc = readFileSync(join(SRC, '07ze_llama.js'), 'utf8'), elSrc = readFileSync(join(SRC, '07i_entitylist.js'), 'utf8');
const llamaOne = (ll, el) => !/entity\.llama\.step/.test(ll) && /isLlama\(e\)\) NS\.Llama\.playSound\(e, st\[0\]/.test(el);
if (!llamaOne(llSrc, elSrc)) fails.push('llama step has two owners or bypasses the gate');
[[llSrc + " Ll.playSound(e, 'entity.llama.step', 0.15, 1);", elSrc], [llSrc, elSrc.replace('NS.Llama.playSound(e, st[0]', 'S.play(st[0]')]].forEach((b, i) => {
  if (llamaOne(b[0], b[1])) fails.push('llama break ' + (i + 1) + ' passed'); else { breaks++; console.log('   ✓ llama break ' + (i + 1) + ' caught'); }
});
process.exit(fails.length || breaks < bad.length + 2 ? 1 : 0);
