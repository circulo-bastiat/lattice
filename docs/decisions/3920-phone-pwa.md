# 3920 - the phone app is a PWA with real Web Push

Supersedes the 28 Sept "IPA, not a PWA" ruling (Dan, 6 Oct 22:16 ET: self-contained, no sideloading). A home-screen web app on iOS 16.4+ gets real push from Apple's relay with no developer account.

- Static site in `tools/phone-web/` (built by `build.mjs`, icons generated, no binaries in git), published to Pages from the public repo `mclite-phone` by `phone-pages.yml` (secret `PHONE_PAGES_TOKEN`; skips until set). No backend: the app calls the GitHub API with the token typed once.
- Sender: `tools/infra/webpush.mjs`, node:crypto only (RFC 8291 + RFC 8292) instead of the `web-push` npm package: no dependency to install in the brain VM, ~50 lines, proven against a fake push service decrypting the payload. VAPID keys in `~/.brain/vapid.json` (0600); the public key is the repo variable `MCLITE_VAPID`.
- Subscriptions: one comment per device on the open issue labelled `push-subs` (`tools/phone-web/subs.js`, keyed by endpoint). `home.mjs notify()` sends to all, deletes comments of endpoints that answer 404/410, and falls back to the ntfy POST when nothing was delivered.
- iOS web push has no action buttons: the deep link rides in `data.url`/`tag`; answers live in the app (steps 2-5 of #3920).
- Proof: `phonewebcheck`.
