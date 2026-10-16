#!/usr/bin/env bash
# vm-setup.sh - turn the Ubuntu sandbox VM (claude-sandbox) into the brain's home (#86). Run INSIDE the VM as the
# `claude` user (it sudo's what it must). Idempotent: run it again any time. Needs ~/brain-secrets/ pushed first:
#   github-token, tokens/<account>.txt (claude setup-token output; MAKE-BRAIN-TOKEN.cmd makes them)
# Installs Node 22, git, Claude Code, and N GitHub runners (label `brain`) as systemd services.
set -euo pipefail
N=${BRAIN_RUNNERS:-6}   # 4 fill workers + routing/health + a commander
REPO=owner/mclite; VER=${RUNNER_VERSION:-2.337.0}
say(){ echo "== $*"; }
# sudo without a prompt: NOPASSWD if the guest has it, else the guest password BRAIN-SETUP pushed (deleted at the end)
sudo(){ if command sudo -n true 2>/dev/null; then command sudo "$@"; else command sudo -S -p '' "$@" < ~/brain-secrets/sudo-pass; fi; }
[ "$(id -u)" = 0 ] && { echo "run as the claude user, not root (Claude Code refuses bypassPermissions as root)"; exit 1; }

say packages
if ! node -v 2>/dev/null | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y nodejs >/dev/null
fi
sudo apt-get install -y git curl jq >/dev/null
command -v claude >/dev/null || sudo npm install -g @anthropic-ai/claude-code >/dev/null
node -v; claude --version

say secrets
mkdir -p ~/.brain/tokens ~/.brain/logs && chmod 700 ~/.brain
S=~/brain-secrets
[ -f $S/github-token ] && install -m 600 $S/github-token ~/.brain/github-token
for f in $S/tokens/*.txt; do [ -f "$f" ] && install -m 600 "$f" ~/.brain/tokens/; done
[ -f ~/.brain/ntfy-topic ] || echo "mclite-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')" > ~/.brain/ntfy-topic
[ -f ~/.brain/github-token ] || { echo "MISSING ~/.brain/github-token"; exit 1; }
ls ~/.brain/tokens | sed 's/^/token: /' || true
# git over HTTPS as the PAT: bootstrap clones the private mclite-store (18:37Z 28 Sept: 4 workers died asking for a username)
git config --global url."https://x-access-token:$(cat ~/.brain/github-token)@github.com/".insteadOf "https://github.com/"

say runners x$N
GT=$(cat ~/.brain/github-token)
for i in $(seq 1 $N); do
  D=~/runners/brain-$i
  if [ -f $D/.runner ]; then echo "brain-$i already registered"; continue; fi
  mkdir -p $D && cd $D
  [ -f run.sh ] || curl -fsSL "https://github.com/actions/runner/releases/download/v$VER/actions-runner-linux-x64-$VER.tar.gz" | tar xz
  RT=$(curl -fsS -X POST -H "Authorization: Bearer $GT" "https://api.github.com/repos/$REPO/actions/runners/registration-token" | jq -r .token)
  ./config.sh --unattended --url "https://github.com/$REPO" --token "$RT" --name "brain-$i" --labels brain --work _work --replace
  sudo ./svc.sh install "$(whoami)" && sudo ./svc.sh start
done

# #126: 22:08Z 28 Sept the kernel OOM-killed one job's node child in brain-1 and brain-4; systemd's default OOMPolicy=stop
# then stopped the whole unit, and svc.sh writes no Restart=, so both runners stayed offline until a root restart.
# continue = only the job dies; Restart=always = a runner that exits anyway comes back. Also heals a runner already down.
say runner units
for i in $(seq 1 $N); do
  U=actions.runner.${REPO/\//-}.brain-$i.service
  [ -f /etc/systemd/system/$U ] || continue
  printf '[Service]\nOOMPolicy=continue\nRestart=always\nRestartSec=30\n' | sudo install -D -m 644 /dev/stdin /etc/systemd/system/$U.d/restart.conf
  sudo systemctl daemon-reload
  systemctl is-active -q $U || { echo "restarting $U"; sudo systemctl restart $U; }
done
rm -rf $S                                                # secrets live only in ~/.brain (mode 600) from here on
say done
echo "ntfy topic (subscribe in the ntfy app): $(cat ~/.brain/ntfy-topic)"
