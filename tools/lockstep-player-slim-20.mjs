#!/usr/bin/env node
// lockstep_player_slim -- #5524 (G17-L4): player_slim is the client's slim-arm skin model of the server entity `player`
// (net.minecraft.world.entity.player.Player; the model choice is client-only, hitbox/attributes/movement identical).
// There is no server entity to spawn, so the lane runs the `player` lane under the slim alias: 20 seeds, engine trace deterministic,
// hitbox alias == player, faults caught at the right tick/field. Server comparison: pilot.mjs --seeds 20 --lanes player (lockstep_player).
import { readFileSync } from 'node:fs';
import { enginePlayerTrace, compareInputTraces } from './referee/lockstep/playerinput.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const aliasOf = (t) => /player_slim:\s*'([a-z_]+)'/.exec(t)?.[1];
const SRC = readFileSync(new URL('./extract-hitbox-extras.mjs', import.meta.url), 'utf8');
ok(aliasOf(SRC) === 'player', 'player_slim aliases the server entity player');
caught(aliasOf(SRC.replace("player_slim: 'player'", "player_slim: 'zombie'")) !== 'player', 'wrong alias (attribute source)');
const T = 60, SEEDS = Array.from({ length: 20 }, (_, i) => i);
const scriptOf = (s) => [{ tick: 2 + (s % 5), op: 'input', fwd: 1, sprint: true }, { tick: 20 + (s % 7), op: 'input', fwd: 1, jump: true, sprint: true }, { tick: 30 + (s % 3), op: 'input', fwd: 1, sneak: true }, { tick: 45 + (s % 4), op: 'input' }];
const traces = SEEDS.map((s) => enginePlayerTrace(scriptOf(s), T));
traces.forEach((R, i) => ok(R.length === T && compareInputTraces(R, enginePlayerTrace(scriptOf(i), T)) === null, `seed ${i}: deterministic`));
const A = traces[0];
const mut = (f, fn, at) => A.map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareInputTraces(A, m); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('food', (f) => f - 1, 33), 33, 'food', 'wrong attribute (food)');
at(mut('onGround', (g) => !g, 25), 25, 'onGround', 'goal tick off by one (onGround)');
at(mut('exhaustion', (e) => e + 0.001, 50), 50, 'exhaustion', 'consumption order (exhaustion)');
console.log(`player_slim: ${SEEDS.length}/${SEEDS.length} seeds, ${bad} divergences, ${breaks} breaks caught (alias of player; server pilot is lockstep_player)`);
process.exit(bad ? 1 : 0);
