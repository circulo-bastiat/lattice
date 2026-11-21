// tools/infra/relay.mjs - run by .github/workflows/relay.yml (Dan's PC runners) on every push to claude/**.
// WHY: a claude.ai/code cloud session reaches GitHub through a proxy that allows API READS and pushes to the
// session's own branch, and refuses every API WRITE ("Write access to this GitHub API path is not permitted through
// this proxy"). So go.mjs, when a write is refused, records it as an "op commit" (subject `mclite-op: <op>`, JSON
// body) on the session's branch and pushes; this relay performs it with the workflow's token.
//   claim  {issue, ref}            create work/<issue>-… at that commit (atomic: GitHub refuses a second one)
//   say / reply / handoff {issue?, body}   post the comment (bus #53, or the issue)
//   done   {issue, ref, finished, title, body}  move work/… to the pushed head; finished -> PR labelled land
// Every push also fast-forwards the session's work/… ref to its branch head (the claim's heartbeat).
import { gitExec } from './gitenv.mjs';
import { execFileSync } from 'node:child_process';
import { gh, busIssue } from './gh.mjs';

const [before, after, branch] = process.argv.slice(2);
const git = (...a) => gitExec(a, { encoding: 'utf8' }).trim();
const zero = /^0+$/.test(before || '');
const range = zero ? `origin/master..${after}` : `${before}..${after}`;
const shas = git('rev-list', '--reverse', range).split('\n').filter(Boolean);
const busNo = busIssue;   // cached, shared (gh.mjs)
const isAncestor = (a, b) => { try { git('merge-base', '--is-ancestor', a, b); return true; } catch { return false; } };
let myRef = null, landed = false;

for (const sha of shas) {
  const msg = git('log', '-1', '--format=%B', sha);
  const m = msg.match(/^mclite-op: (\w+)\n+([\s\S]*)$/);
  if (!m) continue;
  let op; try { op = JSON.parse(m[2].trim()); } catch { console.log('bad op body', sha); continue; }
  try {
    if (m[1] === 'claim') {
      try { await gh('POST', '/repos/{repo}/git/refs', { ref: `refs/heads/${op.ref}`, sha }); console.log('CLAIMED', op.ref); myRef = op.ref; }
      catch (e) {
        const cur = await gh('GET', `/repos/{repo}/git/ref/heads/${op.ref}`).catch(() => null);
        if (cur && isAncestor(cur.object.sha, after)) { myRef = op.ref; console.log('RE-CLAIMED (same line of work)', op.ref); }
        else console.log('CLAIM LOST', op.ref, e.message);
      }
    } else if (m[1] === 'say' || m[1] === 'reply') {
      await gh('POST', `/repos/{repo}/issues/${await busNo()}/comments`, { body: op.body });
    } else if (m[1] === 'handoff') {
      await gh('POST', `/repos/{repo}/issues/${op.issue}/comments`, { body: op.body });
    } else if (m[1] === 'done') {
      myRef = op.ref;
      if (op.finished) {
        await ff(op.ref, after);
        const owner = (await gh('GET', '/repos/{repo}')).owner.login;
        const open = await gh('GET', `/repos/{repo}/pulls?state=open&head=${owner}:${encodeURIComponent(op.ref)}`);
        const pr = open[0] || await gh('POST', '/repos/{repo}/pulls', { title: op.title, head: op.ref, base: 'master', body: op.body });
        await gh('POST', `/repos/{repo}/issues/${pr.number}/labels`, { labels: ['land'] });
        landed = true; console.log('PR', pr.number);
      }
    }
  } catch (e) { console.log('op failed', m[1], sha.slice(0, 7), e.message); }
}
async function ff(ref, to) {
  const cur = await gh('GET', `/repos/{repo}/git/ref/heads/${ref}`).catch(() => null);
  if (!cur) return;
  if (cur.object.sha !== to && isAncestor(cur.object.sha, to)) { await gh('PATCH', `/repos/{repo}/git/refs/heads/${ref}`, { sha: to, force: false }); console.log('FF', ref); }
}
// heartbeat: find this branch's claim (it may be in an earlier push) and keep work/… at the branch head
if (!myRef) {
  const claim = git('log', '--format=%H%x09%B', `origin/master..${after}`).split('\n').find((l) => /mclite-op: claim/.test(l));
  if (claim) { const b = git('log', '-1', '--format=%B', claim.split('\t')[0]); try { myRef = JSON.parse(b.replace(/^mclite-op: claim\n+/, '')).ref; } catch {} }
}
if (myRef) await ff(myRef, after).catch((e) => console.log('ff failed', e.message));
// labels added with the workflow's own token do not start workflows: start the lander explicitly
if (landed) await gh('POST', '/repos/{repo}/actions/workflows/land.yml/dispatches', { ref: 'master' }).catch((e) => console.log('land not dispatched', e.message));
console.log(`relay ${branch}: ${shas.length} commit(s) read`);
