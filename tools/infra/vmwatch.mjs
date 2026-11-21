// tools/infra/vmwatch.mjs - #2702: the host-side watchdog for the brain-runner VM. The brain's health pass runs INSIDE the VM, so
// when the guest loses its network nobody notices (4 Oct 17:00Z-18:30Z). usaged.mjs calls tick() every 5 min on the host.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gh, ghAll, projectsDirs } from './gh.mjs';
import { stalled, climb, rungs as ladderRungs, BEAT_MIN, allCapped } from './ladder.mjs';
import { usageCap, accountWeekCap } from '../brain/route.mjs';   // #5105
import { freeDisk } from './ladderlocal.mjs';
import { sweep } from './autorebase.mjs';
import { homedir } from 'node:os';

const STALL_MS = 45 * 60e3;
export const TICK_MIN = 5, ALL_DOWN_TICKS = 2, PARTIAL_MIN = 15, PARTIAL_OF = 5, COOLDOWN_MIN = 45, MIN_FREE_GB = 8;

/** Pure. s = {allDownTicks, partialSince, lastRestart}; o = {now, online, total, restartPending, freeGB, vmOff}. -> {restart, why, state}. */
export function decide(s, o) {
  const st = { allDownTicks: s.allDownTicks || 0, partialSince: s.partialSince || null, lastRestart: s.lastRestart || null };
  st.allDownTicks = o.online === 0 ? st.allDownTicks + 1 : 0;
  const down = o.total - o.online;
  st.partialSince = o.online > 0 && down >= PARTIAL_OF ? st.partialSince ?? o.now : null;
  const why = st.allDownTicks >= ALL_DOWN_TICKS ? `no brain runner online for ${st.allDownTicks * TICK_MIN} min`
    : st.partialSince !== null && o.now - st.partialSince >= PARTIAL_MIN * 60e3 ? `${down} of ${o.total} brain runners offline for ${PARTIAL_MIN} min` : null;
  if (!why) return { restart: false, state: st };
  if (o.restartPending) return { restart: false, why: 'a restart is already pending', state: st };
  if (o.vmOff) return { restart: false, why: 'the VM is Off', state: st };
  if (o.freeGB !== null && o.freeGB < MIN_FREE_GB) return { restart: false, why: `host has ${o.freeGB.toFixed(1)} GB free`, state: st };
  if (st.lastRestart !== null && o.now - st.lastRestart < COOLDOWN_MIN * 60e3) return { restart: false, why: 'restarted under 45 min ago', state: st };
  return { restart: true, why, state: { allDownTicks: 0, partialSince: null, lastRestart: o.now } };
}

const jobs = () => { const p = projectsDirs().map((d) => join(d, 'tentativevirtualmachine', 'exchange', 'inbox')).find(existsSync); return p || null; };

export async function tick() {
  const inbox = jobs();
  if (!inbox) return { skipped: 'no tentativevirtualmachine/exchange/inbox' };
  const sdir = join(inbox, '..', '..', '..', '_status'), f = join(sdir, 'vmwatch.json');
  let s = {}; try { s = JSON.parse(readFileSync(f, 'utf8')); } catch {}
  const vmBeat = Number((await gh('GET', '/repos/{repo}/actions/variables/BRAIN_HEALTH_AT', null, { ok404: true }).catch(() => null))?.value) || 0;   // #4975: the VM's own beat
  const rs = ((await gh('GET', '/repos/{repo}/actions/runners?per_page=100', null, { ok404: true }).catch(() => null))?.runners || []).filter((r) => r.labels?.some((l) => l.name === 'brain'));
  if (!rs.length) return { skipped: 'no brain runners registered (or GitHub unreachable)' };   // an API failure must not look like "all offline"
  let freeGB = null; try { const t = statfsSync(process.env.SystemDrive ? process.env.SystemDrive + '\\' : '/'); freeGB = (t.bavail * t.bsize) / 1024 ** 3; } catch {}
  const restartPending = readdirSync(inbox).some((n) => n.endsWith('.job') && /"cmd"\s*:\s*"restart"/.test(readFileSync(join(inbox, n), 'utf8')));
  const o_now = Date.now();   // a silent health pass = a dead VM even while its runners still look online
  const r = decide(s, { now: Date.now(), online: vmBeat && o_now - vmBeat > BEAT_MIN * 60e3 ? 0 : rs.filter((x) => x.status === 'online').length, total: rs.length, restartPending, freeGB, vmOff: false });
  mkdirSync(sdir, { recursive: true }); writeFileSync(f, JSON.stringify(r.state));
  const say = (t) => spawnSync(process.execPath, [join(import.meta.dirname, '..', 'go.mjs'), 'say', '--to', 'commander', t], { stdio: 'ignore' });
  const restartVM = () => {
    const j = join(inbox, `watchdog-${Date.now()}.job`);
    writeFileSync(j + '.tmp', JSON.stringify({ target: 'host', cmd: 'restart' })); renameSync(j + '.tmp', j);   // .tmp then rename: the bridge never sees half a job
  };
  if (r.restart) { restartVM(); say('watchdog restarted the VM: ' + r.why); }
  const l = await ladderTick({ sdir, restartVM, restartPending, say }).catch((e) => ({ ladderError: e.message }));
  return { restart: r.restart, why: r.why, ...l };
}

