# Pilot Spec

## Pilot Objective

Prove that Graphed can run a meaningful Instagram creator outreach campaign
through Inschneidergram without operating sender accounts, browser automation,
or campaign-status bookkeeping themselves.

## ICP

Immediate buyer: Graphed, acting as an AI-agent operator for growth teams.

Economic buyer: founder, revenue owner, or head of growth who needs creator or
influencer replies that can become affiliate partnerships, booked calls,
content collaborations, or qualified pipeline.

## Pilot Inputs

- 50-200 vetted Instagram creator profiles
- source and fit rationale for every creator target when strict provenance is
  enabled
- one campaign offer
- one approved first-touch message or template
- creator approval criteria and approving actor
- copy approval criteria and approving actor
- optional follow-up copy with delay windows; `GET /campaigns/:id/follow-ups`
  exposes due and pending follow-up work after execution and drops targets
  after late provider replies or failures
- managed sender account ids registered through the sender API or selected
  delivery adapter
- stop conditions for opt-outs, complaints, sender warnings, and low quality
- webhook or export destination for outcomes; webhook URLs must be public HTTPS
  destinations and should match the deployment allowlist

## Launch Readiness

Before running a pilot, Graphed or the operator should call
`GET /campaigns/:id/readiness`. The report classifies the campaign as blocked,
needing approval, ready to execute, awaiting manual evidence, or evidence-ready.
It also names the missing external inputs so the pilot cannot look ready while
creator approvals, approved copy, a healthy sender/provider, operator evidence,
or launch authorization are still missing. Manual and managed-provider
executions require a `launchAuthorization` object with actor, delivery path,
approved target limit, approval timestamp, and reference/evidence pointer; mock
executions are exempt for local rehearsal.
`GET /campaigns/:id/pilot-handoff` turns the same readiness state into an
operator packet: source URLs, next API actions, missing external inputs,
creator/sender/evidence contracts, launch-authorization expectations, proof
criteria, stop conditions, follow-up state, and latest execution context.
For campaigns scheduled from managed sender ids, readiness rechecks the current
stored sender inventory so post-creation lockouts or cooldowns block launch.
Manual `restricted` evidence for managed senders writes back into that sender
risk inventory, so follow-on readiness and execution checks see the cooldown
without relying on a separate operator step.
The credential-free manual rehearsal exercises this with two managed senders
and strict creator-provenance intake: both demo targets carry source and fit
rationale, one restricted sender cools down, one sender remains healthy, and
the proof pack records a sender warning while staying ready for evidence
review.
For strict pilot intake, set `settings.requireTargetProvenance=true`; readiness
then requires every accepted creator target to carry both `source` and
`fitReason`.

## Success Thresholds

The exact thresholds should be negotiated with Graphed before the pilot. The
default proof pack should include:

- accepted targets
- vetted/provenance-backed targets
- approved targets
- approved first-touch copy
- due and pending follow-up items when follow-up rules are configured
- contacted targets
- sent messages
- delivered messages when provider can prove delivery
- replies
- positive or qualified interested replies
- duplicate skips
- blocked or policy-skipped targets
- operator-skipped targets with evidence
- operator-blocked targets with evidence
- opt-outs or complaints
- sender warnings or restrictions
- operator time and incident notes

## Buyer Confidence Gates

| Gate | Evidence |
| --- | --- |
| Managed campaign setup | campaign request includes ICP, offer, exclusions, message/copy, settings, and sender constraints |
| Creator fit quality | each creator has provenance, fit rationale, and approval state |
| Compliance posture | no hidden private-API claim; risk path is named per adapter |
| Human/operator control | risky sends can require approval and operator evidence |
| Audit trail | every status change has timestamp, actor/source, and reason |
| Reply loop | replies can be captured, triaged, and exported |
| Pilot economics | qualified replies and cost/time per qualified reply are visible |
| Proof pack | final report is sufficient for renewal/adoption decision |

## Non-Goals

- no mass scrape-and-blast workflow
- no claim that official Meta APIs permit arbitrary cold DMs
- no requirement that Graphed host browser automation
- no pitch-only deliverable

## Stop Conditions

- sender account restriction or warning
- complaint rate above agreed threshold
- duplicate send attempt detected after suppression
- target list provenance cannot be defended
- creator or copy approval cannot be produced before send
- delivery adapter cannot produce enough status evidence for the proof pack

Sender restrictions, warnings, lockouts, and reconnect requirements should be
recorded as sender risk events before any further readiness or execution check.

## Operator Workbench

The pilot workbench should expose every creator candidate and first-touch copy
candidate with approval state, claim state, evidence, and audit history. Sends
are only valid after creator approval, message approval, and operator claim.
Operators can then record one terminal outcome per creator: sent, skipped, or
blocked.

For manual executions, the operator queue should be the working surface. It
lists the latest manual attempts that still need initial evidence by default,
then exposes reply-monitoring and done views for audit and renewal review.

## Proof Pack Generator

The domain proof pack turns campaign status, approval state, delivery attempts,
webhook delivery records, sender health, reply assessments, and incidents into
metrics plus a Markdown renewal report. Campaign policy blocks stay separate
from operator skipped/blocked targets so the renewal report shows manual triage
decisions without counting approval rejections as operator blocks. It is still
sample-fixture or provider-reported contract proof until a live Graphed pilot
runs through a verified managed delivery path. Provider events recorded after
execution refresh the latest proof pack, so late replies and failures are
visible in the buyer-facing export.
