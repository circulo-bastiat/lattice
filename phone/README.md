# MC-Lite phone app (#90)

Your iPhone view of the whole system: brain runners, usage, what is running, pull requests, a red master, and the
bus (#53). Send mail to any session, answer multiple-choice questions, start a commander/fixer/worker/chore, and set
how many background workers the brain keeps running. It talks only to GitHub with your token; alerts still come
through ntfy.

## Install (on a PC, once a week with a free Apple ID)
1. Download `MCLite.ipa` from the release **phone-latest**: github.com/owner/mclite/releases/tag/phone-latest
2. Sideloadly: plug in the iPhone, drop the .ipa in, enter your Apple ID, Start.
3. iPhone: Settings → General → VPN & Device Management → trust your Apple ID. (iOS 16+: also turn on Developer Mode.)
4. Open MC-Lite → Settings → paste a GitHub token (the app lists the permissions it needs).

A free Apple ID signature lasts 7 days: re-run step 2 with the same .ipa (the token stays). A paid Apple developer
account ($99/yr) makes it last a year.

## For sessions: asking Dan a question
`node tools/go.mjs say --to dan "Which one?\noptions: A | B | C"` - he gets an ntfy push, the app shows buttons, and
his answer arrives as mail to you (`about: <id>`).

Build: `.github/workflows/ipa.yml` (XcodeGen + xcodebuild on a GitHub macOS runner, unsigned).
