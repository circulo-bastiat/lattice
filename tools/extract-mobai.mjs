#!/usr/bin/env node
// extract-mobai.mjs — #212 (G18b-1), the D-394/D-398/D-399 rows of `Ai.OWED`.
//
//   node tools/extract-mobai.mjs   -> tools/golden/mobai-1.18.2.tsv
//
// Reads, out of `.decomp/` (Yarn/intermediary-mapped 1.18.2 jar bytecode decompile):
//   MeleeAttackGoal   getSquaredMaxAttackDistance (reach), resetCooldown (attack interval)
//   BreakDoorGoal     MIN_MAX_PROGRESS, getMaxProgress, the == finish test
//   DoorInteractGoal  the PathNavigation node lookahead (min(index+2, length), y+1, 2.25)
//   PathNodeType      every constant's default penalty, by declaration order (Yarn names)
//   LandPathNodeMaker getCommonNodeType + the neighbour hazard scan: which block/fluid/door
//                     state maps to which PathNodeType (block names joined through Blocks.java)
// Every pattern is matched by regex against the source; a body that no longer matches FAILS the
// run rather than emitting a guess. Rows: key<TAB>value.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENT = join(ROOT, '.decomp', 'net', 'minecraft', 'entity');
const OUT = join(ROOT, 'tools', 'golden', 'mobai-1.18.2.tsv');

// PathNodeType's Yarn constant names in declaration order (the enum's own field_N names are
// intermediary; the count is asserted against the file, and each penalty is a golden row the
// engine's `Ai.DEFAULT_PENALTY` is compared to).
export const NODE_NAMES = ['BLOCKED', 'OPEN', 'WALKABLE', 'WALKABLE_DOOR', 'TRAPDOOR', 'POWDER_SNOW',
  'DANGER_POWDER_SNOW', 'FENCE', 'LAVA', 'WATER', 'WATER_BORDER', 'RAIL', 'UNPASSABLE_RAIL', 'DANGER_FIRE',
  'DAMAGE_FIRE', 'DANGER_CACTUS', 'DAMAGE_CACTUS', 'DANGER_OTHER', 'DAMAGE_OTHER', 'DOOR_OPEN',
  'DOOR_WOOD_CLOSED', 'DOOR_IRON_CLOSED', 'BREACH', 'LEAVES', 'STICKY_HONEY', 'COCOA'];

