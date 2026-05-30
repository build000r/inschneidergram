# Inschneidergram

API-first Instagram creator outreach control plane for managed campaign pilots.

Inschneidergram is being built for a specific bounty. Based on the
operator-provided bounty interpretation in
[`docs/BOUNTY_REQUIREMENTS.md`](docs/BOUNTY_REQUIREMENTS.md), Graphed wants a
production-ready Instagram creator outreach product that can accept a list of
creator profiles, campaign settings, message copy, optional follow-up logic,
and then return delivery/reply status through an API or webhook. The sharper
wedge is auditable orchestration: preserve creator provenance, enforce approval
and sender-limit gates, queue only approved actions, and make every delivery
outcome inspectable.

The important product bet is the managed layer. The buyer does not want a local
browser script to host, babysit, or repair. This repo exposes the service
interface for sender-account operations, throttling, duplicate prevention,
reporting, and platform-change maintenance; actual managed delivery operations
still need to be provisioned and verified.

## Current Status

This repo currently contains the API/control-plane MVP:

| Requirement from bounty | Status | Evidence |
| --- | --- | --- |
| `POST /campaigns` API | Working MVP | `src/server.ts`, `tests/server.test.ts` |
| Target normalization | Working MVP | `src/domain/handles.ts`, `tests/campaign.test.ts` |
| Creator provenance intake | Working MVP | target profile objects, opt-in provenance gate, readiness/proof metrics |
| Duplicate prevention | Working MVP | in-campaign dedupe plus persisted suppression records |
| Sender limits and scheduling | Working MVP | per-sender limits, delay windows, domain tests |
| Delivery/reply status tracking | Working MVP | `POST /campaigns/:id/events`, including late provider proof refresh |
| Webhook signing helper | Working MVP | `src/domain/webhook.ts` |
| Runtime webhook callbacks | Working MVP | provider events and non-simulated executions dispatch signed callbacks |
| Outgoing webhook retries | Working MVP | signed jobs, backoff, dead-letter list and replay routes |
| Webhook destination guard | Working MVP | public HTTPS callbacks, private-network block, optional host allowlist |
| Persistent local campaign store | Working MVP | `JsonFileCampaignStore`, idempotency/suppression tests |
| Idempotent campaign creation | Working MVP | `Idempotency-Key` header tests |
| Sender health model | Working MVP | limits, cooldowns, lockouts, reconnect state |
| Managed sender inventory | Working MVP | `GET/PUT /senders`, risk events, JSON persistence |
| Sender-risk reconciliation | Working MVP | manual restriction evidence updates managed sender risk state |
| Approval workbench API | Working MVP | `POST /campaigns/:id/approval-workbench` |
| Operator workbench state | Working MVP | claim, skip, block routes before execution |
| Execution runner | Working MVP | `POST /campaigns/:id/executions` |
| Pre-campaign launch packet | Working MVP | `GET /pilot-launch-packet` exports private-input requirements before a campaign exists |
| Pilot launch readiness | Working MVP | `GET /campaigns/:id/readiness` |
| Pilot handoff packet | Working MVP | `GET /campaigns/:id/pilot-handoff` turns readiness into operator actions |
| Live pilot intake kit | Working MVP | `docs/PILOT_INTAKE_KIT.md`, `npm run pilot:intake:validate`, `npm run pilot:intake:rehearse` |
| Operator dashboard | Working MVP | `GET /operator/dashboard` aggregates readiness, manual queue, sender health, follow-ups, proof, and runtime dead letters |
| Bounty evaluator proof | Working MVP | `docs/BOUNTY_SUBMISSION.md`, `npm run proof:bounty-local` |
| Launch authorization gate | Working MVP | manual/provider execution requires a structured approval reference |
| Follow-up planning | Working MVP | `GET /campaigns/:id/follow-ups` derives due/pending work from refreshed execution evidence |
| Managed sender infrastructure | Partial | non-secret inventory exists; credentials/provider ops are external |
| Pilot proof pack | Working MVP | metrics, incidents, sender health, operator triage, renewal decision |
| Execution proof records | Working MVP | `GET /campaigns/:id/executions` |
| Operator manual delivery queue | Working MVP | `GET /operator/manual-queue` |
| Manual evidence recording | Working MVP | atomic campaign/execution update via `manual-events` |
| Managed provider execution contract | Working MVP | `adapter.kind=managed_provider` accepts provider-reported outcomes |
| Execution readiness enforcement | Working MVP | executions return 409 until approval/sender gates pass |
| Managed service smoke path | Working MVP | `npm run smoke:service`, `/health` store check, Dockerfile |
| Latest proof export | Working MVP | `GET /campaigns/:id/proof-pack`, refreshed by late provider replies/failures |
| Service secret enforcement | Working MVP | production or non-loopback startup requires strong API/webhook secrets |
| Real Instagram delivery | Not implemented | requires provider/account operations |
| Pilot readiness | Partial | needs verified delivery operations and live pilot evidence |

