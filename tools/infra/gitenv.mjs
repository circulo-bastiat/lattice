// tools/infra/gitenv.mjs - #7856: every automated git call that can touch a remote goes through here, on any host.
// Git Credential Manager (Windows) must never be consulted: it stores token URLs' "x-access-token" as an account and then
// shows a "Select an account" window on Dan's desktop. An empty credential.helper means no helper, no storing, no window.
import { spawnSync, execFileSync } from 'node:child_process';

export const gitArgs = () => ['-c', 'credential.helper='];
export const gitEnv = (extra = {}) => ({
  ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: 'echo', ...extra,
});
const scrub = (s) => String(s || '').replace(/(x-access-token:)[^@\s]+@/g, '$1***@').replace(/(AUTHORIZATION: basic )\S+/gi, '$1***');
const NEEDS_AUTH = /could not read (Username|Password)|terminal prompts disabled|Authentication failed|invalid credentials|Permission denied|403|401/i;
/** One loud line, never the token. `what` names the call, e.g. "push t/7856". */
export function gitFault(what, e) {
  const err = scrub(e && (e.stderr || e.message || e)).trim().split('\n').filter(Boolean).pop() || 'failed';
  return `GIT-FAULT  ${what}: ${NEEDS_AUTH.test(String(e && (e.stderr || e.message))) ? 'no usable credentials (helper disabled, no prompt): ' : ''}${err}`;
}
export const gitSync = (args, opts = {}) => spawnSync('git', [...gitArgs(), ...args], { ...opts, env: gitEnv(opts.env || {}) });
export const gitExec = (args, opts = {}) => {
  try { return execFileSync('git', [...gitArgs(), ...args], { ...opts, env: gitEnv(opts.env || {}) }); }
  catch (e) { if (/\b(push|fetch|pull|clone|ls-remote)\b/.test(args.join(' '))) console.error(gitFault(args.find((a) => /^(push|fetch|pull|clone|ls-remote)$/.test(a)), e)); throw e; }
};
