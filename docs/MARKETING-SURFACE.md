# Marketing Surface

## Claim Contract

| Claim | Status | Evidence required before public use |
| --- | --- | --- |
| "Start Instagram creator outreach with one API call" | Partly true | API exists; verified delivery operations still required. |
| "Managed, not a script" | Aspirational | Need sender operations, incident handling, and real pilot. |
| "Duplicate-safe campaigns" | True for MVP scope | Domain tests cover duplicate prevention inside a campaign. |
| "Provenance-backed creator intake" | True for MVP scope | Campaign targets can carry source and fit rationale; strict campaigns block unvetted targets and proof packs count vetted targets. |
| "Follow-up planning" | True for MVP scope | Campaign follow-up rules now produce due/pending operator work after execution and suppress targets after late provider replies/failures; automatic follow-up sending is not claimed. |
| "Pilot handoff packet" | True for MVP scope | `GET /campaigns/:id/pilot-handoff` turns readiness into missing inputs, next API actions, source URLs, evidence requirements, and proof-review state. |
| "Delivery and reply reporting" | Partly true | Provider events refresh campaign status, latest proof metrics, follow-up state, and signed runtime callbacks by default; live provider integration still pending. |
| "API-key protected service" | True for MVP scope | Optional `INSCHNEIDERGRAM_API_KEY` protects non-public routes; smoke runs with auth enabled. |
| "Guarded callback delivery" | True for MVP scope | Webhook URLs must be public HTTPS destinations; local/private/special-use hosts are blocked and production allowlists are supported. |
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
