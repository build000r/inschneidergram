# Inschneidergram

API-first Instagram creator outreach control plane for managed campaign pilots.

Inschneidergram is being built for a specific bounty: Graphed wants a
production-ready, HeyReach-style Instagram creator outreach product that can
accept a list of creator profiles, campaign settings, message copy, optional
follow-up logic, and then return delivery/reply status through an API or
webhook. The sharper wedge is policy-aware orchestration: decide which creators
are worth contacting, queue the safest approved action, and make every delivery
outcome auditable.

The important product bet is the managed layer. The buyer does not want a local
browser script to host, babysit, or repair. They want a service interface that
absorbs sender-account operations, throttling, duplicate prevention, reporting,
and platform-change maintenance.

## Current Status

This repo currently contains the first API/control-plane slice:

| Requirement from bounty | Status | Evidence |
| --- | --- | --- |
| `POST /campaigns` API | Working MVP | `src/server.ts`, `tests/server.test.ts` |
| Target normalization | Working MVP | `src/domain/handles.ts`, `tests/campaign.test.ts` |
| Duplicate prevention | Working MVP | in-campaign dedupe plus persisted suppression records |
| Safe sending limits and scheduling | Working MVP | per-sender limits, delay windows, domain tests |
| Delivery/reply status tracking | Working MVP | `POST /campaigns/:id/events` |
| Webhook signing helper | Working MVP | `src/domain/webhook.ts` |
| Outgoing webhook retries | Working MVP | signed jobs, backoff, dead letters, replay |
| Persistent local campaign store | Working MVP | `JsonFileCampaignStore`, idempotency/suppression tests |
| Idempotent campaign creation | Working MVP | `Idempotency-Key` header tests |
| Sender health model | Working MVP | limits, cooldowns, lockouts, reconnect state |
| Approval workbench API | Working MVP | `POST /campaigns/:id/approval-workbench` |
| Operator workbench state | Working MVP | claim, skip, block routes before execution |
| Execution runner | Working MVP | `POST /campaigns/:id/executions` |
| Pilot launch readiness | Working MVP | `GET /campaigns/:id/readiness` |
| Managed sender infrastructure | Partial | health model exists; real account operations next |
| Pilot proof pack | Working MVP | metrics, incidents, sender health, operator triage, renewal decision |
| Execution proof records | Working MVP | `GET /campaigns/:id/executions` |
| Manual evidence recording | Working MVP | `POST /campaigns/:id/executions/:executionId/manual-events` |
| Real Instagram delivery | Not implemented | requires provider/account operations |
| Pilot readiness | Partial | needs real delivery adapter and live pilot evidence |

## Quick Start

```bash
npm install
npm test
npm run demo:pilot
npm run dev
```

By default, the built server persists campaigns to `.data/campaigns.json`.
Override with `INSCHNEIDERGRAM_STORE_PATH=/path/to/campaigns.json`.

`npm run demo:pilot` runs a deterministic local proof-pack demo with mock
delivery, simulated signed webhook delivery records, and no live Instagram
sending.

Inspect the local API contract:

```bash
curl -s http://127.0.0.1:3107/openapi.json
```

The OpenAPI document includes the no-credential pilot flow: campaign creation,
approval workbench, readiness, manual-safe execution, manual evidence, proof
records, health, and webhook signature preview. Templated routes document path
parameters, and manual evidence schemas are split by event type so operators can
see the required proof fields before a run.

Create a campaign:

```bash
curl -s http://127.0.0.1:3107/campaigns \
  -H 'content-type: application/json' \
  -H 'idempotency-key: client_creator_outreach_may_2026_batch_1' \
  -d '{
    "targets": ["instagram_profile_1", "instagram_profile_2"],
    "message": "Hey - loved your content. Would you be open to an affiliate partnership?",
    "campaign": "client_creator_outreach_may_2026",
    "settings": {
      "senderPool": ["sender-a", "sender-b"],
      "senderAccounts": [
        {
          "id": "sender-a",
          "status": "healthy",
          "dailyLimit": 35,
          "warmupNote": "ready for low-volume pilot",
          "riskEvents": []
        }
      ],
      "dailyLimitPerSender": 35,
      "minDelaySeconds": 90,
      "maxDelaySeconds": 420,
      "webhookUrl": "https://example.com/inschneidergram/events"
    }
  }'
```

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
copy, a healthy sender or provider, operator evidence, or permission to run the
selected delivery path.

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
  "targets": ["instagram_profile_1", "instagram_profile_2"],
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

