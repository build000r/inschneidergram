# Bounty Local Proof Dossier

Generated: 2026-05-30T15:03:32Z

Validation run base: `e307567` plus the current example-authorization renewal
hardening patch.

Validation target: current working tree after the runtime example-authorization
renewal hardening slice. `npm run proof:bounty-local` was rerun against this
tree and passed.

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
API/control-plane, manual-pilot, managed-provider contract and bridge, launch
packet, operator dashboard, proof export, live-intake handoff, runtime-secret,
and webhook-proof surfaces are intact. It does not claim live Instagram
delivery or completed Graphed outreach.

## Validation Summary

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run proof:bounty-local` | Passed | one-command evaluator proof across local gates, pilot intake validation/rehearsal, managed-provider bridge rehearsal, MMDX preflight, and MMDX publish dry-run |
| `npm test` | Passed | 14 files, 115 tests |
| `npm run typecheck` | Passed | `tsc -p tsconfig.json --noEmit` exited 0 |
| `npm run build` | Passed | `tsc -p tsconfig.build.json` exited 0 |
| `npm run pilot:intake:validate` | Passed | example live pilot campaign/sender/authorization/webhook intake scheduled 3 targets with one healthy manual sender and runtime-renewed, evidence-backed example authorization |
| `npm run pilot:intake:rehearse` | Passed | example intake files created sender, campaign, approval, manual execution, handoff, dashboard, and manual queue state up to `awaiting_manual_evidence`; private authorization files remain strict |
| `npm run pilot:provider-bridge` | Passed | provider handoff exported 3 approved intents, consumed 3 provider outcomes, runtime-renewed the bundled provider authorization, and reached `evidence_ready` through managed-provider execution |
| `npm run smoke:service` | Passed | builds first, then API-key service smoke reached `evidence_ready` for provider and manual paths and verified the operator dashboard |
| `npm run demo:manual-pilot` | Passed | strict-provenance manual rehearsal reached `evidence_ready` |
| `npm run demo:pilot` | Passed | deterministic mock proof-pack demo recommended iteration |
| `python3 <mmdx-skill>/scripts/mmd.py diagrams/inschneidergram-project-status.mmdx --preflight-only` | Passed | 10 charts |
| `npm run status:mmdx:dry-run` | Passed | target `https://buildooor.com/mmdx/buildooor/mmdx-inschneidergram-project-status`, source hash `62b2883bbb3867431659840d0c69a6cbfd4c5efe5b40e8c70bafe4cca5505bb5` |

## Live Pilot Intake Validation

`npm run pilot:intake:validate` validates the example intake kit against the
current API schemas and live-pilot gates:

```text
Pilot intake validation passed.
- campaign: graphed_creator_outreach_live_pilot_001
- targets scheduled: 3
- selected senders: sender-graphed-manual-1
- delivery path: manual
- webhook: https://hooks.graphed.com/inschneidergram/events
```

This proves the handoff files for campaign creation, sender inventory, launch
authorization, and callback configuration are executable. The bundled example
authorization window is renewed at runtime so public examples keep working;
private Graphed authorization files are validated exactly as supplied. This
still does not prove that the private Graphed creator list, sender account, or
authorization has been supplied.

## Live Pilot Intake API Rehearsal

`npm run pilot:intake:rehearse` takes the validated intake files through the
in-memory API and stops before any fake delivery evidence is recorded:

```text
Readiness after execution: awaiting_manual_evidence
Pending manual evidence: 3
```

Machine summary from the proof run:

```json
{
  "campaignSummary": {
    "total": 3,
    "scheduled": 3,
    "blockedPolicy": 0,
    "skippedDuplicate": 0
  },
  "readinessAfterExecution": {
    "status": "awaiting_manual_evidence",
    "readyForExecution": true,
    "readyForEvidenceReview": false,
    "pendingManualEvidence": 3,
    "externalInputs": ["operator delivery evidence"]
  },
  "manualQueue": {
    "pendingInitialEvidence": 3,
    "replyMonitoring": 0,
    "done": 0,
    "items": 3
  },
  "operatorDashboard": {
    "campaigns": 1,
    "awaitingManualEvidence": 1,
    "manualQueuePending": 3,
    "senderBlocked": 0,
    "deadLetters": 0
  }
}
```

