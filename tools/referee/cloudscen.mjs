// cloudscen.mjs — the LINGERING-CLOUD referee pack's scenario (#6081), shared by runcloud.mjs (the real 1.18.2 server)
// and cloudrefcheck.mjs (the engine). One area_effect_cloud (the lingering-potion constants: Radius 3, RadiusOnUse -0.5,
// WaitTime 10, ReapplicationDelay 20, RadiusPerTick = -Radius/Duration, Potion poison = 900/4 ticks per application) over
// a NoAI cow and a NoAI zombie on a stone floor. A datapack tick function logs, EVERY tick, the cloud's Age and Radius and
// each victim's Health and poison duration into command storage; the engine logs the same after every EL.tick.
// (The player is not a victim here: the headless server has none. The engine's player path is the same loop as the mobs'.)
export const DURATION = 100;
export const WAIT = 10;
export const RADIUS = 3;
export const TICKS = 70;
export const VICTIMS = [{ id: 'cow', mob: 'cow', dx: 0.8 }, { id: 'zombie', mob: 'zombie', dx: -0.8 }];
export const cloudNbt = `Radius:${RADIUS}f,RadiusOnUse:-0.5f,RadiusPerTick:${Math.fround(-RADIUS / DURATION)}f,Duration:${DURATION},WaitTime:${WAIT},ReapplicationDelay:20,Potion:"minecraft:poison",Tags:["clc"]`;
