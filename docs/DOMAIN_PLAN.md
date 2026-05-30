# Domain Plan: Campaign API to Managed Instagram Outreach

## Slice Name

`instagram_creator_outreach_pilot`

## Business Value

Let Graphed submit creator outreach campaigns through one API call and receive
delivery/reply evidence without operating Instagram automation themselves.

## Domain Objects

- Campaign
- Target
- Sender account
- Sender health
- Sender risk event
- Delivery attempt
- Provider event
- Webhook delivery
- Follow-up rule
- Suppression / duplicate key
- Creator approval
- Message approval
- Operator workbench item
- Operator evidence
- Audit entry
- Pilot evidence report

## Current Slice

The current implementation covers:

- campaign creation
- message/template validation
- target normalization
- creator profile object intake with preserved source, fit rationale, tags, and
  optional audience metrics
- opt-in campaign setting that blocks targets without provenance and fit
  rationale before scheduling
- duplicate prevention inside a campaign
- persisted suppression records across campaigns
- idempotent campaign creation
- JSON-backed local campaign storage
- safe per-sender scheduling defaults
- provider event ingestion
- late provider reply/failure ingestion refreshes the latest execution proof
  pack and follow-up evidence after the original execution has completed
- campaign status summaries
- webhook payload signing helpers
- creator approval/rejection state
- first-touch message approval/rejection state
- persisted approval workbench API for creator and copy decisions before
  execution
- operator claim, send, skip, and block evidence
- execution guard that excludes skipped, blocked, or already-sent workbench
  candidates from new send intents
- execution guard that refuses another run while manual evidence is pending
  from the latest manual execution
- audit entries for approval and operator state changes
- sender account limits, cooldowns, lockouts, reconnect-required state, warm-up
  notes, and risk events
- non-secret managed sender inventory API with JSON persistence
- sender risk-event append route that updates account state and preserves audit
  history
- manual `restricted` evidence reconciliation that appends a managed sender
  restriction risk event, refreshes proof metrics, and blocks later execution
  while the sender is cooling down
- campaign creation can use stored sender inventory when inline sender accounts
  are absent and rejects unknown managed sender ids
- scheduler refusal when no healthy sender is available
- outgoing signed webhook payloads and jobs
- retry/backoff, dead-letter, and replay behavior for injected webhook senders
- runtime callback dispatch from provider event ingestion when a campaign has
  `settings.webhookUrl`
- non-simulated executions route proof webhook deliveries through the runtime
  webhook sender instead of the local simulator
- operator routes list dead-lettered webhooks and replay one failed delivery
- operator dashboard route that aggregates campaign readiness, manual queue
  counts, sender health, follow-up counts, latest proof metrics, renewal
  decisions, runtime dead-letter counts, urgent actions, and source URLs
- webhook destination policy that requires public HTTPS callback URLs, rejects
  localhost/private/special-use destinations, supports an explicit host
  allowlist, blocks private DNS answers before real sends, and guards both
  campaign creation and runtime dispatch
- pilot proof-pack metrics, operator skip/block evidence, incidents, sender
  health, reply assessment, and renewal recommendation
- execution runner that connects approval, delivery adapter events, outgoing
  webhooks, and proof-pack generation
- API pilot-demo execution route for safe mock/manual runs
- persisted execution proof records for audit replay after the initial response
- operator manual delivery queue that projects pending, reply-monitoring, and
  terminal manual attempts without exposing raw execution internals
- manual evidence recording API that validates operator evidence, updates
  campaign state, appends webhook delivery records, and refreshes proof packs
- store-level campaign/execution mutation for manual evidence so concurrent
  operator submissions do not overwrite each other
- follow-up plan API that derives due and pending operator work from
  `settings.followUps` plus latest execution evidence without scheduling
  follow-ups for replied, failed, restricted, duplicate, or policy-blocked
  targets
- managed-provider execution contract that accepts explicit provider-reported
  outcomes for every approved executable target and records sent, replied,
  failed, or restricted events into campaign status, webhooks, and proof packs
- execution route rejects campaigns that still fail readiness approval or
  sender-health or launch-authorization gates instead of synthesizing proof
  records for unapproved pilots
