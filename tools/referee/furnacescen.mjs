// furnacescen.mjs — the FURNACE TIMING scenarios, shared by runfurnace.mjs (the real 1.18.2 server) and
// furnacerefcheck.mjs (the engine). Infra I6, 24 Sept 2026.
//
// Each scenario is one furnace-family block placed at tick 1 with its three slots filled (and CookTimeTotal
// given, as a player's `setStack` of the input would have set it -- a /setblock NBT without it loads 0 and the
// server then never finishes a cook, which is a /setblock artefact, not the game). Then, per tick, both sides
// sample BurnTime, CookTime, the three slot counts and the block's `lit`, on the same clock as redstonescen.mjs:
//   for k = 1..T: (k == 1: place) -> sample (log[k-1]) -> one world tick.
export const PROBES = ['burn', 'cook', 'in', 'fuel', 'out', 'lit', 'bucket'];

const it = (slot, id, n) => ({ slot, id, n });
export const SCENARIOS = [
  { id: 'furnace_ore2_coal', block: 'furnace', total: 200, T: 440, items: [it(0, 'iron_ore', 2), it(1, 'coal', 1)] },
  { id: 'furnace_raw2_stick', block: 'furnace', total: 200, T: 260, items: [it(0, 'raw_iron', 2), it(1, 'stick', 1)] },
  { id: 'furnace_raw1_stick2', block: 'furnace', total: 200, T: 260, items: [it(0, 'raw_iron', 1), it(1, 'stick', 2)] },
  { id: 'blast_raw3_coal', block: 'blast_furnace', total: 100, T: 340, items: [it(0, 'raw_iron', 3), it(1, 'coal', 1)] },
  { id: 'smoker_beef2_coal', block: 'smoker', total: 100, T: 240, items: [it(0, 'beef', 2), it(1, 'coal', 1)] },
  { id: 'furnace_sand_lava', block: 'furnace', total: 200, T: 220, items: [it(0, 'sand', 1), it(1, 'lava_bucket', 1)] },
  { id: 'furnace_output_full', block: 'furnace', total: 200, T: 60, stat: true,
    items: [it(0, 'cobblestone', 1), it(1, 'coal', 1), it(2, 'stone', 64)] },
  { id: 'furnace_output_other', block: 'furnace', total: 200, T: 60, stat: true,
    items: [it(0, 'cobblestone', 1), it(1, 'coal', 1), it(2, 'glass', 1)] },
  { id: 'blast_food_refused', block: 'blast_furnace', total: 100, T: 60, stat: true, items: [it(0, 'beef', 1), it(1, 'coal', 1)] },
];

export const origin = (i) => ({ x: 4 + 3 * i, y: -60, z: 20 });

export function serverPlan() {
  const setup = [], step = [], keys = [];
  setup.push('forceload add 0 16 64 32');
  setup.push('fill 0 -60 18 64 -58 22 minecraft:air');
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i), P = `${o.x} ${o.y} ${o.z}`;
    const items = sc.items.map((s) => `{Slot:${s.slot}b,id:"minecraft:${s.id}",Count:${s.n}b}`).join(',');
    step.push(`execute if score #t mclr matches 1 run setblock ${P} minecraft:${sc.block}[facing=north,lit=false]{CookTimeTotal:${sc.total}s,Items:[${items}]}`);
    const reads = {
      burn: `data get block ${P} BurnTime`, cook: `data get block ${P} CookTime`,
      in: `data get block ${P} Items[{Slot:0b}].Count`, fuel: `data get block ${P} Items[{Slot:1b}].Count`,
      out: `data get block ${P} Items[{Slot:2b}].Count`,
      lit: `execute if block ${P} minecraft:${sc.block}[lit=true]`,
      bucket: `execute if data block ${P} Items[{Slot:1b,id:"minecraft:bucket"}]`,
    };
    for (const p of PROBES) {
      keys.push(`${sc.id}.${p}`);
      const j = keys.length - 1;
      step.push(`execute if score #t mclr matches ..${sc.T} run data modify storage mcliteref:fur p${j} append value 0`);
      step.push(`execute if score #t mclr matches ..${sc.T} store result storage mcliteref:fur p${j}[-1] int 1 run ${reads[p]}`);
    }
  });
  return { setup, step, keys, T: Math.max(...SCENARIOS.map((s) => s.T)) };
}
