#!/usr/bin/env node
// blocksoundwirecheck.mjs — #370: `Sound.blockHit` (mining, every 4th tick) and `Sound.blockFall`
// plus entity.player.small_fall/big_fall (fall damage) have a CALLER in src/14_player.js.
// A source-level wiring check (Player.update needs a whole world to drive); proves it can fail by
// corrupting the source text and requiring each rule to notice.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src', '14_player.js'), 'utf8');
const RULES = [
  ['blockHit is called', (s) => /Sound\.blockHit\(/.test(s)],
  ['hit sound is gated on tick % 4 === 0', (s) => /hitSoundTick\s*\|\s*0\)\s*%\s*4\s*===\s*0[^\n]*blockHit/.test(s)],
  ['hit counter advances every tick', (s) => /hitSoundTick = \(P\.hitSoundTick \| 0\) \+ 1/.test(s)],
  ['hit counter resets on a new target', (s) => /P\.breakProgress = 0; P\.hitSoundTick = 0/.test(s)],
  ['blockFall is called', (s) => /Sound\.blockFall\(/.test(s)],
  ['big_fall above 4 damage', (s) => /fd > 4 \? 'entity\.player\.big_fall' : 'entity\.player\.small_fall'/.test(s)],
  ['fall block is floor(y - 0.2)', (s) => /getBlock\(Math\.floor\(P\.x\), Math\.floor\(P\.y - 0\.2\)/.test(s)]
];
const fails = []; let pass = 0, breaks = 0;
for (const [n, f] of RULES) { if (f(SRC)) pass++; else fails.push(n); }
const MUT = [
  ['blockHit removed', (s) => s.replace('Sound.blockHit(', 'Sound.noHit(')],
  ['hit every tick', (s) => s.replace('% 4 === 0', '% 1 === 0')],
  ['counter frozen', (s) => s.replace('P.hitSoundTick = (P.hitSoundTick | 0) + 1', '')],
  ['no reset', (s) => s.replace('P.breakProgress = 0; P.hitSoundTick = 0', 'P.breakProgress = 0;')],
  ['blockFall removed', (s) => s.replace('Sound.blockFall(', 'Sound.noFall(')],
  ['big_fall threshold', (s) => s.replace('fd > 4', 'fd > 9')],
  ['wrong block', (s) => s.split('Math.floor(P.y - 0.2)').join('Math.floor(P.y - 1.2)')]
];
for (const [n, m] of MUT) {
  const bad = RULES.some(([, f]) => !f(m(SRC)));
  if (bad) { breaks++; console.log(`   ✓ break caught: ${n}`); } else fails.push('anti-vacuity: ' + n + ' went unnoticed');
}
console.log('\n================ blocksoundwirecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
