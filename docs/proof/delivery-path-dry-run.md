# Bounty Local Proof Dossier

Generated: 2026-05-30T09:01:25Z

Validation run base: `e4eaeab`

Validation target: the working tree after the operator-dashboard status API
slice. The next commit records this proof refresh with the implementation.

Runtime:

- Node: `v22.22.0`
- npm: `10.9.4`

## Decision

Selected first-pilot delivery path: **operator-run managed manual delivery**.

Risk posture:

- adapter kind: `manual`
- account risk owner: operator
- official cold-DM compliance: `not_claimed`
- human evidence required: yes

This is the credential-free proof surface for the current repo. It proves the
API/control-plane, manual-pilot, managed-provider contract, launch packet,
operator dashboard, proof export, runtime-secret, and webhook-proof surfaces are
intact. It does not claim live Instagram delivery or completed Graphed outreach.

## Validation Summary

| Command | Result | Evidence |
| --- | --- | --- |
| `npm test` | Passed | 13 files, 112 tests |
| `npm run typecheck` | Passed | `tsc -p tsconfig.json --noEmit` exited 0 |
| `npm run build` | Passed | `tsc -p tsconfig.build.json` exited 0 |
| `npm run smoke:service` | Passed | builds first, then API-key service smoke reached `evidence_ready` for provider and manual paths and verified the operator dashboard |
| `npm run demo:manual-pilot` | Passed | strict-provenance manual rehearsal reached `evidence_ready` |
| `npm run demo:pilot` | Passed | deterministic mock proof-pack demo recommended iteration |
| `python3 <mmdx-skill>/scripts/mmd.py diagrams/inschneidergram-project-status.mmdx --preflight-only` | Passed | 10 charts |

## Service Smoke Evidence

`npm run smoke:service` starts the built service with an isolated JSON store and
API key protection enabled. `npm run smoke:service` now runs `npm run build`
first, so the smoke cannot accidentally reuse stale `dist/` output.
Machine-local temp store paths are omitted from this proof doc.

```json
{
  "health": {
    "ok": true,
    "service": "inschneidergram",
    "provider": "service-smoke",
    "store": {
      "ok": true,
      "kind": "json_file"
    }
  },
  "apiAuth": "enabled",
  "openApiPathCount": 28,
  "launchPacketInputs": 6,
  "contactedTargets": 1,
  "sentMessages": 1,
  "proofExportContactedTargets": 1,
  "manualServicePath": {
    "readiness": "evidence_ready",
    "queueDone": 2,
    "contactedTargets": 1,
    "interestedReplies": 1,
    "deliveryFailures": 1,
    "senderWarnings": 1,
    "webhookDelivered": 3,
    "webhookDeadLetters": 0,
    "renewalDecision": "iterate"
  },
  "operatorDashboard": {
    "campaigns": 2,
    "readyForEvidenceReview": 2,
    "manualQueueDone": 2,
    "senderBlocked": 1,
    "deadLetters": 0
  },
  "readiness": "evidence_ready"
}
```

What this proves:

- `/health` and the JSON store are service-checkable.
- API-key protection is active for non-public routes in the smoke path.
- `/openapi.json` exposes 28 documented paths.
- `GET /pilot-launch-packet` exposes the pre-campaign private-input checklist.
- `GET /operator/dashboard` aggregates readiness, manual queue, sender health,
  runtime dead-letter, proof, and urgent-action status under API key auth.
- Provider-reported execution can produce a proof export and readiness state.
- The selected manual path works over the compiled service with API key auth,
  the JSON store, manual queue, timestamped manual evidence, webhook records,
  and proof export.

## Manual Pilot Rehearsal Evidence

`npm run demo:manual-pilot` exercises the strongest credential-free operator
path:

- registers two stored sender accounts through `PUT /senders/:id`
- creates the campaign from profile-object targets with `source`,
  `fitReason`, tags, profile URLs, and `requireTargetProvenance=true`
