# Pilot Runbook: Managed Delivery Path

## Selected Path

For the first Graphed pilot, use **operator-run managed manual delivery**.

This means Inschneidergram owns the campaign API, approval workflow, sender
health model, delivery handoff, status reporting, webhooks, and proof pack. A
human operator performs or verifies the Instagram action through the selected
sender account and records evidence back into the system.

## Why This Path Wins the First Pilot

- It satisfies the managed-product requirement without asking Graphed to host
  browser automation or Instagram sessions.
- It keeps account risk visible: the operator owns sender-account health,
  cooldowns, restrictions, reconnects, and incident logging.
- It can produce real pilot evidence at low volume before investing in a
  deeper provider automation integration.
- It avoids claiming official cold-DM compliance. The adapter risk posture is
  explicitly `officialColdDmCompliance: "not_claimed"`.

## Deferred Path

The managed-provider adapter remains the expansion path after the first pilot.
It should only be activated when the provider/account owner can produce the
same evidence contract: sent, failed, restricted, replied, account-health
events, webhook delivery, and proof-pack records.

## Sender Accounts

No credentials belong in this repo.

For the first pilot, maintain credentials, recovery secrets, proxies, and
session material outside git and outside the Inschneidergram JSON store. Persist
only the non-secret operational inventory through the sender API:

| Field | Requirement |
| --- | --- |
| sender id | Stable id used in campaign settings and send intents |
| risk owner | Operator, not Graphed |
| daily limit | Start at 10-20 first-touch sends per sender until evidence says otherwise |
| delay window | Keep the current 90-420 second default unless operator lowers volume |
| warm-up note | Human-readable account maturity and caveats |
| status | `healthy`, `cooldown`, `locked`, or `reconnect_required` |
| risk events | Warnings, restrictions, lockouts, reconnects, and manual notes |

Useful local calls:

```bash
curl -s http://127.0.0.1:3107/senders/sender-a \
  -X PUT \
  -H 'content-type: application/json' \
  -d '{ "status": "healthy", "dailyLimit": 20, "warmupNote": "low-volume pilot" }'

curl -s http://127.0.0.1:3107/senders

curl -s http://127.0.0.1:3107/senders/sender-a/risk-events \
  -X POST \
  -H 'content-type: application/json' \
  -d '{ "kind": "restriction", "note": "Temporary send warning from operator" }'
```

## Pilot Flow

1. Operator registers non-secret sender inventory with `PUT /senders/:id`.
2. Graphed submits `POST /campaigns` with vetted creator targets, offer,
   message copy, sender constraints, and webhook URL. If inline
   `settings.senderAccounts` is omitted, the API uses stored sender inventory
   and rejects unknown sender ids.
3. Operator or approver creates `POST /campaigns/:id/approval-workbench` and
   persists creator plus first-touch copy decisions.
4. Operator claims approved creators and marks any non-actionable creators
   skipped or blocked before execution.
5. Graphed or the operator checks `GET /campaigns/:id/readiness` to confirm the
   campaign is ready to execute or to see the remaining external inputs.
6. Execution runner rechecks current sender health, then creates `SendIntent`
   records only for approved creators that remain queued or claimed.
7. Delivery adapter returns sent, failed, restricted, replied, or
   `needs_manual_evidence`.
8. Operator performs or verifies manual sends outside the codebase when the
   adapter requires human evidence.
9. Operator records sent, failed, restricted, or replied evidence through
   `POST /campaigns/:id/executions/:executionId/manual-events` with an
   `Idempotency-Key` for retry safety.
10. Campaign events update status and outgoing webhooks notify Graphed.
11. Execution proof record is persisted for audit replay.
12. Proof-pack generator produces the renewal report with operator skipped and
    blocked counts from workbench evidence.

## Readiness Gates

`GET /campaigns/:id/readiness` returns the live campaign checklist:

- creator target intake
- sender health
- approval workbench presence
- approved and actionable creators
- approved first-touch copy
- execution proof
- pending manual evidence

Use this before execution and again before renewal review. A status of
`ready_to_execute` means the local product state can create send intents. A
status of `awaiting_manual_evidence` means operator work is still required. A
status of `evidence_ready` means the latest execution has proof ready for
review; it does not by itself claim that Instagram delivery was live unless the
underlying adapter/evidence is live.

Readiness and execution use the current managed sender inventory when a
campaign was scheduled from stored sender ids. If a sender is locked or cooling
down after campaign creation, readiness blocks and execution returns a conflict
instead of creating send intents for that account.

## Evidence Rules

Every real sent or replied event must include:

- operator id
- conversation URL or private evidence pointer
- non-secret screenshot or audit reference
- provider or platform message id when available
- timestamp

Restricted or failed events must include:

- restriction/failure source
- sender account id
- operator note
- decision on cooldown, reconnect, or replacement

Skipped or blocked workbench items must include:

- operator id
- reason
- source or reference that explains the triage decision

## Stop Conditions

- sender warning or restriction
- complaint
- duplicate send attempt
- missing approval before send
- missing operator evidence
- webhook dead-letter that cannot be replayed before report generation

When a sender warning, restriction, lockout, or reconnect requirement appears,
record it with `POST /senders/:id/risk-events` before checking readiness or
running execution.

## Dry-Run Evidence

The current dry-run artifact is [delivery-path-dry-run.md](proof/delivery-path-dry-run.md).
It proves the selected path, local API, sender-health response, and duplicate
suppression behavior without claiming a live Instagram send.

The local OpenAPI contract is available at `/openapi.json`. Use it as the
operator contract for the credential-free pilot path: campaign creation,
approval, readiness, sender inventory, manual-safe execution, manual evidence,
execution proof records, `/health`, and `/webhooks/preview`. Manual evidence
schemas are event-specific, so sent, failed, restricted, and replied events
list the required evidence fields separately.

For a repeatable local proof-pack demo, run:

```bash
npm run demo:pilot
```

This exercises approval, mock delivery, simulated signed webhook records, and
proof-pack generation without requiring credentials or sending Instagram DMs.

For a credential-free rehearsal of the managed manual pilot path, run:

```bash
npm run demo:manual-pilot
```

That command drives the API through campaign creation, approval workbench,
readiness, manual-safe execution, sent/replied/restricted evidence, simulated
webhook records, and final proof-pack renewal output. Use it as the local proof
that the operator workflow is intact before substituting real sender accounts,
real creator targets, and explicit permission to run outreach.