## Quick Start

```bash
npm install
npm run proof:bounty-local
npm run pilot:intake:validate
npm run pilot:intake:rehearse
npm test
npm run build
npm run smoke:service
npm run demo:pilot
npm run demo:manual-pilot
npm run dev
```

For bounty review, `npm run proof:bounty-local` is the one-command local proof
gate. It runs the test, typecheck, build, service-smoke, manual-rehearsal,
pilot-intake validation/rehearsal, mock-demo, MMDX preflight, and MMDX publish
dry-run checks without requiring Instagram credentials.

By default, the built server persists campaigns to `.data/campaigns.json`.
Override with `INSCHNEIDERGRAM_STORE_PATH=/path/to/campaigns.json`.
Startup config is read from `HOST`, `PORT`, `INSCHNEIDERGRAM_PROVIDER`,
`INSCHNEIDERGRAM_STORE_PATH`, `INSCHNEIDERGRAM_WEBHOOK_SECRET`, and
`INSCHNEIDERGRAM_API_KEY`, and `INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS`.
Invalid ports fail at startup instead of binding to an unintended port. Leave
the API key and webhook secret unset for local loopback demos; production or
non-loopback startup requires both `INSCHNEIDERGRAM_API_KEY` and
`INSCHNEIDERGRAM_WEBHOOK_SECRET` to be at least 16 characters. Outgoing
callbacks must use public HTTPS URLs;
localhost, private-network, link-local, and special-use IP destinations are
blocked. Set `INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS` to a comma-separated
allowlist such as `hooks.graphed.com,*.tenant-hooks.graphed.com` to restrict
callback hosts in production.

`npm run smoke:service` starts the compiled `dist/index.js` process with an
isolated JSON store and API key protection enabled, verifies `/health` and
`/openapi.json` remain public, confirms campaign routes reject unauthenticated
requests, validates the protected pre-campaign launch packet, registers a
sender, creates and approves a campaign, runs a managed-provider contract
execution, then runs the selected manual path through HTTP manual-queue and
manual-evidence endpoints. It checks proof exports and the operator dashboard,
then confirms both paths reach `evidence_ready`.

`npm run demo:pilot` runs a deterministic local proof-pack demo with mock
delivery, simulated signed webhook delivery records, and no live Instagram
sending.

`npm run demo:manual-pilot` runs the credential-free operator rehearsal path
through the public API surface: managed sender registration, strict
creator-provenance intake, campaign creation from stored sender ids, approval,
readiness, manual-safe execution, sent/replied/restricted evidence with
timestamps, sender-risk cooldown reconciliation, simulated webhook records, and
final proof-pack renewal output.

Inspect the local API contract:

```bash
curl -s http://127.0.0.1:3107/openapi.json
```

Export the pre-campaign pilot launch packet:

```bash
curl -s http://127.0.0.1:3107/pilot-launch-packet
```

The launch packet is the first buyer/operator handoff before Graphed has
submitted a private creator list. It names the required external inputs,
profile-object creator schema, sender credential boundary, delivery-path
options, `launchAuthorization` template, proof metrics, stop conditions,
sample `POST /campaigns` payload, and validation commands.

Validate the live pilot intake files before creating a private campaign:

```bash
npm run pilot:intake:validate
npm run pilot:intake:rehearse
```

