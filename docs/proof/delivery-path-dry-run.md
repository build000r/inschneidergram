# Delivery Path Dry-Run Evidence

Baseline generated: 2026-05-30T01:23:51Z

Commit at baseline dry run: `2083d62`

## Decision

Selected first-pilot delivery path: **operator-run managed manual delivery**.

Risk posture:

- adapter kind: `manual`
- account risk owner: operator
- official cold-DM compliance: `not_claimed`
- human evidence required: yes

## Local API Smoke

Health check:

```json
{"ok":true,"service":"inschneidergram","provider":"mock"}
```

Campaign request:

```json
{
  "targets": ["@smoke_one", "@smoke_two", "@smoke_one"],
  "message": "Open to an affiliate pilot?",
  "campaign": "smoke_proof_pack",
  "settings": {
    "senderPool": ["sender-a"],
    "senderAccounts": [
      {
        "id": "sender-a",
        "status": "healthy",
        "dailyLimit": 10,
        "riskEvents": []
      }
    ]
  }
}
```

Campaign response summary:

```json
{
  "status": "queued",
  "summary": {
    "total": 3,
    "scheduled": 2,
    "sent": 0,
    "delivered": 0,
    "replied": 0,
    "failed": 0,
    "skippedDuplicate": 1,
    "blockedPolicy": 0
  },
  "senderHealth": {
    "total": 1,
    "available": 1,
    "blocked": 0
  }
}
```

## What This Proves

- The local API accepts a bounty-shaped campaign request.
- Duplicate target suppression is visible before delivery.
- Sender health is returned in the campaign response.
- The selected delivery path has an explicit risk owner and does not claim
  official cold-DM compliance.

## What This Does Not Prove

- No live Instagram DM was sent.
- No Graphed creator list was contacted.

## Current Manual Rehearsal Evidence

`npm run demo:manual-pilot` now exercises the stronger managed sender and
strict provenance path:

- registers two stored sender accounts through `PUT /senders/:id`
- creates the campaign from profile-object targets with `source`, `fitReason`,
  tags, profile URLs, and `settings.requireTargetProvenance=true`
- schedules from `senderPool` ids without inline sender credentials
- records sent, replied, and restricted manual evidence
- reconciles the restricted evidence into one managed sender risk event
- leaves one sender healthy and one sender in cooldown
- reports `vettedTargets: 2` and `senderWarnings: 1` in the proof pack while
  final readiness remains `evidence_ready`
- reports 26 OpenAPI paths after adding `GET /campaigns/:id/pilot-handoff`

Last verified for the pilot-handoff slice with `npm run demo:manual-pilot`.
The demo uses explicit `simulateWebhookDelivery=true` payloads so the local
proof can count simulated callbacks without claiming a runtime Graphed receiver
was contacted.

```json
{
  "openApiPathCount": 26,
  "finalMetrics": {
    "sourcedTargets": 2,
    "acceptedTargets": 2,
    "vettedTargets": 2,
    "contactedTargets": 1,
    "sentMessages": 1,
    "replies": 1,
    "interestedReplies": 1,
    "deliveryFailures": 1,
    "senderWarnings": 1,
    "webhookDelivered": 3,
    "webhookDeadLetters": 0
  },
  "provenanceSummary": {
    "requireTargetProvenance": true,
    "sourcedTargets": 2,
    "acceptedTargets": 2,
    "vettedTargets": 2,
    "externalInputs": []
  },
  "senderRiskSummary": {
    "total": 2,
    "available": 1,
    "blocked": 1,
    "restrictedSender": {
      "id": "sender-b",
      "status": "cooldown",
      "available": false,
      "blockers": ["cooldown"],
      "riskEvents": [
        {
          "kind": "restriction",
          "note": "Manual restriction evidence for manual_demo_creator_two: Manual rehearsal restricted path"
        }
      ]
    }
  },
  "renewalDecision": "renew"
}
```

## Next Required Evidence

- one low-volume real test handoff through the manual adapter
- operator evidence for sent or restricted result
- replayable webhook delivery record
- proof pack generated from real pilot records
