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
- duplicate prevention inside a campaign
- persisted suppression records across campaigns
- idempotent campaign creation
- JSON-backed local campaign storage
- safe per-sender scheduling defaults
- provider event ingestion
- campaign status summaries
- webhook payload signing helpers
- creator approval/rejection state
- first-touch message approval/rejection state
- persisted approval workbench API for creator and copy decisions before
  execution
- operator claim, send, skip, and block evidence
- execution guard that excludes skipped, blocked, or already-sent workbench
  candidates from new send intents
- audit entries for approval and operator state changes
- sender account limits, cooldowns, lockouts, reconnect-required state, warm-up
  notes, and risk events
- non-secret managed sender inventory API with JSON persistence
- sender risk-event append route that updates account state and preserves audit
  history
- campaign creation can use stored sender inventory when inline sender accounts
  are absent and rejects unknown managed sender ids
- scheduler refusal when no healthy sender is available
- outgoing signed webhook payloads and jobs
- retry/backoff, dead-letter, and replay behavior for injected webhook senders
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
- pilot launch readiness report that turns campaign, approval, sender,
  execution, and proof state into pass/fail/warn gates plus next actions
- readiness and execution recheck current stored sender health for campaigns
  created from managed inventory
- hardened OpenAPI contract for the no-credential pilot path, including path
  params, idempotency headers, campaign settings, manual evidence cases, health,
  and webhook signature preview
- one-command manual pilot rehearsal that drives the public API through
  readiness, manual execution, sent/replied/restricted evidence, and proof-pack
  renewal output without credentials

## Acceptance Criteria

1. `POST /campaigns` accepts the bounty-shaped payload and returns a campaign id.
2. Duplicate profile inputs and previously suppressed handles are skipped with
   an inspectable status.
3. Invalid profile inputs are blocked before scheduling.
4. Safe sending defaults assign targets across senders and schedule delays.
5. Provider events update delivery/reply status idempotently.
6. Creator/copy approval gates operator work before send evidence can be logged.
7. Approval workbenches can be persisted, fetched, and reused by execution.
8. Operator workbench items can be claimed, sent, skipped, or blocked with
   evidence.
9. Execution only sends approved candidates whose operator work state is still
   actionable.
10. Unhealthy senders are refused before scheduling and reported in campaign
   status.
11. Outgoing webhooks can be signed, retried, dead-lettered, and replayed.
12. A sample pilot fixture generates proof metrics and a Markdown report,
    including operator skip/block evidence when it exists.
13. Approved campaign execution routes send intents through an injected adapter,
    records events, sends webhooks, and returns proof.
14. `POST /campaigns/:id/executions` exposes the safe execution/proof workflow
    without claiming live Instagram delivery.
15. Execution proof records can be listed and fetched after the run.
16. Manual execution evidence can be recorded idempotently and refreshes the
    stored proof pack without losing concurrent operator updates.
17. Launch readiness can be inspected from one API response before execution,
    during manual evidence collection, and after proof is ready.
18. OpenAPI documents the runtime pilot contract closely enough for a local
    operator to run the no-credential manual flow without guessing schemas.
19. A one-command manual rehearsal proves the operator-run pilot path still
    works before real sender/list inputs are available.
20. Managed sender accounts can be registered, fetched, listed, health-checked,
    and updated through risk events.
21. Campaign creation uses stored sender inventory when inline sender accounts
    are absent and rejects unknown managed sender ids.
22. Operators can list pending and completed manual delivery work with stable
    intent ids and required evidence fields.
23. Tests prove the API contract and domain rules.

## Next Domain Slices

### Persistent Campaign Store

Harden the JSON-backed store into durable SQLite/Postgres storage with migration
checks. The current slice already persists campaigns, events, idempotency keys,
and suppression records locally.

### Approval Store and API

Persist approval workbenches and expose routes for candidate decisions, copy
decisions, operator claims, and evidence capture. The current API now persists
approval workbenches, exposes candidate/copy decision routes, persists operator
claim plus skip/block state, and lets execution reuse stored approvals while
excluding non-actionable candidates. Workbench-native sent evidence remains
domain-only; manual execution evidence is currently handled through the
execution `manual-events` API.

### Managed Delivery Adapter

Define and implement the adapter that can actually send or queue Instagram
outreach through an owned managed operation. The adapter must expose health,
rate-limit, sender, and incident state. The first live-pilot path is documented
in [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md): operator-run managed manual delivery
with private sender inventory and explicit evidence capture.

### Pilot Launch Readiness

Expose a campaign-level readiness report so Graphed or the operator can see
what is missing before a pilot runs. The current API reports creator intake,
sender health, approval workbench, creator approval, copy approval, execution
proof, and manual evidence gates, then names next actions and external inputs.
This keeps the live-pilot blocker explicit while sender credentials, creator
lists, and permission remain outside the repo.

### Execution Runner

Connect the current runner to persistent stores and API routes. The domain
runner already creates approved send intents, routes through an injected
adapter, records delivery/reply/restricted/failed events, dispatches outgoing
webhooks, and feeds the proof-pack generator. The API now exposes a safe
`POST /campaigns/:id/executions` workflow for mock/manual pilot dry runs and
persists execution proof records for later inspection. Manual execution records
can be updated through
`POST /campaigns/:id/executions/:executionId/manual-events`, which turns
operator evidence into campaign events, webhook records, and refreshed proof
metrics.

The refreshed proof pack keeps campaign ingest/policy blocks separate from
operator skipped and operator blocked targets captured in the approval
workbench.

The operator manual queue is a read model over execution delivery attempts. It
defaults to pending initial manual evidence from the latest manual execution per
campaign and can also show reply monitoring or terminal attempts for audit.

### Sender Account Operations

The current API now persists non-secret sender inventory, exposes account
health, appends risk events, and uses that stored inventory for campaign
scheduling when inline sender accounts are absent. Real account credentials,
session recovery, provider liveness, and automated cooldown detection remain
outside the repo and must be connected before a live pilot.

### Webhook Delivery

Wire the current outgoing webhook dispatcher into campaign creation and provider
event writes. Signed payloads, retries, backoff, dead-letter state, and replay
tooling now exist as a domain module with injected sender tests.

### Pilot Evidence

Wire the current proof-pack generator to stored campaign, approval, delivery,
webhook, and incident data. The domain module already produces accepted targets,
sent messages, delivery, replies, qualified replies, opt-outs, complaints,
duplicate prevention, failures, sender health, incidents, and a renewal
recommendation from a sample fixture.

It now reports explicit operator skipped/blocked targets from workbench
evidence without conflating those with campaign policy blocks or approval
rejections.

## Validation Commands

```bash
npm test
npm run typecheck
npm run build
```