- schedules from managed `senderPool` ids without inline sender credentials
- passes a structured manual `launchAuthorization`
- creates a manual execution queue
- records sent, replied, and restricted manual evidence
- reconciles the restricted evidence into managed sender risk state
- leaves one sender healthy and one sender in cooldown
- returns final proof metrics and a renewal recommendation

Readiness timeline:

```text
created: needs_approval
approved_and_claimed: needs_approval
manual_execution_created: awaiting_manual_evidence
evidence_recorded: evidence_ready
```

Manual queue timeline:

```json
[
  {
    "label": "manual_execution_created",
    "pendingInitialEvidence": 2,
    "replyMonitoring": 0,
    "done": 0,
    "items": 2
  },
  {
    "label": "sent_recorded",
    "pendingInitialEvidence": 1,
    "replyMonitoring": 1,
    "done": 0,
    "items": 2
  },
  {
    "label": "evidence_recorded",
    "pendingInitialEvidence": 0,
    "replyMonitoring": 0,
    "done": 2,
    "items": 2
  }
]
```

Final metrics:

```json
{
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
}
```

Sender-risk result:

```json
{
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
}
```

Launch authorization preserved in the proof pack:

```json
{
  "actor": "demo-approver",
  "deliveryPath": "manual",
  "approvedTargetLimit": 2,
  "approvedAt": "2026-05-30T01:00:00.000Z",
  "reference": "manual-demo-launch-approval",
  "notes": "Credential-free local rehearsal authorization; no live Instagram delivery."
}
```

Renewal recommendation:

```json
{
  "decision": "iterate",
  "reasons": [
    "1 sender warning(s) require operator review.",
    "1 delivery failure(s) require resolution."
  ]
}
```

## Mock Proof-Pack Demo Evidence

`npm run demo:pilot` remains useful as a deterministic contract demo for local
proof-pack generation. It uses the `mock` adapter and records no launch
authorization.

```json
{
  "status": "running",
  "summary": {
    "total": 3,
    "sent": 1,
    "replied": 1,
    "failed": 1
  },
  "adapterRiskPosture": {
    "kind": "mock",
    "officialColdDmCompliance": "not_claimed",
    "accountRiskOwner": "none",
    "requiresHumanEvidence": false,
    "posture": "simulation_only"
  },
  "webhookDeliveries": 4,
  "renewalRecommendation": {
    "decision": "iterate",
    "reasons": ["1 delivery failure(s) require resolution."]
  }
}
```

## What This Proves

- The current API accepts the bounty-shaped campaign workflow.
- Strict creator provenance intake is enforced and counted in proof metrics.
- Managed sender inventory can drive campaign creation without storing secrets.
- Manual execution requires and preserves structured launch authorization.
- Manual evidence updates campaign state, manual queue state, proof metrics, and
  webhook records.
- Manual restriction evidence writes back into managed sender risk state.
- The service can run as an API-key-protected compiled service and reach
  `evidence_ready`.
- Production or non-loopback startup requires strong API and webhook secrets.
- Public webhook destinations are DNS-checked and the sender uses the
  prevalidated DNS addresses for the outbound request.
- Provider-event webhook delivery records are appended back into the latest
  execution proof pack.
- Renewal is blocked to `iterate` when sender warnings, delivery failures, or
  webhook dead letters exist.
- The project-status MMDX stack parses successfully with 10 charts.

## What This Does Not Prove

- No live Instagram DM was sent.
- No Graphed creator list was contacted.
- No real provider/account operation has been verified.
- No public Buildooor MMDX short link has been minted yet.
- No official Meta cold-DM compliance claim is made.

## Next Required Evidence

- authenticated first save of the Buildooor MMDX stack to mint the public slug
- one low-volume real test handoff through the selected manual/provider path
- private sender/provider credentials or operator-owned account setup
- vetted Graphed creator list and explicit launch authorization
- proof pack generated from real pilot records