The intake kit in [docs/PILOT_INTAKE_KIT.md](docs/PILOT_INTAKE_KIT.md)
validates campaign, sender, launch-authorization, and webhook JSON against the
same schemas used by the API. The rehearsal command then drives the files
through the in-memory API up to `awaiting_manual_evidence`, proving the handoff
creates sender inventory, campaign state, approvals, manual execution, handoff,
dashboard, and manual queue without recording fake live evidence.

When `INSCHNEIDERGRAM_API_KEY` is set, all routes except `GET /health`,
`GET /openapi.json`, and CORS `OPTIONS` preflight require either:

```bash
-H "X-API-Key: $INSCHNEIDERGRAM_API_KEY"
-H "Authorization: Bearer $INSCHNEIDERGRAM_API_KEY"
```

Run the API as a service:

```bash
npm run build
HOST=0.0.0.0 PORT=3107 \
  INSCHNEIDERGRAM_PROVIDER=mock \
  INSCHNEIDERGRAM_STORE_PATH=/tmp/inschneidergram/campaigns.json \
  INSCHNEIDERGRAM_API_KEY=replace-with-a-long-random-api-key \
  INSCHNEIDERGRAM_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret \
  INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS=hooks.graphed.com \
  npm start
```

Build and run the container:

```bash
docker build -t inschneidergram .
docker run --rm -p 3107:3107 \
  -v "$PWD/.data:/data" \
  -e INSCHNEIDERGRAM_PROVIDER=mock \
  -e INSCHNEIDERGRAM_API_KEY=replace-with-a-long-random-api-key \
  -e INSCHNEIDERGRAM_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret \
  -e INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS=hooks.graphed.com \
  inschneidergram
```

The OpenAPI document includes the no-credential pilot flow: managed sender
inventory, campaign creation, approval workbench, readiness, dashboard,
manual-safe execution, provider-reported managed execution, operator manual
queue, manual evidence, proof records, webhook dead-letter replay, health,
webhook signature preview, and optional API key security schemes. Templated
routes document path parameters, and manual evidence schemas are split by event
type so operators can see the required proof fields before a run.

Register a non-secret sender account before scheduling a managed campaign:

```bash
curl -s http://127.0.0.1:3107/senders/sender-a \
  -X PUT \
  -H 'content-type: application/json' \
  -d '{
    "status": "healthy",
    "dailyLimit": 20,
    "warmupNote": "ready for low-volume pilot"
  }'

curl -s http://127.0.0.1:3107/senders/health
```

Create a campaign:

```bash
curl -s http://127.0.0.1:3107/campaigns \
  -H 'content-type: application/json' \
  -H 'idempotency-key: client_creator_outreach_may_2026_batch_1' \
  -d '{
    "targets": [
      {
        "target": "instagram_profile_1",
        "source": "graphed-sheet:row-12",
        "fitReason": "Audience overlaps the affiliate offer",
        "tags": ["fitness", "affiliate"]
      },
      "instagram_profile_2"
    ],
    "message": "Hey - loved your content. Would you be open to an affiliate partnership?",
    "campaign": "client_creator_outreach_may_2026",
    "settings": {
      "senderPool": ["sender-a"],
      "dailyLimitPerSender": 20,
      "minDelaySeconds": 90,
      "maxDelaySeconds": 420,
      "requireTargetProvenance": true,
      "webhookUrl": "https://example.com/inschneidergram/events"
    }
  }'
```

`targets` may be plain handles/URLs for local demos or profile objects for real
pilot intake. Profile objects preserve provenance on the campaign target:
`target`, optional `profileUrl`, `displayName`, `source`, `fitReason`, `tags`,
`followerCount`, and `engagementRate`. Set `settings.requireTargetProvenance`
to `true` for a live pilot so targets without both `source` and `fitReason` are
blocked before scheduling. Dedupe still runs by normalized Instagram handle.

Record a provider event:

```bash
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/events \
  -H 'content-type: application/json' \
  -d '{
    "target": "instagram_profile_1",
    "event": "reply",
    "eventId": "provider-event-1",
    "messageId": "msg_123"
  }'
```