- pre-campaign pilot launch packet that names the private input contract,
  route map, creator schema, sender credential boundary, delivery-path options,
  launch-authorization template, proof criteria, stop conditions, and validation
  commands before Graphed submits a campaign
- pilot launch readiness report that turns campaign, approval, sender,
  creator vetting, launch authorization, execution, and proof state into
  pass/fail/warn gates plus next actions
- pilot handoff packet that turns readiness, missing external inputs, source
  URLs, next API actions, creator/sender/evidence contracts, stop conditions,
  follow-up state, and proof context into one campaign-level operator surface
- latest proof export route that returns the most recent proof pack, readiness,
  metrics, renewal recommendation, source URLs, and Markdown from one
  campaign-level API call, with late provider replies/failures folded into the
  latest execution proof before export
- readiness and execution recheck current stored sender health for campaigns
  created from managed inventory
- hardened OpenAPI contract for the no-credential pilot path, including path
  params, idempotency headers, campaign settings, manual evidence cases, health,
  and webhook signature preview
- one-command manual pilot rehearsal that drives the public API through
  managed sender registration, strict creator-provenance intake, readiness,
  manual execution, sent/replied/restricted evidence, sender-risk cooldown
  reconciliation, and proof-pack renewal output without credentials
- runtime configuration validation for host, port, provider, store path, and
  webhook secret
- `/health` reports JSON store readiness instead of only process liveness
- one-command service smoke that starts the built API process with an isolated
  store and proves the approval-to-provider-execution, manual evidence, and
  operator dashboard paths
- Docker packaging for the API with `/data/campaigns.json` as the default
  durable store path
- optional API key protection for network-exposed deployments, leaving
  `/health`, `/openapi.json`, and CORS preflight public while protecting
  campaign, sender, execution, proof, manual queue, and webhook preview routes

## Acceptance Criteria

1. `POST /campaigns` accepts the bounty-shaped payload and returns a campaign id.
2. Duplicate profile inputs and previously suppressed handles are skipped with
   an inspectable status.
3. Invalid profile inputs are blocked before scheduling.
4. Creator profile evidence is preserved on targets and strict campaigns can
   require source plus fit rationale before scheduling.
5. Safe sending defaults assign targets across senders and schedule delays.
6. Provider events update delivery/reply status idempotently.
7. Creator/copy approval gates operator work before send evidence can be logged.
8. Approval workbenches can be persisted, fetched, and reused by execution.
9. Operator workbench items can be claimed, sent, skipped, or blocked with
   evidence.
10. Execution only sends approved candidates whose operator work state is still
   actionable.
11. Unhealthy senders are refused before scheduling and reported in campaign
   status.
12. Outgoing webhooks can be signed, retried, dead-lettered, and replayed.
13. A sample pilot fixture generates proof metrics and a Markdown report,
    including operator skip/block evidence when it exists.
14. Approved campaign execution routes send intents through an injected adapter,
    records events, sends webhooks, and returns proof.
15. `POST /campaigns/:id/executions` exposes the safe execution/proof workflow
    without claiming live Instagram delivery.
16. Execution proof records can be listed and fetched after the run.
17. Manual execution evidence can be recorded idempotently and refreshes the
    stored proof pack without losing concurrent operator updates.
18. Pre-campaign launch requirements can be fetched before private inputs are
    submitted, including the creator schema, sender boundary, delivery path,
    authorization template, proof metrics, stop conditions, and validation
    commands.
19. Launch readiness can be inspected from one API response before execution,
    during manual evidence collection, and after proof is ready.
20. Operators and evaluators can fetch one pilot handoff packet that names the
    missing external inputs, next API actions, evidence contracts, source URLs,
    stop conditions, and proof-review state for a campaign.
21. Manual and managed-provider executions require structured launch
    authorization with actor, delivery path, approved target limit, approval
    timestamp, and reference; proof exports preserve that authorization.
22. Follow-up work can be inspected after execution with due/pending counts,
    sequence, message, sender, target, and preserved creator provenance.
23. OpenAPI documents the runtime pilot contract closely enough for a local
    operator to run the no-credential manual flow without guessing schemas.
24. A one-command manual rehearsal proves the operator-run pilot path,
    strict creator-provenance gate, and managed sender-risk reconciliation
    still work before real sender/list inputs are available.
25. Managed sender accounts can be registered, fetched, listed, health-checked,
    and updated through risk events.
