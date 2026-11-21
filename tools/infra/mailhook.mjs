#!/usr/bin/env node
// tools/infra/mailhook.mjs - Claude Code PreToolUse hook (.claude/settings.json, matcher ".*" = EVERY tool: Bash, PowerShell, Read, Edit,
// Write, Grep, subagents' tools...). A message on the session bus addressed to this session stops the call until the session deals with it
// (Dan, 28 Sept: "they must respond before anything else"; 10 Oct: "pervade all ... no matter what they're doing, not just go.mjs").
// Message types (tools/infra/bus.mjs, set from the phone's Talk tab): reply = answer needed; urgent = answer needed and drop everything;
// announce = shown once, no answer; info = never interrupts.
// The only calls let through are the ones that ARE mail commands: a lone `node tools/go.mjs reply|say|inbox|pending|news ...` - NOT a longer
// command that merely mentions one (before 10 Oct any command containing "go.mjs say" skipped the gate, chained commands included).
// Cost: one hook run per 15 s per workspace; the GitHub read behind it is cached 60 s (.git/mclite-mail.json), so a new message reaches a
// busy session within about a minute and a half. A long-running tool call cannot be interrupted; the next call is. Any error lets the call
// through - a broken hook must never stop work. Cowork sessions do not run Claude Code hooks; there the same gate lives in every go.mjs command.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { typeOf } from './bus.mjs';

export const INTERVAL_MS = 15e3;
/** true only for a command that is nothing but one mail command: no chaining, piping, redirects or substitution outside plain quoted text */
export function isMailCommand(tool, input) {
  if (!/^(Bash|PowerShell)$/.test(String(tool || ''))) return false;
  const raw = String((input && input.command) || '');
  if (/[`\n\r]|\$\(/.test(raw)) return false;                                // <> are harmless inside quoted text ("->" in a reply), so they are tested on `bare` below
  const bare = raw.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  if (/[;&|<>]/.test(bare)) return false;
  return /^\s*(?:\w+=\S+\s+)*node\s+(?:\S*[\\/])?tools[\\/]go\.mjs\s+(?:reply|say|inbox|pending|news)\b/.test(bare);
}
/** the text the session sees, by message type */
export function blockText(kind, m, more, root) {
  if (kind === 'announce') return `📣 ANNOUNCEMENT for you (no answer needed - read it, take it into account, then repeat the call that was just stopped):\n\n${m.body}\n`;
  const head = kind === 'urgent' ? '🚨 URGENT MESSAGE FROM DAN - STOP what you are doing now, whatever the command or step. Answer it before anything else.' : '✉ A MESSAGE FOR YOU IS WAITING - answer it before anything else.';
  return `${head}\n\n${m.body}\n\nAnswer with: node tools/go.mjs reply ${m.id} "<your answer>"   (then carry on; ${more} more waiting)\nThe reply must be ONE line, that command alone: no && ; | chaining, no backticks, no $( ), no newline. Quote the text with plain double quotes.\n`;
}
export const MAX_BLOCKS = 8;
/** deadlock breaker: true once the same message has stopped MAX_BLOCKS calls (a reply that is rejected, e.g. by quoting, would otherwise stop the session for its whole run) */
function breaker(root, id) {
  const f = join(root, '.git', 'mclite-mailblocks.json');
  let b = {}; try { b = JSON.parse(readFileSync(f, 'utf8')); } catch { b = {}; }
  b[id] = (b[id] || 0) + 1;
  try { writeFileSync(f, JSON.stringify(b)); } catch { return false; }
  return b[id] > MAX_BLOCKS;
}
function main() {
  const ev = JSON.parse(readFileSync(0, 'utf8') || '{}');
  if (isMailCommand(ev.tool_name, ev.tool_input)) return 0;
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const cache = join(root, '.git', 'mclite-mailhook.json'), seenF = join(root, '.git', 'mclite-seen.json');
  let c = existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : { at: 0, pending: [], news: [] };
  if (Date.now() - c.at > INTERVAL_MS) {
    const go = (cmd) => JSON.parse(execFileSync(process.execPath, [join(root, 'tools', 'go.mjs'), cmd], { cwd: root, encoding: 'utf8', timeout: 20e3 }).trim().split('\n').pop() || '[]');
    c = { at: Date.now(), pending: go('pending'), news: go('news') };
    writeFileSync(cache, JSON.stringify(c));
  }
  if (c.pending.length && breaker(root, c.pending[0].id)) { process.stderr.write(`mail hook: message ${c.pending[0].id} blocked ${MAX_BLOCKS} calls and was never answered - letting work continue (a session that cannot reply must not be stuck). Answer it when you can.\n`); return 0; }
  if (c.pending.length) {
    const m = c.pending[0];
    process.stderr.write(blockText(typeOf(m.body) === 'urgent' || c.pending.some((x) => typeOf(x.body) === 'urgent') ? 'urgent' : 'reply', c.pending.find((x) => typeOf(x.body) === 'urgent') || m, c.pending.length - 1, root));
    return 2;
  }
  let seen = []; try { seen = JSON.parse(readFileSync(seenF, 'utf8')); } catch { seen = []; }
  const fresh = (c.news || []).filter((m) => !seen.includes(m.id));
  if (!fresh.length) return 0;
  writeFileSync(seenF, JSON.stringify([...seen, ...fresh.map((m) => m.id)].slice(-200)));          // shown once: marked before it is shown, so a crash cannot loop
  process.stderr.write(fresh.map((m) => blockText('announce', m, 0, root)).join('\n'));
  return 2;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  let code = 0; try { code = main(); } catch { code = 0; }
  process.exit(code);
}