When the campaign has `settings.webhookUrl`, provider events also dispatch a
signed callback to that URL. The response includes the webhook delivery record
so callers can see whether the callback was delivered, is pending retry, or
dead-lettered. If a provider reply or failure arrives after an execution, the
API also refreshes the latest execution proof pack so
`GET /campaigns/:id/proof-pack` and `GET /campaigns/:id/follow-ups` no longer
serve stale reply or follow-up state.

Webhook destinations are validated before campaign creation and again before
runtime dispatch, so persisted legacy records cannot cause server-side calls to
localhost or private networks. Runtime dispatch also blocks hostnames whose DNS
answers resolve to private or special-use addresses before `fetch` runs. Use an
HTTPS tunnel for local callback testing; do not point deployed campaigns at
`localhost` or raw private IPs.

Create an approval workbench before execution:

```bash
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/approval-workbench \
  -H 'content-type: application/json' \
  -d '{
    "approvedTargets": ["instagram_profile_1"],
    "rejectedTargets": ["instagram_profile_2"],
    "approveMessage": true,
    "actor": "approver"
  }'
```

Claim or skip an approved creator before execution:

```bash
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/approval-workbench/candidates/<candidate-id>/claim \
  -H 'content-type: application/json' \
  -d '{ "operator": "operator-a" }'

curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/approval-workbench/candidates/<candidate-id>/work \
  -H 'content-type: application/json' \
  -d '{
    "work": "skipped",
    "operator": "operator-a",
    "reason": "duplicate found in external suppression sheet",
    "evidence": { "source": "operator-review", "reference": "sheet://row/42" }
  }'
```

Check whether a campaign is ready to run or review:

```bash
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/readiness
```

The readiness report returns pass/fail/warn gates, next actions, and external
inputs still needed before a live pilot, such as creator approval, approved
copy, a healthy sender or provider, operator evidence, or a structured
`launchAuthorization` object for the selected delivery path.

Export the pilot handoff packet:

```bash
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/pilot-handoff
```

The handoff packet wraps readiness, missing external inputs, source URLs, next
API actions, creator/sender/evidence contracts, launch-authorization expectations,
stop conditions, manual queue state, follow-up state, and latest proof context.
It is the operator/evaluator bridge from local product state to a real Graphed
pilot; it does not claim permission or live Instagram delivery has already
happened.

Export the latest proof pack for review after an execution:

```bash
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/proof-pack
```

The export returns the latest execution id, adapter risk posture, readiness,
metrics, renewal recommendation, and the proof-pack Markdown so a buyer or
operator can review the pilot result without walking raw execution records.
Late provider replies and failures recorded through `POST /campaigns/:id/events`
are folded into the latest execution proof before this export is returned.

Inspect follow-up work derived from the latest execution evidence:

```bash
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/follow-ups
```

The follow-up plan turns `settings.followUps` into operator-visible work only
for creators who were contacted and have not replied, failed, or been
restricted. Each item includes the target, sender, sequence, message, last
sent timestamp, due timestamp, due/pending status, and preserved creator
profile evidence when available. Late provider replies and failures suppress
the affected target from the plan after they refresh the latest execution
evidence.

Run a safe execution dry-run:

```bash
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/executions \
  -H 'content-type: application/json' \
  -d '{
    "adapter": {
      "kind": "mock",
      "replyTargets": ["instagram_profile_2"],
      "failingTargets": []
    },
    "replyAssessments": [
      {
        "targetHandle": "instagram_profile_2",
        "disposition": "interested",
        "qualified": true,
        "replyText": "Interested - send details"
      }
    ]
  }'
```

Run a managed-provider contract execution with provider-reported outcomes:

```bash
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/executions \
  -H 'content-type: application/json' \
  -d '{
    "adapter": {
      "kind": "managed_provider",
      "id": "provider-contract",
      "accountRiskOwner": "provider",
      "notes": ["Provider-reported outcome contract; not a live-delivery claim."],
      "outcomes": [
        {
          "target": "instagram_profile_1",
          "outcome": "accepted",
          "events": [
            {
              "type": "sent",
              "messageId": "provider_msg_1",
              "evidence": { "providerRunId": "run_123" }
            }
          ]
        }
      ]
    },
    "launchAuthorization": {
      "actor": "graphed-approver",
      "deliveryPath": "managed_provider",
      "approvedTargetLimit": 1,
      "approvedAt": "2026-05-30T01:00:00.000Z",
      "reference": "approval-ticket-123",
      "notes": "Provider contract execution authorized for this pilot batch."
    }
  }'
```

