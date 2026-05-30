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

The managed-provider adapter is now an API contract surface, but it remains an
expansion path until a provider/account owner can actually operate the sender
path. Use `adapter.kind=managed_provider` only when every approved executable
target has an explicit provider-reported outcome and the provider can produce
the same evidence contract: sent, failed, restricted, replied, account-health
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

## Service Preflight

Before any operator rehearsal or real pilot, verify the compiled service path:

```bash
npm run build
npm run smoke:service
```

The smoke command starts `dist/index.js` on a temporary port with an isolated
JSON store and `INSCHNEIDERGRAM_API_KEY` enabled, checks `/health` and
`/openapi.json`, confirms protected routes reject unauthenticated requests,
creates a stored sender, approves a campaign, runs a provider-reported managed
execution, checks `GET /campaigns/:id/proof-pack`, and confirms the final
readiness status is `evidence_ready`. It uses no real credentials and does not
claim live Instagram delivery.

For any service bound outside localhost, set `INSCHNEIDERGRAM_API_KEY` and send
either `X-API-Key` or `Authorization: Bearer` on every operator or Graphed API
call. Only `GET /health`, `GET /openapi.json`, and CORS `OPTIONS` preflight
remain public. `POST /webhooks/preview` is protected because it signs arbitrary
payloads with the configured webhook secret.

## Pilot Flow

1. Operator registers non-secret sender inventory with `PUT /senders/:id`.
2. Graphed or the operator authenticates with the deployment API key when the
   service is network exposed.
3. Graphed submits `POST /campaigns` with vetted creator targets, offer,
   message copy, sender constraints, and webhook URL. If inline
   `settings.senderAccounts` is omitted, the API uses stored sender inventory
   and rejects unknown sender ids.
4. Operator or approver creates `POST /campaigns/:id/approval-workbench` and
   persists creator plus first-touch copy decisions.
5. Operator claims approved creators and marks any non-actionable creators
   skipped or blocked before execution.
6. Graphed or the operator checks `GET /campaigns/:id/readiness` to confirm the
   campaign is ready to execute or to see the remaining external inputs.
7. Execution runner rejects campaigns that are not ready, rechecks current
   sender health, then creates `SendIntent` records only for approved creators
   that remain queued or claimed.
8. Delivery adapter returns sent, failed, restricted, replied, or, for the
   manual-safe adapter, `needs_manual_evidence`.
9. Operator checks `GET /operator/manual-queue` or
   `GET /campaigns/:id/executions/:executionId/manual-queue` to see stable
   intent ids, target handles, sender accounts, messages, allowed manual
   events, and required evidence fields.
10. Operator performs or verifies manual sends outside the codebase when the
   adapter requires human evidence.
11. Operator records sent, failed, restricted, or replied evidence through
   `POST /campaigns/:id/executions/:executionId/manual-events` with an
   `Idempotency-Key` for retry safety.
12. Campaign events update status and outgoing webhooks notify Graphed.
13. Execution proof record is persisted for audit replay.
14. Operator or buyer fetches `GET /campaigns/:id/proof-pack` for the latest
    proof export, readiness state, source URLs, metrics, renewal decision, and
    Markdown report.
15. Proof-pack generator produces the renewal report with operator skipped and
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

`GET /operator/manual-queue` defaults to the same blocking work readiness calls
pending manual evidence: manual attempts with no recorded evidence from the
latest manual execution per campaign. Use `status=reply_monitoring` for sent
messages that can still receive reply evidence, `status=done` for terminal
attempts, and `status=all` for an audit view.

Manual evidence writes update the campaign and execution proof record together
inside the store. That makes the queue/evidence loop safe for a small pilot with
more than one operator submitting evidence at the same time.

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
approval, readiness, sender inventory, manual-safe execution,
provider-reported managed execution, operator manual queue, manual evidence,
execution proof records, latest proof export, `/health`, and
`/webhooks/preview`. It also documents the optional API key schemes used by
network-exposed deployments. Manual evidence schemas are event-specific, so
sent, failed, restricted, and replied events list the required evidence fields
separately.

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
