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
- optional follow-up copy
- sender account pool or selected delivery adapter
- stop conditions for opt-outs, complaints, sender warnings, and low quality
- webhook or export destination for outcomes

## Success Thresholds

The exact thresholds should be negotiated with Graphed before the pilot. The
default proof pack should include:

- accepted targets
- approved targets
- contacted targets
- sent messages
- delivered messages when provider can prove delivery
- replies
- positive or qualified interested replies
- duplicate skips
- blocked or policy-skipped targets
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
- delivery adapter cannot produce enough status evidence for the proof pack
