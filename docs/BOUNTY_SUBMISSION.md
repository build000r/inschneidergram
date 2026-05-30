# Bounty Submission Packet

This is the evaluator-facing handoff for the Graphed Instagram Creator
Outreach Platform bounty.

## Current Claim

Inschneidergram is a working API/control-plane MVP for a managed Instagram
creator outreach pilot. It can accept a campaign, preserve creator provenance,
enforce approval/sender/authorization gates, create execution records, expose
operator queues and dashboard state, record manual or provider-reported
delivery evidence, dispatch signed runtime callbacks, and generate proof packs.
Each proof pack now includes a canonical redacted proof packet that can be
exported separately with a deterministic SHA-256.

It is not yet claiming live Instagram delivery or official cold-DM compliance.
Those require the external pilot inputs below.

## Fast Evaluation Path

```bash
npm install
npm run proof:bounty-local
# Optional when Docker is available:
npm run proof:bounty-local:docker
```

The proof command runs the local gates that matter for bounty review:

- TypeScript typecheck
- Vitest suite
- production build
- live pilot intake validation
- live pilot intake API rehearsal
- managed-provider bridge rehearsal
- API-key protected service smoke
- strict-provenance managed-sender manual rehearsal
- deterministic mock pilot demo
- project-status MMDX preflight
- Buildooor MMDX publish dry-run and source hash summary

Expected result: `Local bounty proof passed.`

`npm run proof:bounty-local:docker` runs the same proof with
`INSCHNEIDERGRAM_PROOF_INCLUDE_DOCKER=1`, adding the container build/start,
health, OpenAPI, API-auth, and launch-packet checks from `npm run
smoke:docker`.

The bundled public example authorization windows are renewed at runtime for
this local proof path so the examples remain evaluator-friendly after their
static fixture dates pass. Private pilot authorization files are not renewed;
they must carry current real approval evidence and expiry.

## What To Inspect

| Question | Evidence |
| --- | --- |
| Does the API match the bounty-shaped interface? | `POST /campaigns`, `GET /pilot-launch-packet`, `GET /campaigns/:id/readiness`, `GET /campaigns/:id/pilot-handoff` |
| Can Graphed avoid hosting browser automation? | [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md), selected operator-run managed manual path |
| Are creators vetted before send evidence? | strict target provenance, approval workbench, readiness gates |
| Is sender risk modeled? | sender inventory, risk events, cooldown/lockout/reconnect states |
| Are outcomes auditable? | execution records, manual queue/evidence, provider events, proof packs, canonical proof packets |
| Can Graphed receive status? | signed runtime webhooks, replayable dead letters, proof-pack and proof-packet APIs |
| Can a managed provider connect? | `npm run pilot:provider-bridge`, evidence-bearing provider outcomes in `examples/managed-provider-bridge.example.json` |
| Can the service run from the public container? | `npm run smoke:docker` verifies container health, API auth, OpenAPI, and launch packet access |
| Is the repo honest about platform risk? | [SOURCE_EVIDENCE.md](SOURCE_EVIDENCE.md), [BUILD_VS_CLONE.md](BUILD_VS_CLONE.md), adapter `officialColdDmCompliance: "not_claimed"` |
| How does each bounty expectation map to proof? | [BOUNTY_ACCEPTANCE_MATRIX.md](BOUNTY_ACCEPTANCE_MATRIX.md) |
| Is there any repo-side work left before live proof? | [WIKI_DUEL_BOUNTY_READINESS.md](WIKI_DUEL_BOUNTY_READINESS.md) |

## Pilot Ask

To convert the local proof into a bounty-winning pilot, Graphed or the operator
must provide:

1. A vetted creator list with source and fit rationale for each target.
2. Approved first-touch copy and optional follow-up copy.
3. Selected delivery path: operator-run manual proof or a managed provider that
   can return explicit outcomes.
4. Non-secret sender inventory ids, with credentials/session material held
   outside this repo.
5. A fresh launch authorization reference with evidence URL, expiry, selected
   delivery path, and target limit.
6. Optional public HTTPS callback URL for delivery/reply webhooks.
7. Stop conditions for complaints, opt-outs, sender warnings, and low-quality
   replies.

Use [PILOT_INTAKE_KIT.md](PILOT_INTAKE_KIT.md) and
`npm run pilot:intake:validate` to validate those inputs before creating the
private campaign. Use `npm run pilot:intake:rehearse` to drive the same files
through sender registration, campaign creation, approval, manual execution,
handoff, dashboard, and manual queue without recording fake live evidence. The
executable intake files are:

- `examples/live-pilot-campaign.example.json`
- `examples/live-pilot-senders.example.json`
- `examples/live-pilot-launch-authorization.example.json`
- `examples/live-pilot-webhook.example.json`
- `examples/managed-provider-bridge.example.json`

For a provider-operated path, `npm run pilot:provider-bridge` exports the
approved send-intent handoff shape and then records provider-reported outcomes
through the existing managed-provider execution route. Provider events must
include event-specific proof fields before an execution record is inserted:
message ids and evidence for sent/replied events, reply text for replies, and
reasons plus evidence for failures or restrictions. A real provider endpoint can
replace the fixture once Graphed supplies provider access and authorization.

After those inputs exist, run the pilot through the flow in
[PILOT_RUNBOOK.md](PILOT_RUNBOOK.md), then publish the live
`GET /campaigns/:id/proof-pack` output plus the matching
`GET /campaigns/:id/proof-packet` canonical hash.

## Current External Blockers

- `inschneidergram-j8b.3`: live pilot proof needs private sender/provider
  access, vetted Graphed creator targets, and launch authorization.
- `inschneidergram-j8b.7`: the public Buildooor MMDX link needs refreshed
  Buildooor SPAPS auth, then `npm run status:mmdx:publish`.

## Non-Claims

- No live Instagram DM has been sent from this repo.
- No Graphed creator list has been contacted.
- No sender credentials belong in git or in the local JSON store.
- No official Meta cold-DM compliance claim is made.
- No public Buildooor MMDX short link is live-verified until the auth-gated
  publish succeeds.
