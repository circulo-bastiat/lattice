#!/usr/bin/env node
// blockenumscheck.mjs - #11723: the net.minecraft.block.enums classes (Attachment, BambooLeaves, BlockHalf, ComparatorMode,
// JigsawOrientation, PistonType, SculkSensorPhase, SlabType, StructureBlockMode, WallMountLocation, WallShape, WireConnection).
// In MC-Lite each enum is a block-state property's value set in the real registry (NS.Reg propVals, read by 02c_states.js).
// Expected values come from .decomp (the enum sources); observed come from the live registry. Mutants must be caught.
import { readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({}); const R = M.Reg;
const dec = (c) => [...readFileSync(`.decomp/net/minecraft/block/enums/${c}.java`, 'utf8').matchAll(/^\s*\w+\("([a-z_]+)"/gm)].map((m) => m[1]);
// enum -> [block, property] it backs (Attachment=bell, BlockHalf=stairs half, ...)
const MAP = { Attachment: ['bell', 'attachment'], BambooLeaves: ['bamboo', 'leaves'], BlockHalf: ['oak_stairs', 'half'],
  ComparatorMode: ['comparator', 'mode'], JigsawOrientation: ['jigsaw', 'orientation'], PistonType: ['piston_head', 'type'],
  SculkSensorPhase: ['sculk_sensor', 'sculk_sensor_phase'], SlabType: ['oak_slab', 'type'], StructureBlockMode: ['structure_block', 'mode'],
  WallMountLocation: ['lever', 'face'], WallShape: ['cobblestone_wall', 'north'], WireConnection: ['redstone_wire', 'north'] };
function observed(block, prop) {
  const b = R.id[block]; if (b === undefined) return null;
  for (let s = R.propFirst[b]; s < R.propFirst[b + 1]; s++) {
    if (R.propNames[R.propId[s]] !== prop) continue;
    const o = R.propValOff[s], n = R.propValN[s], out = [];
    for (let j = 0; j < n; j++) out.push(R.valueNames[R.propVals[o + j]]);
    return out;
  }
  return null;
}
const same = (a, b) => !!a && !!b && a.length === b.length && [...a].sort().join() === [...b].sort().join();
let pass = 0, breaks = 0; const fails = [];
for (const [c, [blk, prop]] of Object.entries(MAP)) {
  const exp = dec(c), got = observed(blk, prop);
  if (!exp.length) { fails.push(`${c}: no .decomp values`); continue; }
  if (same(exp, got)) pass++; else fails.push(`${c}: ${blk}.${prop} = ${got} want ${exp}`);
  // mutants: drop a value / add a bogus one - must no longer match
  if (got) { if (!same(exp, got.slice(1))) breaks++; else fails.push(`${c}: drop mutant survived`);
             if (!same(exp, got.concat('bogus'))) breaks++; else fails.push(`${c}: add mutant survived`); }
}
for (const f of fails) console.log('FAIL', f);
console.log(`blockenumscheck: ${pass}/${Object.keys(MAP).length} enums match .decomp, ${breaks} breaks caught`);
process.exit(fails.length || breaks < 2 * Object.keys(MAP).length ? 1 : 0);
