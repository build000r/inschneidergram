# Delivery Path Dry-Run Evidence

Generated: 2026-05-30T01:23:51Z

Commit at dry run: `2083d62`

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
- No sender-account restriction/recovery flow has been exercised.

## Next Required Evidence

- one low-volume real test handoff through the manual adapter
- operator evidence for sent or restricted result
- replayable webhook delivery record
- proof pack generated from real pilot records