26. Manual restriction evidence updates managed sender risk state, proof
    sender-warning metrics, readiness, and subsequent execution gates.
27. Campaign creation uses stored sender inventory when inline sender accounts
    are absent and rejects unknown managed sender ids.
28. Operators can list pending and completed manual delivery work with stable
    intent ids and required evidence fields.
29. Managed-provider executions require explicit outcomes for all approved
    executable targets and reject duplicate, missing, or unknown outcome
    targets.
30. Executions cannot create proof records while approval readiness gates still
    fail.
31. Executions cannot create duplicate manual queues while pending manual
    evidence remains unresolved.
32. Buyers/operators can export the latest proof pack and readiness context
    without knowing which execution id to inspect.
33. The built service can be smoke-tested through real HTTP with an isolated
    JSON store.
34. Public service deployments can require `X-API-Key` or bearer credentials
    without breaking local default-open demos.
35. Provider event ingestion, non-simulated executions, and manual evidence
    dispatch signed webhook callbacks through the runtime sender by default.
36. Late provider replies and failures refresh the latest execution proof pack
    and suppress stale follow-up work.
37. Operators can inspect and replay dead-lettered callback deliveries.
38. Network-exposed deployments reject unsafe webhook destinations before
    storing campaigns and before dispatching legacy callback records.
39. Tests prove the API contract and domain rules.

## Delivered Domain Slices

The repo-local API/control-plane slices that were formerly "next" are now
delivered at MVP proof level:

- campaign API and duplicate-safe scheduling
- JSON-backed local store with idempotency and suppression records
- approval workbench and operator state APIs
- sender inventory, health, risk events, and manual restriction reconciliation
- execution readiness gates, pending-manual-evidence guard, and launch
  authorization
- manual delivery queue plus timestamped manual evidence recording
- managed-provider outcome contract
- proof-pack generation, campaign-level proof export, and follow-up planning
- runtime webhooks, dead-letter listing/replay, callback destination guard, and
  DNS-pinned dispatch
- pre-campaign launch packet and pilot handoff packet
- cross-campaign operator dashboard
- service smoke for managed-provider and manual paths
- Docker/runtime config, health checks, and strong API/webhook secret gate

## Remaining Before Bounty

The remaining bounty blockers are external operation and evidence gates, not
more local API shape:

1. Select and provision the live delivery operation: operator-run managed
   manual sender or a real managed provider behind the existing adapter
   contract.
2. Obtain private sender/provider access, a vetted Graphed creator list, the
   Graphed callback endpoint, and explicit launch authorization.
3. Run one low-volume real pilot through the existing manual or
   managed-provider execution route.
4. Record real sent, replied, failed, restricted, and incident evidence; replay
   any dead-letter webhooks before publishing proof.
5. Publish `GET /campaigns/:id/proof-pack` from real pilot records.
6. Publish the project-status MMDX public Buildooor short link.

SQLite/Postgres persistence, an operator UI, automated cooldown detection, and
monitoring are production hardening. They can improve adoption after the pilot,
but they do not replace the live delivery/proof gate that decides the bounty.

## Domain Detail Notes

### Managed Delivery Adapter

Define and implement the adapter that can actually send or queue Instagram
outreach through an owned managed operation. The domain and API now expose a
managed-provider contract surface: callers provide provider-reported outcomes,
account risk ownership, and delivery events, and the execution runner records
those events into status, webhooks, and proof packs without claiming official
cold-DM compliance. A live provider still must expose health, rate-limit,
sender, and incident state before this becomes real delivery.

The first live-pilot path is documented in [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md):
operator-run managed manual delivery with private sender inventory and explicit
evidence capture.

### Pilot Launch Readiness

Expose a campaign-level readiness report so Graphed or the operator can see
what is missing before a pilot runs. The current API reports creator intake,
sender health, approval workbench, creator approval, copy approval, launch
authorization, execution proof, and manual evidence gates, then names next
actions and external inputs. This keeps the live-pilot blocker explicit while
sender credentials, creator lists, and the real authorization reference remain
outside the repo.