This proves the intake handoff can create actionable API state: sender
inventory, campaign scheduling, creator/copy approval, operator claims, manual
execution, handoff, dashboard, and manual queue. It intentionally keeps the
remaining live-pilot blocker on operator evidence.

## Managed Provider Bridge Evidence

`npm run pilot:provider-bridge` builds a managed-provider handoff from the
validated intake files, then consumes provider-reported outcomes through the
existing `adapter.kind=managed_provider` execution route:

```text
Provider endpoint: https://provider.example.com/inschneidergram/deliver
Bridge handoff targets: 3
Provider outcomes consumed: 3
Readiness: evidence_ready
```

Machine summary from the proof run:

```json
{
  "handoffTargetCount": 3,
  "outcomeCount": 3,
  "bridgeRequest": {
    "provider": {
      "id": "graphed-managed-provider",
      "endpoint": "https://provider.example.com/inschneidergram/deliver",
      "accountRiskOwner": "provider"
    },
    "launchAuthorizationReference": "graphed-managed-provider-approval-001",
    "outcomeContract": "Provider must return exactly one accepted/rejected outcome with one or more sent/failed/restricted/replied events for every approved target."
  },
  "proofMetrics": {
    "contactedTargets": 2,
    "sentMessages": 2,
    "replies": 1,
    "interestedReplies": 1,
    "deliveryFailures": 1,
    "senderWarnings": 1,
    "webhookDelivered": 4,
    "webhookDeadLetters": 0
  },
  "readiness": {
    "status": "evidence_ready",
    "readyForEvidenceReview": true,
    "externalInputs": []
  }
}
```

This narrows the provider-path gap: a managed provider can receive a handoff
payload and return explicit outcomes that flow through execution, callbacks,
readiness, and proof metrics. The fixture still is not live Instagram delivery;
a real provider or account owner must replace it before bounty proof.

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
- `npm run pilot:intake:validate` exercises the private-input file contract
  before campaign creation.
- `npm run pilot:intake:rehearse` turns that contract into actionable manual
  queue state without recording fake live proof.
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
- passes a fresh, evidence-backed manual `launchAuthorization`
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
  "approvedAt": "2026-05-30T14:38:10.933Z",
  "expiresAt": "2026-06-06T14:38:10.933Z",
  "reference": "manual-demo-launch-approval",
  "evidenceUrl": "https://docs.graphed.com/approvals/manual-demo-launch-approval",
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
- The evaluator-facing local proof path can be run with
  `npm run proof:bounty-local`.
- The live pilot intake files can be validated before private campaign creation
  with `npm run pilot:intake:validate`.
- The live pilot intake files can be rehearsed through campaign creation,
  approval, manual execution, handoff, dashboard, and manual queue creation
  with `npm run pilot:intake:rehearse`.
- The managed-provider bridge can export approved send intents and consume
  provider-reported outcomes into proof metrics with
  `npm run pilot:provider-bridge`.
- Production or non-loopback startup requires strong API and webhook secrets.
- Public webhook destinations are DNS-checked and the sender uses the
  prevalidated DNS addresses for the outbound request.
- Provider-event webhook delivery records are appended back into the latest
  execution proof pack.
- Renewal is blocked to `iterate` when sender warnings, delivery failures, or
  webhook dead letters exist.
- The project-status MMDX stack parses successfully with 10 charts.
- The repo now has token-safe `status:mmdx:*` npm scripts for preflight,
  dry-run payload inspection, Buildooor MMDX listing, SPAPS login, and publish.

## What This Does Not Prove

- No live Instagram DM was sent.
- No Graphed creator list was contacted.
- No real provider/account operation has been verified.
- No public Buildooor MMDX short link has been live-verified yet; the current
  local Buildooor credential returns `401 Invalid or expired access token`.
- No official Meta cold-DM compliance claim is made.

## Next Required Evidence

- refreshed Buildooor SPAPS auth through `npm run status:mmdx:login`
- live-verified publish through `npm run status:mmdx:publish`
- one low-volume real test handoff through the selected manual/provider path
- private sender/provider credentials or operator-owned account setup
- vetted Graphed creator list and explicit launch authorization
- proof pack generated from real pilot records
