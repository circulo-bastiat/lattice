# Sourced after the data step (#6081 fixer, 19 Oct). Referee golden is published by `done --finished` to the `store` BRANCH of the private
# repo (tools/infra/golden.mjs), but the mirror's STORE_URL is the separate data repo, which never gets it: every refcheck added since then
# printed "golden not generated" here and the lander bounced the PR as vacuous. Same token, sibling repo; a failure leaves the old behaviour.
golden_pull() {
  local src="${STORE_URL%mclite-store.git}mclite.git" d="${MCLITE_REFEREE_DIR:-$HOME/.mclite-referee/1.18.2}/golden" t="${RUNNER_TEMP:-/tmp}/gstore"
  git clone -q --depth 1 --branch store "$src" "$t" && mkdir -p "$d" && cp "$t"/golden/*.json "$d"/
}
