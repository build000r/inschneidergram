# Marketing Surface

## Claim Contract

| Claim | Status | Evidence required before public use |
| --- | --- | --- |
| "Start Instagram creator outreach with one API call" | Partly true | API exists; verified delivery operations still required. |
| "Managed-service interface, not a script" | Partly true | Service interface exists; verified sender operations, incident handling, and real pilot still required. |
| "Duplicate-safe campaigns" | True for MVP scope | Domain tests cover duplicate prevention inside a campaign. |
| "Provenance-backed creator intake" | True for MVP scope | Campaign targets can carry source and fit rationale; strict campaigns block unvetted targets and proof packs count vetted targets. |
| "Follow-up planning" | True for MVP scope | Campaign follow-up rules now produce due/pending operator work after execution and suppress targets after late provider replies/failures; automatic follow-up sending is not claimed. |
| "Pre-campaign pilot launch packet" | True for MVP scope | `GET /pilot-launch-packet` exports the private-input checklist, creator schema, sender boundary, delivery-path options, authorization template, proof metrics, and stop conditions before a campaign exists. |
| "Pilot handoff packet" | True for MVP scope | `GET /campaigns/:id/pilot-handoff` turns readiness into missing inputs, next API actions, source URLs, evidence requirements, and proof-review state. |
| "Operator dashboard" | True for MVP scope | `GET /operator/dashboard` aggregates readiness, manual queue counts, sender health, follow-ups, latest proof metrics, runtime dead letters, urgent actions, and source URLs without claiming live delivery. |
| "Launch authorization gate" | True for MVP scope | Manual and managed-provider executions require a fresh, evidence-backed authorization object and preserve it in proof exports; mock demos remain exempt. Bundled local examples renew their fixture windows without weakening private pilot validation. |
| "Canonical proof packet" | True for MVP scope | `GET /campaigns/:id/proof-packet` exports a redacted replay packet with launch authorization, delivery attempts, webhook attempts, evidence references, source URLs, and deterministic SHA-256. |
| "Current local proof dossier" | True for MVP scope | `docs/proof/delivery-path-dry-run.md` records test, typecheck, build, service-smoke, Docker-smoke, manual-rehearsal, mock-demo, and MMDX preflight/dry-run evidence while excluding live delivery claims. |
| "Source-quality and caveat dossier" | True for MVP scope | `docs/SOURCE_EVIDENCE.md` separates reachable external sources, blocked/inaccessible sources, local proof, and operator-provided bounty interpretation; citation-grade claims are limited to reachable sources. |
| "Bounty submission packet" | True for MVP scope | `docs/BOUNTY_SUBMISSION.md`, `npm run proof:bounty-local`, and opt-in `npm run proof:bounty-local:docker` give evaluators local proof paths while excluding live delivery claims. |
| "Delivery and reply reporting" | Partly true | Provider events now require event-specific evidence before execution proof insertion, then refresh campaign status, latest proof metrics, follow-up state, and signed runtime callbacks by default; live provider integration still pending. |
| "API-key protected service" | True for MVP scope | Production or non-loopback startup requires strong `INSCHNEIDERGRAM_API_KEY` and `INSCHNEIDERGRAM_WEBHOOK_SECRET`; smoke runs with auth enabled. |
| "Guarded callback delivery" | True for MVP scope | Webhook URLs must be public HTTPS destinations; local/private/special-use hosts are blocked, production allowlists are supported, and dispatch uses prevalidated DNS answers. |
| "Sender-risk-aware manual evidence" | True for MVP scope | Manual restriction evidence for managed senders writes back into sender risk state, proof metrics, and readiness/execution gates. |
| "Production-ready" | Not yet | Requires stronger persistence, monitoring, real adapter operations, and pilot evidence. |

## Approved Current Copy

Inschneidergram is an API-first control plane for managed Instagram creator
outreach. It turns Graphed's bounty-shaped `POST /campaigns` request into a
validated campaign, provenance-backed targets, duplicate-safe scheduling, and
inspectable delivery/reply status.

## Copy Not Yet Allowed

- "Fully automated Instagram outreach"
- "Production-ready Instagram DM sending"
- "Safe for all Instagram accounts"
- "Guaranteed delivery"
- "Official Meta-compliant outbound cold DM"

Those claims need live delivery evidence and compliance review before they can
be used.
