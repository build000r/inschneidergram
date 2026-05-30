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
- Delivery attempt
- Provider event
- Webhook delivery
- Follow-up rule
- Suppression / duplicate key
- Pilot evidence report

## Current Slice

The current implementation covers:

- campaign creation
- message/template validation
- target normalization
- duplicate prevention inside a campaign
- safe per-sender scheduling defaults
- provider event ingestion
- campaign status summaries
- webhook payload signing helpers

## Acceptance Criteria

1. `POST /campaigns` accepts the bounty-shaped payload and returns a campaign id.
2. Duplicate profile inputs are skipped with an inspectable status.
3. Invalid profile inputs are blocked before scheduling.
4. Safe sending defaults assign targets across senders and schedule delays.
5. Provider events update delivery/reply status idempotently.
6. Tests prove the API contract and domain rules.

## Next Domain Slices

### Persistent Campaign Store

Replace in-memory storage with durable SQLite/Postgres storage, idempotency
keys, and migration checks.

### Managed Delivery Adapter

Define and implement the adapter that can actually send or queue Instagram
outreach through an owned managed operation. The adapter must expose health,
rate-limit, sender, and incident state.

### Sender Account Operations

Add account inventory, warm-up state, daily budget, lockout detection, recovery
notes, and per-account risk scoring.

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