`POST /campaigns/:id/approval-workbench` persists the creator and copy approval
state for a campaign. Callers can create a workbench with approved or rejected
target handles, fetch it with `GET /campaigns/:id/approval-workbench`, and apply
individual candidate or message decisions through the decision subroutes.
Operators can claim approved candidates and mark them `skipped` or `blocked`
with evidence before execution. Executions without inline approval overrides use
the stored workbench when one exists and only create send intents for approved
candidates whose work state is still `queued` or `claimed`.

`GET /campaigns/:id/readiness` returns a pilot launch checklist derived from the
stored campaign, approval workbench, sender health, and execution proof records.
It is the fastest way to see whether the campaign is blocked, needs approval,
is ready to execute, is waiting on manual evidence, or has proof ready for
review.

`POST /campaigns/:id/executions` is the pilot-demo workflow. It builds an
approval workbench from the stored campaign, routes approved targets through a
safe `mock` or `manual` adapter, records campaign events, simulates signed
webhook delivery records, and returns the proof-pack metrics plus Markdown,
including explicit operator skipped/blocked counts from workbench evidence. It
also persists an execution proof record that can be listed with
`GET /campaigns/:id/executions` or fetched with
`GET /campaigns/:id/executions/:executionId`. Manual executions can be updated
with `POST /campaigns/:id/executions/:executionId/manual-events`; that route
validates required operator evidence, updates campaign status, appends webhook
delivery records, and refreshes the stored proof pack. It does not claim live
Instagram delivery.

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

The current implementation ships the left side of this system. The next slice
must turn the provider adapter into a real managed delivery operation.

## Why Not Just Use the Official Instagram API?

Current research indicates that the official Instagram Messaging API is built
around user-initiated conversation windows, not arbitrary cold outreach to any
profile. That does not invalidate the bounty, but it changes the product shape:
the winning product must be honest about compliance boundaries and either
operate a managed delivery layer or integrate a trusted provider that already
owns that operational risk.

## Design Principles

| Principle | Product implication |
| --- | --- |
| Managed product, not script | The buyer should never debug browser automation. |
| API first | Graphed agents need a clean programmable surface. |
| Sender safety is core logic | Limits, delays, duplicate prevention, and warm-up are product behavior. |
| Status is contractual | Every target needs inspectable delivery/reply state. |
| Compliance is explicit | The product must label what is official-API-safe versus managed-risk delivery. |

## Roadmap to Bounty Pilot

1. Connect real sender account operations to the sender health model.
2. Connect a real managed sender/provider path to the execution runner.
3. Run a controlled pilot with a small vetted creator list.
4. Publish live reliability evidence using the proof-pack generator.

## Limitations

This is not yet a working Instagram sending product. The current repo is the
API and scheduling control plane needed to make that product auditable. Winning
the bounty still requires a real managed delivery adapter, sender operations,
and a pilot that completes meaningful creator outreach.

## Documentation

- [Vision](docs/VISION.md)
- [Bounty requirements](docs/BOUNTY_REQUIREMENTS.md)
- [Build-vs-clone analysis](docs/BUILD_VS_CLONE.md)
- [Power map](docs/POWER_MAP.md)
- [Domain plan](docs/DOMAIN_PLAN.md)
- [Pilot spec](docs/PILOT_SPEC.md)
- [Pilot runbook](docs/PILOT_RUNBOOK.md)
- [Marketing surface](docs/MARKETING-SURFACE.md)
- [Project status MMDX](diagrams/inschneidergram-project-status.mmdx)

## About Contributions

Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

## License

MIT
