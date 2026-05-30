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

For the first pilot, maintain a private sender inventory outside git with:

| Field | Requirement |
| --- | --- |
| sender id | Stable id used in campaign settings and send intents |
| risk owner | Operator, not Graphed |
| daily limit | Start at 10-20 first-touch sends per sender until evidence says otherwise |
| delay window | Keep the current 90-420 second default unless operator lowers volume |
| warm-up note | Human-readable account maturity and caveats |
| status | `healthy`, `cooldown`, `locked`, or `reconnect_required` |
| risk events | Warnings, restrictions, lockouts, reconnects, and manual notes |

## Pilot Flow

1. Graphed submits `POST /campaigns` with vetted creator targets, offer,
   message copy, sender constraints, and webhook URL.
2. Operator or approver creates `POST /campaigns/:id/approval-workbench` and
   persists creator plus first-touch copy decisions.
3. Execution runner creates approved `SendIntent` records.
4. Delivery adapter returns sent, failed, restricted, replied, or
   `needs_manual_evidence`.
5. Operator performs or verifies manual sends outside the codebase when the
   adapter requires human evidence.
6. Operator records sent, failed, restricted, or replied evidence through
   `POST /campaigns/:id/executions/:executionId/manual-events` with an
   `Idempotency-Key` for retry safety.
7. Campaign events update status and outgoing webhooks notify Graphed.
8. Execution proof record is persisted for audit replay.
9. Proof-pack generator produces the renewal report.

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

## Stop Conditions

- sender warning or restriction
- complaint
- duplicate send attempt
- missing approval before send
- missing operator evidence
- webhook dead-letter that cannot be replayed before report generation

## Dry-Run Evidence

The current dry-run artifact is [delivery-path-dry-run.md](proof/delivery-path-dry-run.md).
It proves the selected path, local API, sender-health response, and duplicate
suppression behavior without claiming a live Instagram send.

For a repeatable local proof-pack demo, run:

```bash
npm run demo:pilot
```

This exercises approval, mock delivery, simulated signed webhook records, and
proof-pack generation without requiring credentials or sending Instagram DMs.