Manual and managed-provider executions require `launchAuthorization`. Mock
executions remain available without it for local dry-runs and demos.

List pending manual delivery work for operators:

```bash
curl -s 'http://127.0.0.1:3107/operator/manual-queue?status=pending'
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/executions/<execution-id>/manual-queue
```

Record manual send evidence for a manual execution:

```bash
curl -s http://127.0.0.1:3107/campaigns/<campaign-id>/executions/<execution-id>/manual-events \
  -H 'content-type: application/json' \
  -H 'idempotency-key: manual-send-1' \
  -d '{
    "target": "instagram_profile_1",
    "type": "sent",
    "messageId": "manual_msg_1",
    "evidence": {
      "operatorId": "op_1",
      "conversationUrl": "https://instagram.com/direct/t/example",
      "screenshotUrl": "s3://proof/manual-send-1.png"
    }
  }'
```

## API Shape

`POST /campaigns`

```json
{
  "targets": [
    {
      "target": "instagram_profile_1",
      "profileUrl": "https://instagram.com/instagram_profile_1",
      "source": "graphed-sheet:row-12",
      "fitReason": "Audience overlaps the affiliate offer",
      "tags": ["fitness", "affiliate"],
      "followerCount": 24000,
      "engagementRate": 4.2
    },
    "instagram_profile_2"
  ],
  "message": "Hey - loved your content. Would you be open to an affiliate partnership?",
  "campaign": "client_creator_outreach_may_2026",
  "metadata": {
    "client": "growth-team-a",
    "source": "creator-list-v1"
  },
  "settings": {
    "senderPool": ["sender-a", "sender-b"],
    "dailyLimitPerSender": 35,
    "minDelaySeconds": 90,
    "maxDelaySeconds": 420,
    "requireTargetProvenance": true,
    "webhookUrl": "https://example.com/webhooks/inschneidergram",
    "dryRun": true,
    "followUps": [
      {
        "delayHours": 20,
        "message": "Circling back once - open to seeing a short brief?"
      }
    ]
  }
}
```

Returns `202 Accepted` with the campaign id, status, summary, and normalized
target schedule. Repeating the same request with the same `Idempotency-Key`
returns the original campaign instead of scheduling duplicate outreach. New
campaigns also consult the persisted suppression records created by earlier
campaigns, so previously scheduled handles are returned as `skipped_duplicate`.
Responses include `senderHealth`; locked, cooling-down, or reconnect-required
senders are blocked from scheduling and surfaced as account-health blockers.
Responses also preserve `targets[].profile` for object targets, so the campaign
record remains the source of truth for creator provenance and fit rationale.
When a campaign omits inline `settings.senderAccounts`, the API uses the stored
managed sender inventory. Unknown stored sender IDs are rejected instead of
being treated as healthy synthetic senders. `settings.webhookUrl` must be a
public HTTPS URL; deployed services should set
`INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS` to the Graphed callback host or tenant
wildcard before accepting campaigns.

`GET /senders`, `GET /senders/:id`, `PUT /senders/:id`, and
`POST /senders/:id/risk-events` manage the non-secret sender inventory. Risk
events append audit history and can move an account into `cooldown`, `locked`,
or `reconnect_required`. Credentials, session cookies, proxies, and recovery
secrets do not belong in this store.

`POST /campaigns/:id/approval-workbench` persists the creator and copy approval
state for a campaign. Callers can create a workbench with approved or rejected
target handles, fetch it with `GET /campaigns/:id/approval-workbench`, and apply
individual candidate or message decisions through the decision subroutes.
Operators can claim approved candidates and mark them `skipped` or `blocked`
with evidence before execution. Executions without inline approval overrides use
the stored workbench when one exists and only create send intents for approved
candidates whose work state is still `queued` or `claimed`.

