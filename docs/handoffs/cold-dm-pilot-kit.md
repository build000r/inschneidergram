# Cold-DM Pilot Kit (DRAFT — pending operator approval)

> **STATUS: DRAFT.** All copy below is a starting draft for the operator to
> review, edit, and approve before any message is sent. Nothing here is
> launch-authorized. No DMs may be sent until the operator completes the
> [Operator-Only Inputs Still Required](#operator-only-inputs-still-required)
> checklist and records a real `launchAuthorization` per
> [`PILOT_INTAKE_KIT.md`](../PILOT_INTAKE_KIT.md).

## Purpose

This kit pre-drafts the human-facing materials for bead
`inschneidergram-j8b.3` — the operator-run **manual** managed cold-DM pilot
(`deliveryPath=manual`, `accountRiskOwner=operator`) decided in
[`DELIVERY_PATH_DECISION.md`](../DELIVERY_PATH_DECISION.md). The goal is that the
operator's remaining work is **review + supply private inputs + authorize**, not
writing copy from scratch.

## What this pilot actually is

- **Product:** Inschneidergram — an API-first control plane for *managed*
  Instagram creator outreach. The buyer (Graphed) submits a campaign of vetted
  creators and approved copy; the platform enforces provenance, approval, and
  sender-limit gates, queues only approved actions, and records every per-message
  outcome for a proof pack.
- **The offer in the DM:** a small **affiliate pilot with Graphed** (per the
  bounty interpretation in [`BOUNTY_REQUIREMENTS.md`](../BOUNTY_REQUIREMENTS.md)
  and the example campaign in
  `examples/live-pilot-campaign.example.json`). Replace this with the operator's
  *actual* approved offer (`metadata.offer` is currently
  `replace-with-approved-offer`) before sending.
- **Audience:** Instagram creators/influencers vetted by the operator, each
  carrying a `source` and `fitReason`.
- **Delivery:** a human operator sends each first-touch DM by hand from a warmed
  sender account, then records the outcome through
  `POST /campaigns/:id/executions/:executionId/manual-events`. No scraping, no
  bot automation, no burner accounts.

## Copy guardrails (do not break when editing)

These come from [`MARKETING-SURFACE.md`](../MARKETING-SURFACE.md) and
[`VISION.md`](../VISION.md):

- Value-first and short. One creator-specific reason, one clear ask, one easy
  opt-out. No mass-blast feel.
- Do **not** invent metrics, payout numbers, follower counts, audience figures,
  or results. Use placeholders in `[brackets]` for anything the operator must
  fill from real, approved values.
- Do **not** claim official Meta compliance, guaranteed delivery, or partnership
  status the operator cannot back up.
- Personalize the opener per creator — reference something real from their
  recent content. The `[specific recent post/topic]` placeholder must be filled
  by hand per target.
- Identify the sender and who they represent. Give a real, frictionless way to
  decline (it satisfies the opt-out outcome the proof pack tracks anyway).

---

## a. First-touch DM (DRAFT)

Short, value-first, personalized, with a built-in opt-out. Fill every
`[bracket]` with real, approved values before sending.

```
Hi [first name] — I'm [sender name] with Graphed. Genuinely enjoyed your
[specific recent post/topic]; the way you [one concrete, true detail] stood out.

We're running a small, low-volume affiliate pilot and your audience looks like a
strong fit. No pressure and no obligation — would you be open to me sending the
short details so you can decide?

If this isn't your thing, just say so and I won't follow up. Either way, keep up
the great work.
```

Notes for the operator:
- `[sender name]` = the real person sending, from the warmed sender account.
- `[specific recent post/topic]` and `[one concrete, true detail]` = must be a
  genuine, per-creator observation. Do not template these into something generic.
- Keep the "affiliate pilot" framing aligned with `metadata.offer` once the real
  offer is approved. If the approved offer is not affiliate, change this line.
- The closing opt-out sentence is intentional: it is value-respecting and feeds
  the proof pack's opt-out tracking honestly.

## b. Follow-up DM (DRAFT)

Send once only, after the configured delay (the example campaign uses
`delayHours: 48`). One follow-up maximum unless the operator approves more. If
the creator opted out on the first touch, do **not** send this.

```
Hi [first name] — quick, last note from me in case my earlier message got
buried. Still happy to share the short pilot details if it's useful, and totally
fine if it's not the right time. I'll leave it here either way — thanks again
for the great content.
```

Notes for the operator:
- Acknowledges the prior message, gives one final easy out, and explicitly
  states this is the last touch (no nagging cadence).
- Mirrors the example follow-up tone in
  `examples/live-pilot-campaign.example.json`
  (`"Quick follow-up in case this is relevant..."`) but is the approval-pending
  draft of record.

---

## c. Proof-pack template (operator fills after each send)

Fill one row per creator while running the pilot. These fields make the bead's
proof requirement trivial to satisfy and map directly onto the manual-evidence
API (`POST /campaigns/:id/executions/:executionId/manual-events`) and the proof
metrics enumerated in [`PILOT_SPEC.md`](../PILOT_SPEC.md) and the bead
acceptance criteria.

### Per-creator log

| Creator handle | Date sent | Sender account | First-touch sent? | Follow-up sent? | Response (verbatim/summary) | Outcome | Screenshots link |
| --- | --- | --- | --- | --- | --- | --- | --- |
| @example_handle | YYYY-MM-DD | sender-graphed-manual-1 | yes | no | _paste reply or "no response"_ | sent / replied / interested / opt-out / complaint / failed / duplicate-skip / operator-skip / operator-block | _private link placeholder_ |

**Outcome vocabulary** (one terminal outcome per creator; matches the
manual-evidence + proof-pack model):
- `sent` — first-touch delivered by hand, no reply yet
- `replied` — creator replied (record the text in the Response column)
- `interested` — qualified/positive reply worth follow-through
- `opt-out` — creator asked not to be contacted (honor immediately, no follow-up)
- `complaint` — creator complained / flagged spam
- `failed` — message could not be sent (account, block, or platform issue)
- `duplicate-skip` — suppressed because already contacted
- `operator-skip` — operator chose not to send (record reason)
- `operator-block` — operator blocked the target (record reason)

### Pilot roll-up (fill at the end)

Counts below are the bead's required proof fields. Take them from the per-creator
log and reconcile against `GET /campaigns/:id/proof-pack`.

| Metric | Count | Notes |
| --- | --- | --- |
| Sourced (candidates) | | from the vetted creator list |
| Approved (creator + copy) | | only approval-gated targets |
| Contacted | | first-touch attempted |
| Delivered | | only if delivery can be evidenced |
| Replied | | |
| Interested / qualified | | |
| Opt-outs | | |
| Complaints | | |
| Duplicate skips | | suppression records |
| Sender health | | warnings / restrictions / lockouts observed |
| Incidents | | per stop conditions in PILOT_SPEC.md |
| Operator time | | total hands-on time |
| Renewal recommendation | | renew / iterate / stop, with one-line rationale |

- **Screenshots link:** store screenshots in the operator's private system
  (never in this public repo); paste only the private link here.
- **Canonical proof:** after recording manual events, export
  `GET /campaigns/:id/proof-pack` and the matching
  `GET /campaigns/:id/proof-packet` SHA-256 so the published proof is generated
  from real pilot records, not fixtures (the bead's validation requirement).

---

## Operator-Only Inputs Still Required

> **OPERATOR-ONLY.** These are private inputs and authorizations the operator
> must supply. They must **not** be committed to this public repo. An agent must
> not perform these on the operator's behalf. The pilot cannot launch until all
> are satisfied.

1. **Vetted creator list** — real Instagram targets, each with `source` and
   `fitReason` (profile-object form, see
   `examples/live-pilot-campaign.example.json`). Kept private.
2. **Approved final copy** — operator's reviewed/edited first-touch and
   follow-up DMs, replacing the DRAFT copy above and matching the real
   `metadata.offer`.
3. **Sender account access** — warmed, operator-owned sender account(s);
   credentials/session/proxy material stay entirely outside this repo
   (`accountRiskOwner=operator`).
4. **Manual launch authorization** — a real, current `launchAuthorization`
   object (`approvedAt`, unexpired `expiresAt`, reference, evidence URL) per
   [`PILOT_INTAKE_KIT.md`](../PILOT_INTAKE_KIT.md). This is the explicit
   go/no-go gate; no agent may set it.
5. **HTTPS callback destination** — a public HTTPS webhook URL on the
   allowlist for delivery/reply events (private/local hosts are blocked by the
   webhook guard).

### Once those are in hand (operator runbook pointer)

Validate, rehearse, launch, and publish proof following
[`PILOT_INTAKE_KIT.md`](../PILOT_INTAKE_KIT.md) "Live Pilot Use" and
[`PILOT_RUNBOOK.md`](../PILOT_RUNBOOK.md): run `npm run pilot:intake:validate` on
the private kit, register senders, create the campaign, approve only authorized
creators/copy, execute with `adapter.kind=manual` + the real
`launchAuthorization`, record outcomes via `manual-events`, then publish the
proof pack and packet hash.
