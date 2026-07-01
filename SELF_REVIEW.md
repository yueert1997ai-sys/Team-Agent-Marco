# Self-review

## Verification completed

- TypeScript strict compilation passes.
- Nine automated tests pass.
- No external runtime dependencies were added.
- Meeting agents default to read-only access.
- First-round outputs are isolated and run in parallel.
- Second round is targeted to relevant members only.
- Unknown member IDs in moderator routing are removed.
- A member cannot return another member's ID without being rejected.
- One failed member can be tolerated when the configured success threshold is met.
- Reported token usage is checked against the configured soft budget.

## Issues found and fixed during review

1. A two-member council originally required two successful first-round speakers even though the moderator does not speak in round one. The default threshold now uses the actual first-round participant count.
2. Optional `context` conflicted with TypeScript `exactOptionalPropertyTypes`; normalization now omits it when empty.
3. The public index originally did not export the Hanako host API type; it now does.
4. Added member-ID anti-impersonation validation after every member response.

## Known integration gaps

1. OpenHanako's current workflow `agent()` API does not expose a per-call `maxOutputTokens` option. The module keeps this setting for a later host API extension, but the current adapter intentionally does not forward an unsupported field.
2. OpenHanako's hard token ceiling belongs to the outer Workflow UsageLedger (`args.budgetTokens`). The module can enforce reported usage, but the current host adapter cannot read UsageLedger totals. Production integration must create the council inside a budgeted workflow run.
3. UI, persistent meeting storage, and API-key setup are not part of this backend milestone.
4. This package was compiled and tested independently because the complete OpenHanako repository was not available in the execution container. It has not yet passed the full upstream repository test suite.
