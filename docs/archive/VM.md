# VM — the second lane, what it is for, and the one thing it cannot do

*Reference. Not required reading — `node tools/vmcheck.mjs` tells you the live state in one line.*

The VM lives at `C:\Users\user\Downloads\tentativevirtualmachine`: a Hyper-V host bridge with two
guests, `linux` (claude-sandbox, Ubuntu) and `windows` (claude-windows). Jobs are JSON files in
`exchange/inbox/`; **there is no time limit.**

⚠ **It restarts itself at logon, and that is the whole argument for using it.** It survived the
8 September 2026 Windows update that left the ai-jobs runner dead for a week (KW-6).

## Driving it from a session

`bin/vmjob` is a bash script and `device_bash` is bash, so a session drives it directly — no
extra tooling, no second home for the protocol. Verified 16 Sept 2026:

```
cd ~/mnt/tentativevirtualmachine
bash bin/vmjob -t 60 host 'status'          # ← this returned real output in this session
bash bin/vmjob host 'start'                 # start the linux guest
bash bin/vmjob -t 3600 -c /work guest 'node tools/suite.mjs --fast'
bash bin/vmjob push dist/mclite.html /work/mclite.html
bash bin/vmjob pull /work/shot.png exchange/files/shot.png
```

⚠ `bin/vmjob` **waits** for the result, and `device_bash` is capped at 180 s. For anything longer
use `bin/vmsubmit` (queues, prints an id) and `bin/vmresult <id>` (collects later). A long job
that a session waits on is a session spending turns on a sleep.

⚠ **Both guests are usually Off.** A job queued at a stopped guest sits there. Start it first;
`vmcheck` says so when it sees that state.

## 1. The browser stages — the reason this matters most

The six browser stages are the only checks that look at the picture, and they SKIP where there is
no Chromium (KW-3). The guest already has the pieces and they have never been wired to this
project: `guest/agent/install-playwright.sh` and `guest/agent/htmlsmoke.mjs`.

The procedure, once:

```
bash bin/vmjob host  'start'
bash bin/vmjob guest 'bash ~/agent/install-playwright.sh'
bash bin/vmjob push  dist/mclite.html /work/mclite.html
bash bin/vmjob -t 1800 guest 'MCLITE_PRESET=medium node /work/htmlsmoke.mjs /work/mclite.html'
```

⚠⚠ **`MCLITE_PRESET=medium` is not optional.** `detect()` clamps to CELERON on a two-core box, so
five sessions of browser checks ran at render distance 4 with FAST leaves — the one setup where
the flash cannot happen and the fancy leaf path is never drawn (KW-4, D-196). The guest is a
two-core box, so this trap is *guaranteed* here rather than likely.

## 2. The low-end target, on a dial

The ladder is 7600 → 3600 → 2200G → Celeron and **the 2200G is the real target**, which today is
argued rather than measured. The VM is a 2200G-class box on demand:

```
manage.cmd cores 2
manage.cmd ram 4096
```

Turn it up when Dan is away, down when he is playing. A floor you can measure beats a floor you
can describe — and for a project whose whole thesis is "cheap where it is expensive", that is
worth more than any check in `tools/`.

## 3. ⚠⚠ THE THING IT CANNOT DO

**There is no GPU in the guest.** Passthrough was tried and reverted on 9 September 2026 —
`logs/gpu-passthrough-undo-*.log` ends with *"back to the plain synthetic display"*. So:

* the VM measures the **software-rendering floor**, which is a real and useful number;
* it says **nothing** about the black-WebGPU bug (KW-1). That needs one of Dan's actual PCs.

⚠ And a graphics measurement taken over SSH is wrong whatever the hardware: **session 0 has no
desktop and reports software rendering every time.** The VM folder's own agent note records this
— the same check through the desktop-session agent reported full hardware acceleration. There is
an FPS harness already written there (`guest/win-agent/fps-watch.ps1`, `fps-target.ps1`) that
measures **displayed** frames rather than claimed ones: one recorded run reads 164.7 sampled
against **60.3 actually displayed**, with a 109 ms worst gap. That gap is the difference between
"we render 165 fps" and "it stutters", and it is the shape of Dan's *"placing is still low fps"*.

## 4. Worth building, not built

* **A nightly "does it still build and still run"** job with a snapshot before and a rollback
  after. A machine running a check, not a session spending a window.
* **Forgejo in the guest as a git remote Dan owns** — it would end the `.tgz` shuttle for both
  projects permanently (KW-9). A tarball is what a session reaches for when there is no remote.
* **Tailscale** (`guest/agent/install-tailscale.sh`) so the inbox box reaches his phone off-LAN
  (D-366).
