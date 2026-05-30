# Build-vs-Clone Analysis

## Verdict

**BUILD the API/control-plane product here; BORROW compliance and operational
patterns from established Instagram DM automation products; do not ADOPT a
private-API GitHub library as the core product.**

## Why

The bounty is not looking for source code that can send a DM once. It is looking
for a managed operational layer that Graphed can call programmatically without
owning sender accounts, browser automation, infrastructure maintenance, or
Instagram breakage.

Existing products prove demand and product shape, but most public products are
inbound/comment-to-DM automation rather than outbound creator-list outreach.
Open-source private API clients can be useful for prototyping, but adopting one
would fail the managed-product and reliability bar by pushing platform risk into
the repo.

## Placement

Outcome: **NEW REPO**.

`inschneidergram` is a clean bounded context: campaign API, sender/account
operations, delivery adapters, reporting, and pilot evidence for Instagram
creator outreach.

## Adopt / Borrow / Build

| Candidate | Decision | Reason |
| --- | --- | --- |
| ManyChat-style Instagram automation | Borrow | Validates demand and official-API patterns, but not a Graphed-owned API product. |
| Waveloop / Lyncly / DMFlow-style tools | Borrow | Strong inspiration for safety, OAuth, webhooks, analytics, and no-password positioning. |
| Unofficial Instagram private API libraries | Do not adopt | They increase account and maintenance risk; useful only behind a managed adapter if risk is owned. |
| Browser automation scripts | Do not adopt | Directly violates the bounty's "do not make us maintain automation" constraint. |
| New managed API product | Build | Required to expose the exact `POST /campaigns` interface and own delivery reliability. |

## First Build Slice

The first slice is the campaign control plane:

- request validation
- target normalization
- duplicate prevention
- safe scheduling defaults
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

## Next Build Slice

The service-hardening slice now exists: startup config is validated, `/health`
checks the JSON store, `npm run smoke:service` starts the compiled API and runs
the approval-to-provider-execution flow through real HTTP, and the repo includes
Docker packaging for a `/data/campaigns.json` runtime store.

The next build work should stay in this repo but move closer to pilot
operations: proof export ergonomics, operator-facing status views, and the
adapter implementation for whichever real provider/account operation the pilot
uses. A real Instagram delivery provider remains an external operations
integration behind this repo's adapter contract, not a reason to adopt an
unofficial private-API library directly into the core product.

## Source Notes

- Meta's Instagram Send API documentation says conversations begin only after
  an Instagram user messages the professional account, and the recipient must
  have messaged the IG professional account before API send.
- ManyChat's messaging-window guidance reflects the 24-hour automation window
  constraints common to official Meta messaging automation.
- Unipile and private API libraries are adapter candidates, not compliance
  shields; if used, the product must name and own the operational risk.