`GET /pilot-launch-packet` exports the pre-campaign launch contract before
Graphed submits private inputs. It gives a route map, creator-list schema,
sender operations boundary, manual and managed-provider path expectations,
launch-authorization template, proof criteria, stop conditions, sample campaign
payload, and validation commands.

`GET /campaigns/:id/readiness` returns a pilot launch checklist derived from the
stored campaign, approval workbench, current managed sender health, and
execution proof records. It is the fastest way to see whether the campaign is
blocked, needs approval, is ready to execute, is waiting on manual evidence, or
has proof ready for review.

`GET /campaigns/:id/pilot-handoff` exports the operator handoff packet for the
same campaign. It converts readiness gates into next API actions, missing
external inputs, source URLs, creator intake requirements, sender operations
boundaries, manual evidence requirements, managed-provider expectations, proof
criteria, and stop conditions. Use it before a real pilot handoff so Graphed can
see exactly which external input or API call remains.

`GET /operator/dashboard` is the cross-campaign operator command surface. It
aggregates campaign readiness, current manual-queue counts, sender inventory
health, runtime webhook dead letters, follow-up counts, latest proof metrics,
renewal decisions, urgent actions, and source URLs. It intentionally reports
replayable runtime dead letters separately from persisted proof metrics, so a
restarted process does not imply old proof dead letters are still replayable.

`GET /campaigns/:id/proof-pack` exports the latest proof record with readiness
context, source URLs, metrics, renewal recommendation, and Markdown. It returns
`404 proof_pack_not_found` when the campaign has not produced execution proof
yet, including the current readiness report so the next action is still clear.
The export also includes `followUpPlan` and `source.followUpsUrl` so a buyer or
operator can see the next planned touches without discovering execution ids.
Provider events recorded after the execution refresh the latest proof record
before this response is generated.

`GET /campaigns/:id/follow-ups` derives the current follow-up plan from
`settings.followUps` and the latest execution evidence. It suppresses follow-up
items for creators who replied, failed, were restricted, or were never accepted
for scheduling, then reports due and pending counts for operator review. Late
provider replies and failures update that execution evidence, so follow-up work
cannot remain due for a creator who already replied or failed.

`POST /campaigns/:id/executions` is the pilot-demo workflow. It refuses to
create proof records until readiness approval gates pass through a stored
approval workbench or explicit inline execution approvals, rechecks current
managed sender health for assigned approved targets, requires a structured
`launchAuthorization` for `manual` and `managed_provider` adapters, routes approved targets
through a safe
`mock`, `manual`, or `managed_provider` adapter, records campaign events,
dispatches signed webhook records through the runtime sender when
`simulateWebhooks` is false, and returns the proof-pack metrics plus Markdown,
including explicit operator skipped/blocked counts from workbench evidence.
The launch authorization records actor, delivery path, approved target limit,
approval timestamp, and reference, then persists into the execution record and
proof export. The managed-provider adapter requires an explicit outcome for every approved
executable target and treats events as provider-reported evidence, not as a
claim that this repo performs live Instagram delivery. It also persists an
execution proof record that can be listed with
`GET /campaigns/:id/executions` or fetched with
`GET /campaigns/:id/executions/:executionId`. Operators do not have to inspect
the raw execution record to know what to do next:
`GET /operator/manual-queue` returns pending initial evidence by default, while
`status=reply_monitoring`, `status=done`, and `status=all` expose sent-but-not-replied
and terminal attempts. The campaign-scoped execution view
`GET /campaigns/:id/executions/:executionId/manual-queue` returns the same
manual work projection for one execution. A campaign with pending manual
evidence cannot start another execution until that operator evidence is
complete, preventing duplicate manual queues for the same approved creators.
Manual executions can be updated with
`POST /campaigns/:id/executions/:executionId/manual-events`; that route
validates required operator evidence, updates campaign status, appends webhook
delivery records, and refreshes the stored proof pack under one store-level
mutation so small multi-operator pilots do not lose concurrent evidence writes.
Manual evidence dispatches signed callbacks through the same runtime guarded
webhook sender by default. Local rehearsals must opt into simulated callback
records with `simulateWebhookDelivery=true`, so proof packs do not report
delivered callbacks unless a real sender or an explicit simulation handled the
event.
When a manual `restricted` event references a sender from managed inventory, the
route also appends a sender `restriction` risk event, moves that sender into
cooldown, refreshes proof metrics with the sender warning, and makes later
readiness/execution checks respect the account-health blocker.
It does not claim live Instagram delivery.

