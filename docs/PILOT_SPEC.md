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
- one campaign offer
- one approved first-touch message or template
- creator approval criteria and approving actor
- copy approval criteria and approving actor
- optional follow-up copy
- sender account pool or selected delivery adapter
- stop conditions for opt-outs, complaints, sender warnings, and low quality
- webhook or export destination for outcomes

## Success Thresholds

The exact thresholds should be negotiated with Graphed before the pilot. The
default proof pack should include:

- accepted targets
- approved targets
- approved first-touch copy
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

## Operator Workbench

The pilot workbench should expose every creator candidate and first-touch copy
candidate with approval state, claim state, evidence, and audit history. Sends
are only valid after creator approval, message approval, and operator claim.
Operators can then record one terminal outcome per creator: sent, skipped, or
blocked.

## Proof Pack Generator

The domain proof pack turns campaign status, approval state, delivery attempts,
webhook delivery records, sender health, reply assessments, and incidents into
metrics plus a Markdown renewal report. Campaign policy blocks stay separate
from operator skipped/blocked targets so the renewal report shows manual triage
decisions without counting approval rejections as operator blocks. It is still
sample-fixture proof until a live Graphed pilot runs through the managed
delivery path.
