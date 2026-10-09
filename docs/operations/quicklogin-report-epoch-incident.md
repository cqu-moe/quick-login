# 2026-10-09 report epoch recovery

## Evidence and scope

An existing device returned `422 INVALID_REQUEST` after the user installed 0.4.1.
The captured request passed the Auth v3 parser and the derived heartbeat parser.
Its local report epoch differed from the cached server report, while its sequence
was already ahead. Auth's `DeviceV3Store.report` rejects a changed epoch under the
same grant. This rule was reproduced locally and verified unchanged in Auth main
`ac8346f675f8f065759610d6609ba54e7839dcb9`.

Ordinary installation startup does not rotate the epoch. The exact event that
changed this user's local epoch is not established. A separate reproducible race
allows an alarm to reconcile while a replacement grant is being registered,
before the old implementation rotates the epoch at registration completion.

## Required behavior

- Normal upgrade/startup preserves the installation, device, authorization,
  report epoch and monotonically increasing report sequence.
- After a reconcile `INVALID_REQUEST`, try at most one recovery using a parsed
  cached report belonging to the same device and installation. Send a sequence
  greater than both counters, with no receipt or applied-cookie claim. Preserve
  current user intent; never adopt cached enabled/manual intent.
- Adopt the candidate epoch only after the server echoes that epoch and sequence
  in its report. The server's grant/epoch fence remains authoritative. Missing,
  unrelated, rejected or unconfirmed candidates require explicit original-device
  reconnection and stop automatic retries. Transient errors keep normal backoff.
- A concurrent disable, manual takeover or authorization replacement cancels the
  attempt; an old response cannot overwrite current local state.
- Store new OAuth grant tokens and their new epoch in one storage update. Token
  refresh preserves the epoch. Do not synchronize during interactive connection,
  or resend a previous authorization's request under replacement credentials.

## Verification and limits

Regression ownership is the extension's real startup/sync/authentication flow
with a synthetic HTTP boundary. The successful API mocks previously hid the
server's epoch rejection; recovery tests now include the actual problem shape,
server acceptance confirmation and failure-to-reconnect behavior. A delayed
registration and a delayed 401 exercise authorization races.

Keep browser acceptance separate: install the published candidate over the
existing extension, verify reconcile returns 200 and the device ID is preserved,
then verify a school page accepts the session. Automated tests alone do not
establish that this particular browser installation has recovered.
