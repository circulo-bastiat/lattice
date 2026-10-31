# #7856 - no git popups on Dan's PC

Cause: Git Credential Manager stores the `x-access-token` user of our token URLs as a second GitHub account, then shows "Select an account" on any plain github.com git call.

Ruling: every automated git call that can touch a remote goes through `tools/infra/gitenv.mjs`: `-c credential.helper=` (no helper, nothing stored), `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `GIT_ASKPASS=echo`. Tokens go in an `http.extraheader`, never in a URL (deploy.mjs fixed). Failures print one `GIT-FAULT` line without the token. Workflows on the PC runners (relay, phone-pages) and the mirror CI carry the same. `gitnopopupcheck` fails on any new raw remote git call.
`GCM_INTERACTIVE=never` is unverified against GCM docs here; with the helper emptied GCM is never reached, so it is belt and braces.
Not done: the lander does not yet mail the fixer on a GIT-FAULT (fault line is printed; wiring is a follow-up).

## Clean-up for Dan / commander (Windows only)
1. Control Panel > Credential Manager > Windows Credentials: remove `git:https://github.com` / `git:https://x-access-token@github.com` entries (and any for the mirror token).
2. Or: `git credential-manager github list`, then `git credential-manager github logout x-access-token`.
