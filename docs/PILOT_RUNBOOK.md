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

## Intake Kit

Before creating a live Graphed campaign, fill and validate the intake kit:

```bash
npm run pilot:intake:validate -- \
  --campaign /path/to/live-pilot-campaign.json \
  --senders /path/to/live-pilot-senders.json \
  --authorization /path/to/live-pilot-launch-authorization.json \
  --webhook /path/to/live-pilot-webhook.json

npm run pilot:intake:rehearse -- \
  --campaign /path/to/live-pilot-campaign.json \
  --senders /path/to/live-pilot-senders.json \
  --authorization /path/to/live-pilot-launch-authorization.json \
  --webhook /path/to/live-pilot-webhook.json
```

The default command validates the public examples in `examples/`. The private
filled files should keep creator targets, sender credential ownership, approval
references, and callback configuration in the operator handoff system, not in
the public repo. The rehearsal command creates the in-memory API state up to
`awaiting_manual_evidence` and prints the campaign, readiness, handoff,
execution, manual queue, proof, and dashboard URLs for the operator. See
[PILOT_INTAKE_KIT.md](PILOT_INTAKE_KIT.md) for the file contracts and
validation gates.

## Service Preflight

Before any operator rehearsal or real pilot, verify the compiled service path:

```bash
npm run build
npm run smoke:service
```

The smoke command starts `dist/index.js` on a temporary port with an isolated
JSON store and `INSCHNEIDERGRAM_API_KEY` enabled, checks `/health` and
`/openapi.json`, confirms protected routes reject unauthenticated requests,
validates `GET /pilot-launch-packet`, creates a stored sender, approves a
campaign, runs a provider-reported managed execution, then runs the selected
manual path through the HTTP manual queue and manual evidence endpoints. It
checks `GET /campaigns/:id/proof-pack`, verifies `GET /operator/dashboard`
summarizes both provider and manual paths, and confirms both paths reach
`evidence_ready`. It uses no real credentials and does not claim live Instagram
delivery.

For production or any service bound outside localhost, set both
`INSCHNEIDERGRAM_API_KEY` and `INSCHNEIDERGRAM_WEBHOOK_SECRET` to at least 16
characters. Send either `X-API-Key` or `Authorization: Bearer` on every operator
or Graphed API call. Only `GET /health`, `GET /openapi.json`, and CORS
`OPTIONS` preflight remain public. `POST /webhooks/preview` is protected
because it signs arbitrary payloads with the configured webhook secret.

For live callback delivery, set `INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS` to the
Graphed callback host or tenant wildcard before accepting campaigns. The API
rejects non-HTTPS, localhost, private-network, link-local, and special-use IP
webhook destinations at campaign creation and again before runtime dispatch.
Runtime dispatch also rejects callback hostnames that resolve to blocked
private or special-use addresses before the outbound request is made.

## Pilot Flow

0. Graphed or the operator fetches `GET /pilot-launch-packet` before campaign
   creation, fills the intake kit, and runs `npm run pilot:intake:validate` to
   confirm the private creator list, sender operation, callback, delivery-path,
   launch-authorization, proof, and stop-condition inputs fit the API contract.
1. Operator registers non-secret sender inventory with `PUT /senders/:id`.
2. Graphed or the operator authenticates with the deployment API key when the
   service is network exposed.
3. Graphed submits `POST /campaigns` with vetted creator targets, source and
   fit rationale, offer, message copy, sender constraints, and webhook URL.
   Use profile-object targets and `settings.requireTargetProvenance=true` for
   live pilots so unvetted handles are blocked before scheduling. If inline
   `settings.senderAccounts` is omitted, the API uses stored sender inventory
   and rejects unknown sender ids.
4. Operator or approver creates `POST /campaigns/:id/approval-workbench` and
   persists creator plus first-touch copy decisions.
5. Operator claims approved creators and marks any non-actionable creators
   skipped or blocked before execution.
6. Graphed or the operator checks `GET /campaigns/:id/readiness` to confirm the
   campaign is ready to execute or to see the remaining external inputs.
