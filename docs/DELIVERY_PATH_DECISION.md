# Delivery Path Decision & Provider Landscape

Decided: 2026-05-31 · Path: **operator-run manual managed**
(`deliveryPath: manual`, `accountRiskOwner: operator`)

This record explains *why* Inschneidergram's first live pilot runs as a
human-operated managed path rather than through an automated third-party
provider. It is the rationale behind the `officialColdDmCompliance: "not_claimed"`
posture and the manual selection in
[BOUNTY_SUBMISSION.md](BOUNTY_SUBMISSION.md). It is evidence of domain
diligence, not a compliance claim.

## Decision in one line

No compliant, fully-managed third-party provider exists that will operate
Instagram sender accounts to send **cold** creator-outreach DMs and return
per-message delivery/reply status. The only path that is simultaneously
*managed*, *cold-capable*, and *honest about per-message status* is a human
operator sending from warmed accounts through this repo's manual-evidence
queue. So that is the path.

## How the landscape was surveyed

A 2026-05-31 multi-source research pass fanned out across five categories,
fetched 22 sources, extracted 108 candidate claims, and verified the top 25
through a 3-vote adversarial check (2-of-3 refutes kills a claim). 22 claims
were confirmed; 3 vendor-marketing framings were refuted. Findings below carry
that verification status, and self-reported vendor claims are labeled as such to
match this repo's citation-grade evidence bar (see
[SOURCE_EVIDENCE.md](SOURCE_EVIDENCE.md)).

## Findings by category

### 1. Official Meta / Instagram Messaging API — structurally cannot cold-DM

Confirmed unanimously. The API only permits a message *after* a user initiates
the conversation; the send target is the Instagram-scoped ID of a customer who
already messaged the business, and the business then has a 24-hour window to
respond. Standard Access apps can message only role-holders/testers until App
Review grants Advanced Access. Cold unsolicited outreach is blocked by the API
infrastructure itself, not merely by policy. Narrow exceptions (message tags,
HUMAN_AGENT 7-day tag, one-time-notification, marketing-message opt-in) all
still require prior user contact. A 200 DM/hour cap was added Oct 2024.

- https://developers.facebook.com/docs/messenger-platform/instagram/
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
- https://developers.facebook.com/docs/messenger-platform/policy/policy-overview/

### 2. Official-API "managed" tools — real but inbound/warm only (dead ends for cold)

- **Inrō** — a genuinely done-for-you managed service (~€200/mo, 3-month min),
  but runs exclusively on the official API and by its own 2026 guidance states
  "there is no compliant way to cold-DM someone who has never interacted with
  you via the official API." Managed-but-inbound-only.
- **InstantDM** — built on the official Graph API; sending is limited to
  *replying* to inbound interactions (private replies, webhooks for inbound
  events). Useful for inbound automation, not cold outreach. (Its "official Meta
  Business Partner" self-description was adversarially **refuted 0-3** — treat
  partner-status marketing with caution.)
- https://www.inro.social/blog/instagram-dm-automation-guide-2026
- https://instantdm.com/instagram-api-docs

### 3. Cold-capable tools — all unofficial / gray-market, ToS-violating, ban risk

- **AutoReacher** — the closest thing to "managed cold outbound": built-in 5G
  mobile proxies per account and a 7-day automated warm-up, ~$39–$197/mo for
  ~1,200–120,000 DMs/mo. But it is **self-serve** — the client connects and
  operates their own accounts — and its "fully managed cloud service" framing
  was adversarially **refuted 0-3**. Throughput figures are vendor "up to"
  marketing; a per-message delivery/reply **status API was not confirmed**.
  "Not affiliated with Meta"; acknowledges suspension/ban risk.
- **Apify Bulk DM (mikolabs/instagram-bulkdm)** — sends cold DMs to arbitrary
  usernames, but is a self-hosted script requiring the buyer to paste their own
  session cookie. No managed accounts, no documented status output. The exact
  "fragile script the buyer babysits" the bounty rules out.
- **Unipile** — credential (username/password) login, explicitly *not* a Meta
  Partner, disclaims compliance responsibility. Private-API infra for a
  build-your-own gray stack; cold capability and per-message status unverified.
- **instagrapi** — self-hosted MIT library; can technically `direct_send` but
  its own README warns it is "fragile in production," best for testing/research;
  no delivery receipts/webhooks. Users report bans after a few hundred
  requests/day.
- https://autoreacher.com/ · https://autoreacher.com/instagram-proxies/
- https://apify.com/mikolabs/instagram-bulkdm
- https://www.unipile.com/instagram-dm-api-integration-for-saas/
- https://github.com/subzeroid/instagrapi

### 4. Managed influencer agencies — not cold-DM operators

- **Ubiquitous** — full-service influencer-marketing agency that handles creator
  outreach, but only as *paid brand campaigns* (paying creators to post). No
  cold-DM sender operation, no API/webhook for per-message status, ~$21K/mo
  minimum reported. Does not match the bounty's managed cold-DM requirement.
- https://www.ubiquitousinfluence.com/

### 5. Build-vs-partner conclusion

No named vendor satisfies **managed** *and* **cold outbound** *and* **per-message
delivery/reply status** at once. Any cold-capable partner is unofficial and
ToS-violating with real account-ban risk; any compliant tool is inbound/warm
only. The buyer must therefore trade managed-ness against cold capability — and
the trade that preserves honesty is a **human operator** sending cold DMs from
warmed accounts, recording each outcome through this repo's manual-evidence API.
This repo's `accountRiskOwner` contract field correctly externalizes ban risk to
whoever operates the accounts; under the manual path that owner is the operator,
explicitly and on the record.

## Why this is the defensible managed path

- It is *managed*: a human (operator-run managed ops) owns sender setup, warmup,
  throttling, and platform-change maintenance — not a script the buyer hosts.
- It is *cold-capable*: a person can send a vetted first-touch DM without the
  bot-automation detection surface that burns accounts.
- It produces *honest per-message status*: every sent / replied / failed /
  restricted / opt-out / complaint outcome is recorded via
  `POST /campaigns/:id/executions/:executionId/manual-events`, feeding the same
  proof-pack and canonical proof-packet the API already emits.
- It is *ship-ready today*: the API, approval gates, sender-risk model, launch
  authorization, intake validation, and proof export already support it. See
  [PILOT_INTAKE_KIT.md](PILOT_INTAKE_KIT.md) and
  [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md).

## What would change this decision

- A managed provider emerges that contractually owns sender accounts AND returns
  per-message delivery/reply status AND accepts the cold-outreach use case in
  writing — then `deliveryPath: managed_provider` and the existing provider
  bridge (`npm run pilot:provider-bridge`) become the path, with
  `accountRiskOwner: provider`.
- The operator's risk tolerance shifts toward accepting gray-market automation
  ban risk for higher throughput — then AutoReacher-class infra behind the same
  bridge is the candidate, with the per-message-status gap closed first.

## Caveats (carried from the research pass)

- Time-sensitive: Meta policy and rate limits change frequently; private-API
  tools break on platform changes, so vendor capability and ban-risk profiles
  can shift within weeks.
- Source quality: cold-capability and throughput claims rest largely on vendors'
  own marketing; the "fully managed" (AutoReacher) and "official Meta Business
  Partner" (InstantDM) framings were both refuted 0-3.
- Compliance: every cold-capable option violates Instagram's ToS and carries
  genuine, vendor-acknowledged ban risk — none are "compliant," only "gray-area
  with mitigation." This repo makes no cold-DM compliance claim.
