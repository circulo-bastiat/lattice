# 9735: a packed pool's no-claim hold travels over the bus

Date: 22 Oct 2026 (commander). Status: in force.

**Problem.** The 20-minute no-claim hold (#1503) is a file, `~/.brain/noclaim-<account>`, written by the worker that found nothing. A worker packed on
the mirror runs on a hosted runner with no `~/.brain`, so the hold never held a mirror pool: about 45 idle starts an hour, each costing 50-100
calls of the one GitHub API pool.

**Decision.** `pack-slot.sh` posts one `noclaim: <account>` line on the private bus per pack job. On every fill pass `fillReserve` turns the newest
such line per pool (the phase lane, `default`, every account) into the same marker file, so the hold logic stays the same.

**Rejected.** A repo variable per pool (more API writes, and a race between packs). Moving the hold into the mirror (the brain decides, not the mirror).

**Guard.** lanereservecheck and packhomecheck.
