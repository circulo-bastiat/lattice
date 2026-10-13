// lane.mjs — run a command on Dan's WINDOWS PC through the ai-jobs runner, from anywhere (D-408).
//
// ⚠ WHY. A Cowork `device_bash` call dies at ~180 s with everything it started (KW-20). The runner
// (`C:\claudeisthegoat\ai-jobs.js`) is a plain Windows program with no such limit, 12 threads, Git
// with Dan's saved GitHub login, and Edge on a real GPU. So: long jobs, the WHOLE suite with every
// browser stage, and `git push` go through here. The contract is the runner's own README
// (`C:\claudeisthegoat\ai-jobs\README.md`): a `<name>.job.md` in `inbox/`, the result in `done/`.
//
//   node tools/lane.mjs run <tag> -- <node|git …>   queue a command (cwd = this project) and RETURN
//   node tools/lane.mjs suite                        queue the FULL suite at Dan's preset and RETURN
//   node tools/lane.mjs push                         queue `git push origin HEAD` and RETURN
//   node tools/lane.mjs answer <job>                 ONE read of a job's answer — never repeated
//   node tools/lane.mjs status                       runner heartbeat + what is queued/running
//
// ⚠⚠ D-436 — NO POLLING, FOR THE LIFE OF THIS PROJECT (Dan, 20 Sept 2026: "fully stop polling for
// the rest of this project's lifespan"). Nothing in this file waits, sleeps or loops on a job, and
// no session schedules a wake-up to come back for one. A queued job's answer is read ONCE, by the
// next `session.mjs start` (it prints every mclite answer that landed since the last close). If a
// session needs a result inside itself, it runs the command itself, in its own shell — it does not
// queue it and watch. `toolscheck` fails the build of the docs if a wait loop comes back here.
//
// ⚠ The runner only runs commands that START with node, npm, npx, git, python, py, java or javac
// (Dan's allowlist, 2026-08-01). No `cmd /c`, no shell operators. Caps a job at 120 min.

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const CANDIDATES = [
  process.env.MCLITE_JOBS_DIR,
  process.platform === 'win32' ? 'C:/claudeisthegoat/ai-jobs' : null,
  process.env.HOME ? join(process.env.HOME, 'mnt', 'claudeisthegoat', 'ai-jobs') : null,
].filter(Boolean);
const JOBS = CANDIDATES.find((d) => existsSync(join(d, 'inbox')));
if (!JOBS) {
  console.log('FAIL  lane: the ai-jobs folder is not reachable. Connect C:\\claudeisthegoat to the session.');
  process.exit(1);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const clean = (s) => String(s).replace(/\0/g, '');

function submit(tag, cmd, { timeoutMin = 30, note = '', heavy = false } = {}) {
  if (!/^(node|npm|npx|git|python|py|java|javac)\b/.test(cmd)) {
    console.log(`FAIL  lane: "${cmd.split(' ')[0]}" is not on the runner's allowlist (node, git, python …)`);
    process.exit(1);
  }
  const name = `mclite-${stamp()}-${tag}`;
  writeFileSync(join(JOBS, 'inbox', name + '.job.md'),
    `run: ${cmd}\nroot: mclite\ncwd: .\ntimeout_ms: ${timeoutMin * 60000}\nassign: PC\n${heavy ? 'express: false\n' : ''}\n` +
    `Queued by tools/lane.mjs (MC-Lite). ${note}\n`);
  return name;
}

function answerOf(name) {
  const done = join(JOBS, 'done');
  const f = readdirSync(done).find((x) => x.startsWith(name) && x.endsWith('.answer.md'));
  return f ? clean(readFileSync(join(done, f), 'utf8')) : null;
}

function summarise(a) {
  const code = (a.match(/\| exit code \| (\S+)/) || [])[1];
  const took = (a.match(/\| took \| ([^|]+)\|/) || [])[1];
  const tail = a.split('\n').filter((l) => l.trim()).slice(-30).join('\n');
  return `exit ${code ?? '?'}${took ? ' · took ' + took.trim() : ''}\n${tail}`;
}

const cmd = argv[0];
if (cmd === 'status') {
  try {
    const st = JSON.parse(clean(readFileSync(join(JOBS, 'runner-status.json'), 'utf8')));
    const age = Math.round((Date.now() - Date.parse(st.updatedAt)) / 1000);
    console.log(`runner ${st.alive ? 'alive' : 'DOWN'} on ${st.machine}, heartbeat ${age}s ago` +
      ` · express ${st.express?.busy ? 'busy: ' + st.express.working : 'idle'}` +
      ` · command ${st.command?.busy ? 'busy: ' + st.command.working : 'idle'}`);
    if (age > 120) console.log('⚠ heartbeat is stale — the runner may be down (KW-6). Restart: AI-7600.bat → "Restart runner here".');
  } catch (e) { console.log('FAIL  lane: no runner-status.json — ' + e.message); }
  const q = readdirSync(join(JOBS, 'inbox')).filter((x) => x.startsWith('mclite-'));
  console.log(`mclite jobs queued: ${q.length ? q.join(', ') : 'none'}`);
} else if (cmd === 'run') {
  const i = argv.indexOf('--');
  const tag = argv[1];
  if (!tag || i < 0) { console.log('usage: lane.mjs run <tag> -- <command>'); process.exit(2); }
  const name = submit(tag, argv.slice(i + 1).join(' '));
  console.log(`queued ${name} — the answer is read by the next \`session.mjs start\`. Do not wait for it (D-436).`);
} else if (cmd === 'suite') {
  // D-487 (session 88): the suite always runs the tree AS IT IS, so an older still-QUEUED suite is
  // pure waste — 14 piled up on 22 Sept (~40 min each) and jammed the heavy lane for ~9 hours.
  // A new suite supersedes every queued-not-running one (moved aside, never deleted).
  try {
    let running = null; try { running = JSON.parse(readFileSync(join(JOBS, 'runner-status.json'), 'utf8')).command?.working; } catch {}
    const old = readdirSync(join(JOBS, 'inbox')).filter((x) => /^mclite-\d+-suite\.job\.md$/.test(x) && x !== running);
    if (old.length) { const d = join(JOBS, '_superseded-mclite-suites'); mkdirSync(d, { recursive: true });
      for (const x of old) renameSync(join(JOBS, 'inbox', x), join(d, x));
      console.log(`superseded ${old.length} still-queued suite job(s): ${old.join(', ')}`); }
  } catch (e) { console.log('(could not coalesce queued suites: ' + e.message + ')'); }
  // ⚠ The suite takes the runner's HEAVY lane (`express: false`) so a `push` in the express lane never
  // waits half an hour behind it — found when the first close-out's push queued behind its own suite.
  const name = submit('suite', 'node tools/suite.mjs --preset medium', { timeoutMin: 110, heavy: true,
    note: 'The FULL suite, every browser stage, at Dan\'s preset. Writes .ledger/suite-full.json.' });
  let eta = 1500;
  try { eta = JSON.parse(readFileSync(new URL('../.ledger/suite-full.json', import.meta.url), 'utf8')).seconds || eta; } catch {}
  console.log(`queued ${name} — the full suite on Windows, ETA ~${Math.ceil(eta / 60)} min (last full run).` +
    ` The result lands in .ledger/suite-full.json, which the next \`session.mjs start\` reads.` +
    ` Do not wait for it and do not schedule a wake-up for it (D-436).`);
} else if (cmd === 'push') {
  const name = submit('push', 'git push origin HEAD', { timeoutMin: 5 });
  console.log(`queued ${name} — the runner pushes in its express lane; the next \`session.mjs start\` reports the answer (D-436).`);
} else if (cmd === 'answer') {
  const a = argv[1] ? answerOf(argv[1]) : null;
  console.log(a ? summarise(a) : 'no answer yet — it will be read by the next `session.mjs start`. Do not check again (D-436).');
} else if (cmd === 'answers') {
  // every mclite answer newer than a timestamp — ONE directory read, used by `session.mjs start`
  const since = Number(argv[1]) || 0;
  const done = join(JOBS, 'done');
  const got = readdirSync(done).filter((x) => x.startsWith('mclite-') && x.endsWith('.answer.md'))
    .map((f) => ({ f, t: statSync(join(done, f)).mtimeMs })).filter((x) => x.t > since).sort((a, b) => a.t - b.t);
  for (const { f } of got) {
    const a = clean(readFileSync(join(done, f), 'utf8'));
    const code = (a.match(/\| exit code \| (\S+)/) || [])[1];
    console.log(`${f.replace('.answer.md', '')}: exit ${code ?? '?'}`);
  }
  if (!got.length) console.log('none since the last close');
} else if (cmd === 'wait') {
  console.log('`lane.mjs wait` was removed by D-436 — this project never polls. The next `session.mjs start` reads the answer.');
  process.exit(2);
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 18).join('\n'));
}