`GET /campaigns/:id/pilot-handoff` builds on readiness by returning one
operator/evaluator packet with missing external inputs, source URLs, next API
actions, creator and sender contracts, launch-authorization requirements,
manual evidence requirements,
managed-provider expectations, proof criteria, stop conditions, follow-up state,
and latest execution context. It is the campaign-level bridge from local product
state to a real pilot handoff.

### Execution Runner

Connect the current runner to persistent stores and API routes. The domain
runner already creates approved send intents, routes through an injected
adapter, records delivery/reply/restricted/failed events, dispatches outgoing
webhooks, and feeds the proof-pack generator. The API now exposes a safe
`POST /campaigns/:id/executions` workflow for mock, manual, and
provider-reported managed-provider runs, then persists execution proof records
for later inspection. Manual execution records can be updated through
`POST /campaigns/:id/executions/:executionId/manual-events`, which turns
operator evidence into campaign events, webhook records, and refreshed proof
metrics.

`GET /campaigns/:id/proof-pack` is the buyer-facing proof export. It selects the
latest execution, attaches readiness and source URLs, and returns metrics,
renewal recommendation, and the Markdown report without requiring the caller to
discover an execution id first. Provider replies or failures recorded after the
execution refresh the latest stored proof pack before export, so the campaign
level report does not lag behind provider callbacks.

`GET /campaigns/:id/follow-ups` is the operator follow-up plan. It uses the
campaign's configured follow-up rules and latest execution evidence to expose
only follow-ups that still make sense: sent creators with no reply, failure, or
restriction. Late provider replies and failures update that latest execution
evidence and remove the affected target from follow-up work. The latest proof
export includes the same plan and a
`source.followUpsUrl` pointer.

The refreshed proof pack keeps campaign ingest/policy blocks separate from
operator skipped and operator blocked targets captured in the approval
workbench, and it now includes a vetted target count from creator profile
source plus fit rationale.

The operator manual queue is a read model over execution delivery attempts. It
defaults to pending initial manual evidence from the latest manual execution per
campaign and can also show reply monitoring or terminal attempts for audit.

The operator dashboard is a thin aggregation surface over existing read models,
not a new state store. It gives Graphed or an operator one API call for
readiness distribution, latest manual queue counts, sender-health blockers,
runtime webhook dead letters, due follow-ups, latest proof metrics, renewal
decisions, urgent actions, and source URLs. Runtime dead letters are intentionally
reported separately from persisted proof metrics because only the in-memory
runtime dispatcher can replay them.

### Sender Account Operations

The current API now persists non-secret sender inventory, exposes account
health, appends risk events, and uses that stored inventory for campaign
scheduling when inline sender accounts are absent. Real account credentials,
session recovery, provider liveness, and automated cooldown detection remain
outside the repo and must be connected before a live pilot.

Manual restricted evidence now reconciles into the same managed sender risk
model when the sender came from stored inventory. That keeps proof-pack sender
warning counts and readiness/execution gates aligned with operator stop
conditions.

### Webhook Delivery

The current outgoing webhook dispatcher is wired into provider event writes,
non-simulated executions, and manual evidence by default. Manual rehearsal
simulation is explicit through `simulateWebhookDelivery=true`; otherwise proof
packs count real runtime webhook delivery or dead-letter records. Signed
payloads, retries, backoff, dead-letter state, dead-letter listing, and replay
tooling now exist with injected sender tests.
Campaign creation still does not emit a `campaign.created` callback; the
highest-value callback path for the Graphed pilot is delivery/reply event
status. Callback URLs are now a deployment policy surface: public HTTPS is
required, local/private/special-use destinations are blocked, production
allowlists narrow callback hosts, and legacy stored URLs are rechecked before
dispatch or dead-letter replay.

### Pilot Evidence

Wire the current proof-pack generator to stored campaign, approval, delivery,
webhook, and incident data. The domain module already produces accepted targets,
sent messages, delivery, replies, qualified replies, opt-outs, complaints,
duplicate prevention, failures, sender health, incidents, and a renewal
recommendation from a sample fixture.

It now reports explicit operator skipped/blocked targets from workbench
evidence without conflating those with campaign policy blocks or approval
rejections.

The API now exports the latest stored proof pack at campaign level for buyer or
operator review. A live pilot still needs real provider/account inputs before
that export can be treated as live Instagram evidence.

## Validation Commands

```bash
npm test
npm run typecheck
npm run build
npm run smoke:service
```
