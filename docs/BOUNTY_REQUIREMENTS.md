# Bounty Requirements

Source basis: Graphed Notion bounty URL from the user prompt, retrieved
2026-05-30. See [SOURCE_EVIDENCE.md](SOURCE_EVIDENCE.md) for access limits:
the URL is reachable, but unauthenticated HTML does not expose stable bounty
body text in this shell, so this document should be treated as
operator-provided bounty interpretation until a reviewer with page access
cross-checks it.

## Working Acceptance Assumption

Based on the operator-provided bounty interpretation, Graphed builds and
operates AI agents for growth teams and needs reliable creator and influencer
outreach on Instagram:

- provide a vetted list of Instagram profiles
- provide a message or template
- configure campaign settings, limits, metadata, and optional follow-ups
- receive delivery and reply status through callback, webhook, or API response

## Product Must Handle

- sender account setup and management
- safe sending limits and throttling
- campaign execution
- duplicate prevention
- reporting
- maintenance when Instagram changes behavior
- ongoing reliability

## Ideal Interface

```http
POST /campaigns
content-type: application/json

{
  "targets": ["instagram_profile_1", "instagram_profile_2"],
  "message": "Hey - loved your content. Would you be open to an affiliate partnership?",
  "campaign": "client_creator_outreach_may_2026"
}
```

## Explicit Non-Goals

- not a one-off script
- not a GitHub repo alone
- not fragile automation that Graphed must host and maintain
- not a pitch deck

## Bounty Acceptance

The bounty is paid only if:

- a working product matches the request
- Graphed can run a real pilot
- the pilot completes meaningful Instagram creator outreach
- the product is reliable enough for ongoing client deployments

## Product Interpretation

The repo must become a managed service product. Code alone will not win unless
it is paired with operational ownership, delivery infrastructure, account
management, monitoring, and a pilot-ready runbook.
