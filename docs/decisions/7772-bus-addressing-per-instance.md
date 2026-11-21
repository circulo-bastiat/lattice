# #7772 Bus addressing: one address per session instance

- The launcher sets `MCLITE_WHO=<role>-<k>` for an enlarger (k from `slice k of 3` in the reason). roles.json `who` stays `enlarger`.
- `addresses()` adds the base role to an instance (`enlarger-2` also hears `enlarger`). `to: enlarger-2` is direct mail to one instance.
- `to: enlarger` is a broadcast (`isRoleBroadcast`): it never gates unless `reply: required` or `type: reply|urgent`.
- The commander prompt mails each slice to `enlarger-1/2/3`. Check: `tools/busaddresscheck.mjs`.
- Not changed: `to: all` + `type: urgent` still gates everyone, by design. Worker sessions already have `#N` / branch addresses.
