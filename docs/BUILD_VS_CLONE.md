# Build-vs-Clone Analysis

## Verdict

**BUILD the API/control-plane product here; BORROW API, policy-boundary, and
operational patterns from established Instagram DM automation products; do not
ADOPT a private-API GitHub library as the core product.**

## Why

The bounty is not looking for source code that can send a DM once. It is looking
for a managed operational layer that Graphed can call programmatically without
owning sender accounts, browser automation, infrastructure maintenance, or
Instagram breakage.

Public platform and provider sources show that Instagram messaging automation
and inbox products exist, but they do not prove official permission for
arbitrary cold outbound creator-list DMs. Sampled public products should be
treated as evidence of product shape only: Meta's inbox/private-reply docs,
Unipile-style provider APIs, and the Waveloop/Lyncly/DMFlow-style no-password,
inbox, webhook, analytics, and safety positioning named in the audit are
inspiration, not market sizing or compliance proof. Open-source private API
clients can be useful for prototyping, but adopting one would fail the
managed-product and reliability bar by pushing platform risk into the repo.

## Placement

Outcome: **NEW REPO**.

`inschneidergram` is a clean bounded context: campaign API, sender/account
operations, delivery adapters, reporting, and pilot evidence for Instagram
creator outreach.

## Adopt / Borrow / Build

| Candidate | Decision | Reason |
| --- | --- | --- |
| Meta official messaging and private-reply patterns | Borrow | Validates inbox, reply, webhook, human-agent, and time-window patterns, but not arbitrary cold creator-list outreach. |
| Waveloop / Lyncly / DMFlow-style tools | Borrow | Strong inspiration for safety, OAuth, webhooks, analytics, and no-password positioning. |
| Unofficial Instagram private API libraries | Do not adopt | They increase account and maintenance risk; useful only behind a managed adapter if risk is owned. |
| Browser automation scripts | Do not adopt | Directly violates the bounty's "do not make us maintain automation" constraint. |
| New managed API product | Build | Required to expose the exact `POST /campaigns` interface and own delivery reliability. |

## First Build Slice

The first slice is the campaign control plane:

- request validation
- target normalization
- duplicate prevention
- sender-limit scheduling defaults
- sender assignment
- status/event model
- webhook signing
- API tests

This slice does not pretend to solve live Instagram delivery. It creates the
contract that a real managed delivery adapter must satisfy.

## Delivery Slice Status

The delivery adapter boundary now exists, with two pilot paths represented in
the product surface:

1. **Managed manual/human-assisted delivery adapter** for low-volume pilot
   proof, with explicit operator queues and status updates.
2. **Managed automation provider adapter** where the account/session risk is
   owned by the product operator, not Graphed.

Either path must produce evidence: accepted targets, sent counts, delivered
counts, replies, skips, duplicate blocks, failures, and incident notes.

The repo now models this as a domain-level managed delivery adapter contract:

- `SendIntent` records the campaign, target handle, sender account, approved
  message, schedule time, and metadata handed to delivery.
- every adapter declares risk posture, including `officialColdDmCompliance:
  "not_claimed"` so mock, manual, or provider paths cannot be mistaken for an
  official cold-DM compliance guarantee.
- mock delivery can emit `sent`, `failed`, `restricted`, and `replied` events
  for contract tests and dry-run proof design.
- manual delivery returns `needs_manual_evidence` until an operator records
  required evidence such as operator ID, conversation URL, screenshots,
  restriction source, and reply capture time.
- managed-provider delivery accepts explicit provider-reported outcomes through
  `POST /campaigns/:id/executions` while retaining the same risk-posture and
  event-reporting contract.

## Delivered Build Slices

The service-hardening slice now exists: startup config is validated, production
or non-loopback startup requires strong API/webhook secrets, `/health` checks
the JSON store, `npm run smoke:service` builds and starts the compiled API with
auth enabled, runs the approval-to-provider-execution flow through real HTTP,
runs the selected manual evidence flow through real HTTP, and the repo includes
Docker packaging for a `/data/campaigns.json` runtime store.

The proof-export ergonomics slice now exists at `GET /campaigns/:id/proof-pack`:
buyers/operators can retrieve the latest execution proof pack, readiness
context, source URLs, metrics, renewal recommendation, Markdown, and embedded
canonical proof packet from one campaign-level API call. `GET
/campaigns/:id/proof-packet` exposes the redacted replay packet directly with a
deterministic SHA-256 over the stable canonical body.

The pre-campaign launch packet now exists at `GET /pilot-launch-packet`:
Graphed can see the private-input checklist, creator profile schema, sender
credential boundary, delivery-path options, launch-authorization template,
proof metrics, stop conditions, sample campaign payload, and validation
commands before submitting a live creator list.

## Next Build Work

The next build work should stay in this repo only when it moves the real pilot
closer. The operator dashboard now covers the local status-view gap, so the
decisive remaining work is the adapter implementation and operating runbook for
whichever real provider/account operation the pilot uses. A real Instagram
delivery provider remains an external operations integration behind this repo's
adapter contract, not a reason to adopt an unofficial private-API library
directly into the core product.

## Source Notes

See [SOURCE_EVIDENCE.md](SOURCE_EVIDENCE.md) for retrieval dates, URLs, and
access caveats.

- Meta's Instagram Messaging docs describe messaging solutions for Instagram
  professional accounts, but the reachable docs say app-initiated sending starts
  after the Instagram user has messaged the professional account and must fit
  the documented response window or human-agent rules. That supports the
  "borrow official messaging patterns" decision, not an official cold-DM
  compliance claim.
- Meta's private-reply docs document comment-triggered private replies with
  one-message, seven-day, live-broadcast, and follow-up response-window limits.
  That is an official automation pattern, not proof of general cold outreach.
- The Postman public Meta Instagram Send API folder is reachable, but useful
  content is client-side; treat it as an API-shape pointer rather than a
  citation-grade source.
- Unipile's public Instagram API page shows third-party provider capabilities
  such as account linking, realtime webhooks, quota/proxy protection, and
  unified provider APIs. That makes provider adapters plausible, but not a
  compliance shield.
- Waveloop, Lyncly, and DMFlow public pages show sampled product-shape patterns
  around official-login language, comment-to-DM automation, webhooks, analytics,
  dedupe/rate-limit claims, and no-password positioning. These are product-shape
  references, not market sizing or compliance proof.
- ManyChat messaging-window evidence is intentionally omitted from strong
  claims until it is available from a citation-grade source.
