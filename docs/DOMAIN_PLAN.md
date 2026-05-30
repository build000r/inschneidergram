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
- operator claim, send, skip, and block evidence
- audit entries for approval and operator state changes
- sender account limits, cooldowns, lockouts, reconnect-required state, warm-up
  notes, and risk events
- scheduler refusal when no healthy sender is available

## Acceptance Criteria

1. `POST /campaigns` accepts the bounty-shaped payload and returns a campaign id.
2. Duplicate profile inputs and previously suppressed handles are skipped with
   an inspectable status.
3. Invalid profile inputs are blocked before scheduling.
4. Safe sending defaults assign targets across senders and schedule delays.
5. Provider events update delivery/reply status idempotently.
6. Creator/copy approval gates operator work before send evidence can be logged.
7. Operator workbench items can be claimed, sent, skipped, or blocked with
   evidence.
8. Unhealthy senders are refused before scheduling and reported in campaign
   status.
9. Tests prove the API contract and domain rules.

## Next Domain Slices

### Persistent Campaign Store

Harden the JSON-backed store into durable SQLite/Postgres storage with migration
checks. The current slice already persists campaigns, events, idempotency keys,
and suppression records locally.

### Approval Store and API

Persist approval workbenches and expose routes for candidate decisions, copy
decisions, operator claims, and evidence capture. The domain module is currently
pure TypeScript and ready to be wired to storage/API surfaces.

### Managed Delivery Adapter

Define and implement the adapter that can actually send or queue Instagram
outreach through an owned managed operation. The adapter must expose health,
rate-limit, sender, and incident state.

### Sender Account Operations

Connect real account operations to the current sender-health model: account
inventory, warm-up state, daily budget, cooldowns, lockout detection, recovery
notes, reconnect-required state, and per-account risk scoring now have a domain
shape and scheduler behavior.

### Webhook Delivery

Add outgoing signed webhooks with retries, backoff, dead-letter queue, and replay
tooling.

### Pilot Evidence

Produce a report that proves accepted targets, sent messages, delivery, replies,
skips, duplicate prevention, failures, and operational incidents.

## Validation Commands

```bash
npm test
npm run typecheck
npm run build
```
