#!/usr/bin/env node
// tools/infra/callcounter.mjs - #11323 (Dan, 9 Nov): every single tool call a headless role makes shows a short line "call N/max", so the
// call-41 report and call-46 handoff reserves in the enlarger/worker prompts can be seen coming. Claude Code PostToolUse hook
// (.claude/settings.json, matcher ".*" = every tool). Counts per session_id in <root>/.git/mclite-calls.json (a resumed run keeps its session id,
// so its count carries on). max = env MCLITE_MAX_TURNS (tools/brain/launch.mjs sets it from roles.json maxTurns); unset -> "call N".
// The line goes back as hookSpecificOutput.additionalContext. Any error lets the call through with no output - a broken hook never stops work.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const line = (n, max) => `[call ${n}${Number(max) > 0 ? '/' + Number(max) : ''}]`;
function main() {
  const ev = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const sid = String(ev.session_id || 'nosession');
  let dir = join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.git');
  try { mkdirSync(dir, { recursive: true }); } catch { dir = tmpdir(); }
  const f = join(dir, 'mclite-calls.json');
  let c = {}; try { c = JSON.parse(readFileSync(f, 'utf8')); } catch { c = {}; }
  const n = (c[sid] || 0) + 1; c[sid] = n;
  const keys = Object.keys(c); if (keys.length > 50) for (const k of keys.slice(0, keys.length - 50)) delete c[k];   // keep the file small
  try { writeFileSync(f, JSON.stringify(c)); } catch {}
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: line(n, process.env.MCLITE_MAX_TURNS) } }));
  return 0;
}
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('callcounter.mjs')) { try { process.exit(main()); } catch { process.exit(0); } }
