# Local Bounty Proof Receipt

This is the compact, credential-free receipt for the local Inschneidergram
control plane. It records fixture and simulation proof only: no Instagram
credentials were used, no creator was contacted, and no live or provider
delivery is claimed.

## Validation receipt

- Observed: `2026-08-13T01:20Z`
- Source revision: `f9d0de20c80beeef1d8482622480fbcf0a4fbdc9`
- Runtime: Node `v22.22.0`, npm `10.9.4`
- `npm test`: passed, 17 files and 171 tests
- `npm run typecheck`: passed
- `git diff --check`: passed

`npm run proof:bounty-local` is the single aggregate command. On this orb its
typecheck, tests, build, intake validation and rehearsal, provider bridge,
service smoke, manual rehearsal, and mock demo all passed. The aggregate then
stopped at `npm run status:mmdx:preflight` because its external local `mmd.py`
tool was not installed. Docker was unavailable, so the default proof correctly
skipped Docker smoke. MMDX and Docker are unverified in this receipt and are not
claimed as passed.

## What the commands prove

| Exact command | Local evidence |
| --- | --- |
| `npm run proof:bounty-local` | Runs the complete credential-free gate: typecheck, tests, build, both intake checks, provider bridge, service smoke, manual and mock demos, status preflight, and status dry-run. Docker is intentionally opt-in. |
| `npm run pilot:intake:validate` | Validates the campaign, creator provenance, sender selection, fresh launch authorization, and guarded HTTPS callback contract. The checked example scheduled three targets on one manual sender. |
| `npm run pilot:intake:rehearse` | Creates sender, campaign, approval, authorization, manual execution, dashboard, and queue state through the API, then stops at `awaiting_manual_evidence` with three pending items rather than inventing delivery proof. |
| `npm run pilot:provider-bridge` | Exports three approved fixture send intents, validates three evidence-bearing fixture outcomes, reaches `evidence_ready`, and emits a canonical `proof-packet/v1` SHA-256. It proves the adapter contract, not a live provider connection. |
| `npm run smoke:service` | Starts the built service with an isolated JSON store and API key, checks health and all 29 OpenAPI paths, exercises provider and manual execution paths, verifies the operator dashboard, and exports a canonical proof packet. |
| `npm run demo:manual-pilot` | Exercises strict creator provenance, human evidence, sender cooldown, callbacks, readiness, and proof metrics with `officialColdDmCompliance: "not_claimed"`. |
| `npm run demo:pilot` | Produces a deterministic mock proof pack and renewal recommendation without external accounts. |
| `npm run proof:bounty-local:docker` | When Docker is available, adds image build/start, health, OpenAPI, API-auth, launch-packet, and persistent `/data` checks. Not run for this receipt because this orb has no Docker executable. |

## Proof surfaces

After an execution, `GET /campaigns/:id/proof-pack` returns the latest metrics,
sender health, incidents, reply assessments, webhook outcomes, renewal decision,
Markdown report, and its embedded canonical packet. `GET
/campaigns/:id/proof-packet` returns the redacted stable `proof-packet/v1` with
the execution and evidence references plus `canonicalSha256`; `GET
/campaigns/:id/executions` preserves the underlying execution records.

The intake rehearsal exposes those URLs but deliberately creates no proof pack
while operator evidence is pending. The provider, service, manual, and mock
rehearsals exercise proof generation using explicit fixtures or simulation.
These surfaces are therefore local control-plane proof, not evidence of a live
Instagram send.