7. Graphed or the operator fetches `GET /campaigns/:id/pilot-handoff` to see
   the missing external inputs, exact next API actions, creator/sender/evidence
   contracts, proof URLs, follow-up state, and stop conditions for this
   campaign.
8. Graphed or the operator records a `launchAuthorization` object for the
   selected manual or managed-provider delivery path: actor, delivery path,
   approved target limit, approval timestamp, and reference/evidence pointer.
9. Execution runner rejects campaigns that are not ready or lack matching launch
   authorization, rechecks current sender health, then creates `SendIntent`
   records only for approved creators that remain queued or claimed.
10. Delivery adapter returns sent, failed, restricted, replied, or, for the
   manual-safe adapter, `needs_manual_evidence`.
11. Operator checks `GET /operator/manual-queue` or
   `GET /campaigns/:id/executions/:executionId/manual-queue` to see stable
   intent ids, target handles, sender accounts, messages, allowed manual
   events, and required evidence fields.
12. Operator performs or verifies manual sends outside the codebase when the
   adapter requires human evidence.
13. Operator records sent, failed, restricted, or replied evidence through
   `POST /campaigns/:id/executions/:executionId/manual-events` with an
   `Idempotency-Key` for retry safety.
14. Campaign events update status, refresh latest proof/follow-up state, and
    outgoing webhooks notify Graphed.
15. Execution proof record is persisted for audit replay.
16. Operator or buyer fetches `GET /campaigns/:id/proof-pack` for the latest
    proof export, readiness state, source URLs, metrics, renewal decision, and
    Markdown report.
17. Operator checks `GET /campaigns/:id/follow-ups` when the campaign includes
    `settings.followUps`. The plan lists only contacted creators without reply,
    failure, or restriction evidence, with due/pending status, sequence,
    sender, message, and creator provenance for the next operator touch.
18. Operator checks `GET /operator/dashboard` for the cross-campaign command
    surface: readiness state, manual evidence counts, reply-monitoring work,
    due follow-ups, sender-health blockers, runtime webhook dead letters,
    latest proof metrics, renewal decisions, and source URLs.
19. Proof-pack generator produces the renewal report with operator skipped and
    blocked counts from workbench evidence.

## Readiness Gates

`GET /campaigns/:id/readiness` returns the live campaign checklist:

- creator target intake
- creator profile vetting and provenance
- sender health
- approval workbench presence
- approved and actionable creators
- approved first-touch copy
- launch authorization for manual or managed-provider delivery
- execution proof
- pending manual evidence

Use this before execution and again before renewal review. A status of
`ready_to_execute` means the local product state can create send intents for a
selected delivery path with launch authorization already supplied. A
status of `awaiting_manual_evidence` means operator work is still required. A
status of `evidence_ready` means the latest execution has proof ready for
review; it does not by itself claim that Instagram delivery was live unless the
underlying adapter/evidence is live.

Readiness and execution use the current managed sender inventory when a
campaign was scheduled from stored sender ids. If a sender is locked or cooling
down after campaign creation, readiness blocks and execution returns a conflict
instead of creating send intents for that account.

`GET /pilot-launch-packet` is the pre-campaign launch document for Graphed and
the operator. It wraps the route map, profile-object creator schema, sender
credential boundary, delivery-path options, launch-authorization template,
proof metrics, validation commands, and stop conditions before any private
creator list is sent to the service.

`GET /campaigns/:id/pilot-handoff` is the campaign-level handoff document for
operators and evaluators. It wraps readiness with next API actions, source
URLs, missing external inputs, creator provenance requirements, sender
credential boundaries, launch-authorization evidence fields, manual evidence
requirements, provider outcome expectations, stop conditions, follow-up state,
and latest proof context. Use it before moving from local rehearsal to a real
Graphed pilot.

`GET /operator/dashboard` is the operator overview for one or more active
campaigns. It reuses the readiness, manual queue, follow-up, proof, sender
health, and runtime webhook dead-letter surfaces, then returns urgent actions
with source URLs. It does not store new state and it does not expose full proof
Markdown or target-message payloads; operators should click through to the
campaign-specific routes when they need details.