export function derive(entDir, blocksSrc) {
  const rd = (p) => readFileSync(join(entDir, p), 'utf8');
  const rows = [];
  const need = (cond, what) => { if (!cond) throw new Error('extract-mobai: ' + what + ' no longer matches the decompile'); };
  const row = (k, v) => rows.push([k, String(v)]);

  // ── MeleeAttackGoal ──
  const mg = rd('ai/goal/MeleeAttackGoal.java');
  let m = mg.match(/getSquaredMaxAttackDistance\(LivingEntity (\$\$\d)\) \{\s*return \(double\)\(this\.mob\.getWidth\(\) \* ([\d.]+)F \* this\.mob\.getWidth\(\) \* ([\d.]+)F \+ \1\.getWidth\(\)\);/);
  need(m && m[2] === m[3], 'MeleeAttackGoal.getSquaredMaxAttackDistance');
  row('melee.reach_self_factor', parseFloat(m[2]));   // reach^2 = (w*f)*(w*f) + targetWidth
  m = mg.match(/void resetCooldown\(\) \{\s*this\.cooldown = this\.getTickCount\((\d+)\);/);
  need(m, 'MeleeAttackGoal.resetCooldown');
  row('melee.attack_interval', m[1]);
  need(/this\.cooldown = Math\.max\(this\.cooldown - 1, 0\);/.test(mg), 'MeleeAttackGoal cooldown decrement');
  need(/\$\$1 <= \$\$2 && this\.cooldown <= 0/.test(mg), 'MeleeAttackGoal.attack gate');

  // ── BreakDoorGoal ──
  const bd = rd('ai/goal/BreakDoorGoal.java');
  m = bd.match(/MIN_MAX_PROGRESS = (\d+);/); need(m, 'BreakDoorGoal.MIN_MAX_PROGRESS');
  row('breakdoor.min_max_progress', m[1]);
  m = bd.match(/getMaxProgress\(\) \{\s*return Math\.max\((\d+), this\.maxProgress\);/); need(m && m[1] === bd.match(/MIN_MAX_PROGRESS = (\d+)/)[1], 'BreakDoorGoal.getMaxProgress');
  need(/protected int maxProgress = -1;/.test(bd), 'BreakDoorGoal.maxProgress default');
  need(/this\.breakProgress == this\.getMaxProgress\(\)/.test(bd), 'BreakDoorGoal finish test');
  need(/this\.breakProgress <= this\.getMaxProgress\(\)/.test(bd), 'BreakDoorGoal.shouldContinue bound');
  row('breakdoor.finish_at', 'progress==max');
  row('breakdoor.continue_while', 'progress<=max');
  m = bd.match(/doorPos\.isWithinDistance\(this\.mob\.getPos\(\), ([\d.]+)\)/); need(m, 'BreakDoorGoal.shouldContinue distance');
  row('breakdoor.continue_dist', m[1]);

  // ── DoorInteractGoal: the PathNavigation lookahead ──
  const di = rd('ai/goal/DoorInteractGoal.java');
  m = di.match(/\$\$2 < Math\.min\(\$\$1\.getCurrentNodeIndex\(\) \+ (\d+), \$\$1\.getLength\(\)\)/); need(m, 'DoorInteractGoal node lookahead');
  row('doorinteract.lookahead_nodes', m[1]);
  m = di.match(/new BlockPos\(\$\$3\.x, \$\$3\.y \+ (\d+), \$\$3\.z\)/); need(m, 'DoorInteractGoal door y offset');
  row('doorinteract.door_y_offset', m[1]);
  m = di.match(/> ([\d.]+)\)\) \{\s*this\.doorValid = DoorBlock\.isWoodenDoor/); need(m, 'DoorInteractGoal distance');
  row('doorinteract.max_dist_sqr', m[1]);
  need(/this\.doorPos = this\.mob\.getBlockPos\(\)\.up\(\);/.test(di), 'DoorInteractGoal fallback pos');
  row('doorinteract.fallback', 'mob_block_pos_up');
  need(/!this\.mob\.horizontalCollision/.test(di), 'DoorInteractGoal horizontalCollision gate');
  row('doorinteract.requires_horizontal_collision', 'true');

  // ── PathNodeType penalties ──
  const pt = rd('ai/pathing/PathNodeType.java');
  const consts = [...pt.matchAll(/^\s+(field_\d+)\((-?[\d.]+)F\)[,;]/gm)];
  need(consts.length === NODE_NAMES.length, 'PathNodeType constant count');
  const yarn = {};
  consts.forEach((c, i) => { yarn[c[1]] = NODE_NAMES[i]; row('nodetype.penalty.' + NODE_NAMES[i], parseFloat(c[2])); });

  // ── block name join (Blocks.java: field_N -> registry name) ──
  const bname = {};
  for (const b of blocksSrc.matchAll(/(field_\d+) = register\(\s*"([a-z0-9_]+)"/g)) bname[b[1]] = b[2];
  const blk = (f) => { need(bname[f], 'Blocks.' + f); return bname[f]; };

  // ── LandPathNodeMaker.getCommonNodeType / hazard scan ──
  const lp = rd('ai/pathing/LandPathNodeMaker.java');
  const common = lp.match(/static PathNodeType getCommonNodeType\([\s\S]*?\n    \}\n\n    public static boolean inflictsFireDamage/); need(common, 'getCommonNodeType body');
  const cb = common[0];
  const ty = (f) => { need(yarn[f], 'PathNodeType.' + f); return yarn[f]; };
  const isOf = (f, nt) => {
    const r = new RegExp('isOf\\(Blocks\\.' + f + '\\)\\) \\{\\s*return PathNodeType\\.(field_\\d+);');
    const x = cb.match(r); need(x && ty(x[1]) === nt, 'common ' + f + ' -> ' + nt);
    row('common.' + blk(f), nt);
  };
  const expect = (f, nt) => isOf(f, nt);
  const nm = (n) => Object.keys(bname).find((k) => bname[k] === n);
  expect(nm('cactus'), 'DAMAGE_CACTUS');
  expect(nm('sweet_berry_bush'), 'DAMAGE_OTHER');
  expect(nm('honey_block'), 'STICKY_HONEY');
  expect(nm('cocoa'), 'COCOA');
  expect(nm('powder_snow'), 'POWDER_SNOW');
  const seq = (re, nt, key) => { const x = cb.match(re); need(x && ty(x[1]) === nt, key); row('common.' + key, nt); };
  seq(/FluidTags\.field_15518\)\) \{\s*return PathNodeType\.(field_\d+);/, 'LAVA', 'fluid:lava');
  seq(/inflictsFireDamage\(\$\$2\)\) \{\s*return PathNodeType\.(field_\d+);/, 'DAMAGE_FIRE', 'inflicts_fire_damage');
  seq(/isWoodenDoor\(\$\$2\) && !\$\$2\.get\(DoorBlock\.OPEN\)\) \{\s*return PathNodeType\.(field_\d+);/, 'DOOR_WOOD_CLOSED', 'door:wooden_closed');
  seq(/Material\.METAL && !\$\$2\.get\(DoorBlock\.OPEN\)\) \{\s*return PathNodeType\.(field_\d+);/, 'DOOR_IRON_CLOSED', 'door:metal_closed');
  seq(/instanceof DoorBlock && \$\$2\.get\(DoorBlock\.OPEN\)\) \{\s*return PathNodeType\.(field_\d+);/, 'DOOR_OPEN', 'door:open');
  seq(/instanceof AbstractRailBlock\) \{\s*return PathNodeType\.(field_\d+);/, 'RAIL', 'rail');
  seq(/instanceof LeavesBlock\) \{\s*return PathNodeType\.(field_\d+);/, 'LEAVES', 'leaves');
  // inflictsFireDamage members
  const fire = lp.match(/inflictsFireDamage\(BlockState \$\$0\) \{([\s\S]*?)\n    \}/); need(fire, 'inflictsFireDamage');
  const fm = [...fire[1].matchAll(/isOf\(Blocks\.(field_\d+)\)/g)].map((x) => blk(x[1]));
  need(fm.length === 3 && /isLitCampfire/.test(fire[1]) && /isIn\(BlockTags\.field_21952\)/.test(fire[1]), 'inflictsFireDamage members');
  row('fire_damage.blocks', fm.sort().join(','));
  row('fire_damage.also', 'tag:fire,lit_campfire');
  // neighbour scan (getNodeTypeFromNeighbors)
  const ns = lp.match(/for \(int \$\$6 = -1; \$\$6 <= 1; \$\$6\+\+\) \{([\s\S]*?)return \$\$2;/); need(ns, 'neighbour scan');
  const nb = ns[1];
  const nx = (re, nt, key) => { const x = nb.match(re); need(x && ty(x[1]) === nt, 'neighbour ' + key); row('neighbour.' + key, nt); };
  nx(/isOf\(Blocks\.field_10029\)\) \{\s*return PathNodeType\.(field_\d+);/, 'DANGER_CACTUS', blk('field_10029'));
  nx(/isOf\(Blocks\.field_16999\)\) \{\s*return PathNodeType\.(field_\d+);/, 'DANGER_OTHER', blk('field_16999'));
  nx(/inflictsFireDamage\(\$\$9\)\) \{\s*return PathNodeType\.(field_\d+);/, 'DANGER_FIRE', 'inflicts_fire_damage');
  nx(/FluidTags\.field_15517\)\) \{\s*return PathNodeType\.(field_\d+);/, 'WATER_BORDER', 'fluid:water');
  need(/\$\$6 != 0 \|\| \$\$8 != 0/.test(nb), 'neighbour scan skips own column');
  row('neighbour.range', '-1..1');
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(ENT)) { console.log('extract-mobai: no .decomp/ here — keeping the committed golden'); process.exit(0); }
  const rows = derive(ENT, readFileSync(join(ROOT, '.decomp', 'net', 'minecraft', 'block', 'Blocks.java'), 'utf8'));
  writeFileSync(OUT, '# key\tvalue — mob melee reach/interval, BreakDoorGoal, door lookahead, PathNodeType penalties and the LandPathNodeMaker node-type mapping (tools/extract-mobai.mjs, .decomp)\n'
    + rows.map((r) => r.join('\t')).join('\n') + '\n');
  console.log('extract-mobai: ' + rows.length + ' rows -> ' + OUT);
}