`GET /webhooks/dead-letters` lists callback deliveries that exhausted retry or
failed permanently. `POST /webhooks/dead-letters/:id/replay` requeues one
dead-lettered delivery and immediately drains due work, returning the replayed
delivery state for operator review.

## Architecture

```text
Graphed agent / client system
        |
        v
POST /campaigns
        |
        v
Campaign validator -> target normalizer -> duplicate guard
        |
        v
Safe scheduler -> sender assignment -> provider adapter
        |
        v
Provider delivery events -> campaign status -> webhook/API response
```

The current implementation ships the left side of this system, a non-secret
managed sender inventory, and a managed-provider outcome contract. The next
slice must connect that contract to a real provider or owned delivery
operation.

## Why Not Just Use the Official Instagram API?

Current public-source evidence shows official Instagram messaging APIs are
professional-account inbox and reply surfaces, not a blanket compliance
guarantee for arbitrary cold outreach to any profile. See
[Source evidence](docs/SOURCE_EVIDENCE.md). That does not invalidate the bounty,
but it changes the product shape: the winning product must be honest about
compliance boundaries and either operate a managed delivery layer or integrate a
trusted provider that already owns that operational risk.

## Design Principles

| Principle | Product implication |
| --- | --- |
| Managed product, not script | The buyer should never debug browser automation. |
| API first | Graphed agents need a clean programmable surface. |
| Sender risk gates are core logic | Limits, delays, duplicate prevention, and warm-up are product behavior. |
| Status is contractual | Every target needs inspectable delivery/reply state. |
| Compliance is explicit | The product must label what is official-API-safe versus managed-risk delivery. |

## Roadmap to Bounty Pilot

1. Use `GET /pilot-launch-packet` and
   [PILOT_INTAKE_KIT.md](docs/PILOT_INTAKE_KIT.md) to collect and validate the
   private creator, sender, callback, and authorization inputs.
2. Use `GET /operator/dashboard` during setup to keep sender health, manual
   evidence, follow-ups, and webhook dead letters visible from one surface.
3. Connect verified provider/account operations to the managed-provider contract.
4. Bring a verified sender account and vetted creator list into a controlled pilot.
5. Run the pilot with structured launch authorization and low sender limits.
6. Publish live reliability evidence using the proof-pack generator.

## Limitations

This is not yet a working Instagram sending product. The current repo is the
API and scheduling control plane needed to make that product auditable, plus a
provider-reported execution contract for managed operations. Winning the bounty
still requires verified delivery operations, live sender account handling, and
a pilot that completes meaningful creator outreach.

## Documentation

- [Vision](docs/VISION.md)
- [Bounty requirements](docs/BOUNTY_REQUIREMENTS.md)
- [Bounty submission packet](docs/BOUNTY_SUBMISSION.md)
- [Build-vs-clone analysis](docs/BUILD_VS_CLONE.md)
- [Source evidence](docs/SOURCE_EVIDENCE.md)
- [Power map](docs/POWER_MAP.md)
- [Domain plan](docs/DOMAIN_PLAN.md)
- [Pilot spec](docs/PILOT_SPEC.md)
- [Pilot intake kit](docs/PILOT_INTAKE_KIT.md)
- [Pilot runbook](docs/PILOT_RUNBOOK.md)
- [Bounty local proof dossier](docs/proof/delivery-path-dry-run.md)
- [Marketing surface](docs/MARKETING-SURFACE.md)
- [Project status MMDX](diagrams/inschneidergram-project-status.mmdx) -
  repo-local source of truth. Run `npm run status:mmdx:preflight` and
  `npm run status:mmdx:dry-run` to validate the current stack and app-link
  payload. The public Buildooor short link remains tracked by
  `inschneidergram-j8b.7` until Buildooor SPAPS auth is refreshed and
  `npm run status:mmdx:publish` live-verifies the link.

## About Contributions

Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

## License

MIT
