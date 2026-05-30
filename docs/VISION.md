# Vision

## Product Thesis

Instagram creator outreach should be callable like infrastructure. Graphed's
agents should be able to submit a campaign, receive status, and trust that the
messy delivery layer is operated by the product owner.

The bounty is not for a clever automation snippet. It is for a managed
Instagram outreach product with a clear API and enough operational reliability
to support client deployments.

## Multi-Escalated Vision

### Level 1: API Control Plane

Ship a clean campaign API:

- `POST /campaigns`
- target normalization
- duplicate prevention
- safe scheduling
- delivery/reply events
- status inspection
- signed webhook payloads

Proof: tests and local API demo pass.

### Level 2: Pilot-Ready Managed Delivery

Attach a real delivery adapter and operator runbook:

- send intent handoff contract
- adapter risk posture
- sender account inventory
- daily limits and warm-up state
- delivery attempt logs
- sent, failed, restricted, and replied events
- incident notes
- account health checks
- manual override path
- manual proof requirements for operator-verified sends and replies

Proof: a small campaign can be run without Graphed touching Instagram sessions
or browser automation.

### Level 3: Reliability Product

Make delivery resilient:

- persistent storage
- idempotent campaign creation
- replayable events
- webhook retries
- per-sender risk budgets
- duplicate suppression across campaigns
- operational dashboard or CLI

Proof: pilot report shows sent/delivered/replied/failed/skipped counts and a
clear incident trail.

### Level 4: Bounty-Winning Deployment

Run a meaningful Graphed pilot and earn adoption:

- real creator list
- real sender accounts
- measurable campaign completion
- reliable reporting
- post-pilot deployment plan

Proof: Graphed can adopt the product for ongoing client deployments.

## Non-Negotiables

- Do not represent a mock provider as real Instagram delivery.
- Do not claim official cold-DM compliance from this adapter contract.
- Do not force Graphed to host or maintain browser automation.
- Do not hide account risk; model it as product state.
- Do not overfit to one pilot campaign at the expense of repeatable operations.
- Do not claim compliance certainty without evidence from the actual delivery
  path.

## Product Promise

Programmatic, policy-aware Instagram outreach for growth agents: rank who to
contact, generate the safest next action, queue approved sends, and write
outcomes back without scraping, burner accounts, or unsafe cold-DM claims.

## Current Reality

The repo now has the API-control-plane slice and a domain delivery adapter
contract with mock and manual behavior. It is not yet bounty-complete. The next
decisive milestone is connecting this contract to a real operator workbench or
managed provider path and generating a pilot proof pack.