/** #4975: the PC's half of the self-healing ladder (the VM's is the brain health pass). Same symptom, same rungs; GitHub-only inputs, so it
 *  runs with the VM, the hosted runners and the lander all dead. "Restart runner services" here is a VM restart (nothing else of ours runs on the PC). */
async function ladderTick({ sdir, restartVM, restartPending, say }) {
  const now = Date.now(), f = join(sdir, 'ladder.json');
  let st = null; try { st = JSON.parse(readFileSync(f, 'utf8')); } catch {}
  const lastMergeAt = Date.parse((await gh('GET', '/repos/{repo}/commits/master')).commit.committer.date);
  const runs = (await gh('GET', '/repos/{repo}/actions/workflows/brain.yml/runs?per_page=50')).workflow_runs.filter((r) => /^brain (worker|tester)/.test(r.display_title || r.name));
  const lastRunAt = runs.some((r) => r.status === 'in_progress') ? now : Math.max(0, ...runs.map((r) => Date.parse(r.created_at)));
  let claimable = 0; if (now - lastMergeAt >= STALL_MS && now - lastRunAt >= STALL_MS) { const c = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'go.mjs'), 'claimable'], { encoding: 'utf8', timeout: 120e3 }), v = (c.stdout || '').trim().split('\n').pop(); claimable = /^\d+$/.test(v) ? Number(v) : 0; }
  let capped = false; try {   // #5105: every account at its usage cap is the caps' wait, not a stall (11 Oct: the ladder restarted the VM over it)
    const cfg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'brain', 'roles.json'), 'utf8'));
    capped = allCapped(cfg, JSON.parse((await gh('GET', '/repos/{repo}/actions/variables/MCLITE_USAGE', null, { ok404: true }))?.value || 'null'), now, usageCap, accountWeekCap);
  } catch {}
  const r = await climb({ st, now, save: async (s) => { mkdirSync(sdir, { recursive: true }); writeFileSync(f, JSON.stringify(s)); }, isStalled: stalled({ now, lastMergeAt, lastRunAt, claimable, capped }), say, page: (t) => spawnSync(process.execPath, [join(import.meta.dirname, '..', 'go.mjs'), 'say', '--to', 'dan', t], { stdio: 'ignore' }),
    rungs: ladderRungs({ gh, now, sweep: () => sweep({ gh, ghAll, post: async () => {} }),
      local: { freeDisk: freeDisk({ roots: [join(process.env.LOCALAPPDATA || join(homedir(), 'mc-work'), 'mclite-work')], probe: process.env.SystemDrive ? process.env.SystemDrive + '\\' : homedir() }),
        restartRunners: async () => (restartPending ? null : (restartVM(), 'restarted the VM (its runner services)')) } }) });
  mkdirSync(sdir, { recursive: true }); writeFileSync(f, JSON.stringify(r.st));
  return { ladder: r.acted };
}
