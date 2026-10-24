// usagefmt.mjs - #7659: how `go.mjs status` prints the PUBLISHED usage file. usage() returns ONE account (the active one:
// --account / MCLITE_ACCOUNT / _status/active-account.txt, else 'default'), and on a host whose active account is Pro the old
// single line showed Pro's week as if it were Max's (Dan, 15 Oct: "the max week is 67, you confused the accounts").
// So: name the account the first line belongs to, then print EVERY account from u.all. Pure.
export function usageLines(u) {
  if (!u || u.ok === false) return ['usage (published file) UNKNOWN - ' + ((u && u.why) || 'no reading')];
  const out = [`usage (published file), account "${u.account}" (the ACTIVE one, not necessarily Max): week ${u.week?.pct}% (resets ${u.week?.resets_at}), 5h ${u.window?.pct}% (resets ${u.window?.resets_at}), read ${u.readAt || u.at}`];
  for (const [n, s] of Object.entries(u.all || {})) out.push(`  ${n}: ${s}`);
  return out;
}
