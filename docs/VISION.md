# Vision

## Product Thesis

Instagram creator outreach should be callable like infrastructure. Graphed's
agents should be able to submit a campaign, receive status, and trust that the
messy delivery layer is operated by the product owner.

The bounty is not for a clever automation snippet. It is for a managed
Instagram outreach product with a clear API and enough operational reliability
to support client deployments.

## Multi-Escalated Vision

### Level 1: API Control Plane

Ship a clean campaign API:

- `POST /campaigns`
- target normalization
- duplicate prevention
- safe scheduling
- delivery/reply events
- status inspection
- signed webhook payloads

Proof: tests and local API demo pass.

### Level 2: Pilot-Ready Managed Delivery

Attach a real delivery adapter and operator runbook:

- send intent handoff contract
- adapter risk posture
- sender account inventory
- daily limits and warm-up state
- delivery attempt logs
- sent, failed, restricted, and replied events
- incident notes
- account health checks
- manual override path
- manual proof requirements for operator-verified sends and replies

Proof: a small campaign can be run without Graphed touching Instagram sessions
or browser automation.

### Level 3: Reliability Product

Make delivery resilient:

- persistent storage
- idempotent campaign creation
- replayable events
- webhook retries
- per-sender risk budgets
- duplicate suppression across campaigns
- operational dashboard or CLI

Proof: pilot report shows sent/delivered/replied/failed/skipped counts and a
clear incident trail.

### Level 4: Bounty-Winning Deployment

Run a meaningful Graphed pilot and earn adoption:

- real creator list
- real sender accounts
- measurable campaign completion
- reliable reporting
- post-pilot deployment plan

Proof: Graphed can adopt the product for ongoing client deployments.

## Non-Negotiables

- Do not represent a mock provider as real Instagram delivery.
- Do not claim official cold-DM compliance from this adapter contract.
- Do not force Graphed to host or maintain browser automation.
- Do not hide account risk; model it as product state.
- Do not overfit to one pilot campaign at the expense of repeatable operations.
- Do not claim compliance certainty without evidence from the actual delivery
  path.

## Product Promise

Programmatic, policy-aware Instagram outreach for growth agents: rank who to
contact, generate the safest next action, queue approved sends, and write
outcomes back without scraping, burner accounts, or unsafe cold-DM claims.

## Current Reality

The repo now has the API control plane, persisted local store, sender inventory,
approval workbench, operator manual queue, manual evidence recording,
sender-risk reconciliation for manual restrictions, readiness gates, creator
profile provenance intake, follow-up planning, proof-pack generation, and a
managed-provider execution contract for provider-reported outcomes. Execution
now enforces readiness approval, creator-vetting, sender-health,
pending-manual-evidence, and launch-authorization gates before live manual/provider proof
records are created; late provider replies/failures refresh the latest proof
export plus follow-up plan after the original execution. The service path is also
operator-testable: startup config is validated, `/health` checks the JSON
store, optional API key protection gates non-public routes for exposed
deployments, provider events and non-simulated executions can dispatch signed
webhook callbacks, callback destinations are constrained to public HTTPS hosts
with private-network blocking and optional production allowlists,
`npm run smoke:service` drives the compiled API through real HTTP with auth
enabled, and a Dockerfile packages the runtime store at `/data/campaigns.json`.
Buyers and operators can fetch
`GET /pilot-launch-packet` before campaign creation to see the private input
checklist, creator schema, sender boundary, delivery-path options,
launch-authorization template, proof criteria, stop conditions, sample payload,
and validation commands. After a campaign exists, they can fetch
`GET /campaigns/:id/proof-pack` to review the latest readiness-linked proof
pack without knowing the internal execution id, and
`GET /campaigns/:id/pilot-handoff` turns readiness into a campaign-level
operator packet with missing inputs, next API actions, evidence contracts, proof
URLs, and stop conditions. Execution and proof records preserve the structured
launch authorization reference for manual and managed-provider pilots. The
credential-free manual rehearsal now uses stored
managed senders and strict creator-provenance intake, then proves that
restricted manual evidence writes back into sender cooldown/proof warning state
before the live pilot path substitutes real accounts.

It is not yet bounty-complete because verified provider/account operations, a
vetted Graphed creator list, a real launch authorization reference, and live
pilot evidence remain outside the repo. The next decisive milestone is the
external pilot handoff: choose the real delivery operation, load a vetted
creator list, run low-volume outreach with authorization, and publish the proof
pack.