`POST /campaigns/:id/executions` requires `launchAuthorization` for `manual`
and `managed_provider` adapters. The authorization delivery path must match the
adapter, and `approvedTargetLimit` must cover the approved executable target
count after skipped or blocked workbench candidates are excluded. Missing,
mismatched, or too-small authorization returns `409` without inserting an
execution record. `mock` executions are exempt so local dry-runs stay cheap.

`GET /operator/manual-queue` defaults to the same blocking work readiness calls
pending manual evidence: manual attempts with no recorded evidence from the
latest manual execution per campaign. Use `status=reply_monitoring` for sent
messages that can still receive reply evidence, `status=done` for terminal
attempts, and `status=all` for an audit view.

While a manual execution has pending initial evidence, later execution requests
return a conflict instead of creating another manual queue. Finish or fail the
current operator evidence before retrying execution.

Manual evidence writes update the campaign and execution proof record together
inside the store. That makes the queue/evidence loop safe for a small pilot with
more than one operator submitting evidence at the same time.

Manual evidence dispatches signed callbacks through the runtime guarded webhook
sender by default. Use `simulateWebhookDelivery=true` only for local rehearsals
and tests that intentionally record simulated callback delivery; live proof
should either show runtime delivery attempts or dead-letter records.

When manual evidence records a `restricted` event for a sender from managed
inventory, the API also appends a sender `restriction` risk event, moves the
sender into cooldown, refreshes sender-warning proof metrics, and makes later
readiness/execution checks block on sender health. If the sender is not in the
managed inventory, the operator must still record the risk event explicitly
with `POST /senders/:id/risk-events` before continuing.

## Follow-up Plan

The follow-up plan is an operator planning surface, not an automatic sender.
`GET /campaigns/:id/follow-ups` reads `settings.followUps` and the latest
execution evidence, then returns due and pending follow-up items for contacted
creators who have not replied, failed, or been restricted. `GET
/campaigns/:id/proof-pack` includes the same `followUpPlan` plus
`source.followUpsUrl` so renewal review can see whether there is remaining
operator work before another campaign is created. Provider replies and
failures recorded after execution refresh that latest execution evidence, so
follow-up work disappears once the provider reports a terminal result.

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
execution proof records, runtime webhook callbacks, webhook dead-letter replay,
latest proof export, `/health`, and `/webhooks/preview`. It also documents the
optional API key schemes used by network-exposed deployments. Manual evidence
schemas are event-specific, so sent, failed, restricted, and replied events
list the required evidence fields separately.

## Webhook Callback Operations

When a campaign includes `settings.webhookUrl`, provider events recorded through
`POST /campaigns/:id/events` dispatch a signed callback to that URL. Execution
runs also use the runtime webhook sender when `simulateWebhooks` is false. Keep
`simulateWebhooks` enabled for local proof rehearsals and disable it only when
Graphed has a reachable callback endpoint. Late provider replies and failures
also refresh the latest proof export and follow-up plan before the operator
publishes renewal evidence.

Production callbacks should be restricted with
`INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS=hooks.graphed.com` or a tenant wildcard
such as `*.tenant-hooks.graphed.com`. For local receiver tests, use an HTTPS
tunnel and allowlist that tunnel hostname; do not configure `localhost`,
`127.0.0.1`, or private IPs as campaign webhook URLs.

Use `GET /webhooks/dead-letters` before final proof generation. If a callback
dead-lettered, fix the receiving endpoint or network issue, then run
`POST /webhooks/dead-letters/:id/replay` and verify the delivery state before
publishing the proof pack.

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

That command drives the API through strict creator-provenance intake, campaign
creation from managed sender ids, approval workbench, readiness, manual-safe
execution, sent/replied/restricted evidence, managed sender cooldown
reconciliation, simulated webhook records, and final proof-pack renewal output.
Use it as the local proof that the operator workflow is intact before
substituting real sender accounts, real creator targets, and explicit permission
to run outreach.
