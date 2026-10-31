# 7769 - secret hygiene
- `tools/redact.mjs`: one pattern list (ghp_/gho_/ghs_/github_pat_, sk-, private key blocks, x-access-token URLs); `redact()` is applied to every `go.mjs say`/`reply` body before it is written or posted.
- `tools/secretscan.mjs`: `--diff <range>` (added lines) and `--tree`; prints file:line + kind, never the secret. The lander runs `--diff` on every PR (single and batch) and bounces on a hit; mirror `ci.yml` runs `--tree`.
- `.gitignore` + `.stignore`: `_status/_cmd-*`, `_status/tmp*/`.
- Check `secretscancheck` plants each secret kind in a diff, a log line and a bus post.
- NOT done (Dan): delete the three `_status/_cmd-1014-*.mjs` files, rotate the PAT. Bridge log writer is outside this repo (tools/infra has none); it should import `redact`.
