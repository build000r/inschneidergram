# Bounty Acceptance Evidence Matrix

Date: 2026-05-30

This matrix maps the operator-provided Graphed bounty interpretation in
[BOUNTY_REQUIREMENTS.md](BOUNTY_REQUIREMENTS.md) to the current public repo
evidence. The Notion body is not independently extracted in this shell; see
[SOURCE_EVIDENCE.md](SOURCE_EVIDENCE.md) for that access boundary.

## Current Verdict

The public repo is **locally bounty-ready** for evaluator review and private
pilot handoff. It is **not bounty-complete** until Graphed or the operator
supplies private pilot inputs, runs real Instagram creator outreach through the
selected managed path, and publishes live proof.

Latest local proof:

- `npm run proof:bounty-local` passed on 2026-05-30.
- Provider bridge proof-packet hash:
  `47b01e03d40e9f42c79d40c3ac530db25e2406061d8078b93b7b26a5cba12509`.
- Service smoke proof-packet hash:
  `18e157adaf1c61d1a61fd19180e75c47c4740498f5c9f0aa8ba2e5baa7edd95d`.
- MMDX dry-run target:
  `https://buildooor.com/mmdx/buildooor/mmdx-inschneidergram-project-status`.
- MMDX dry-run source hash:
  `9dead052e536fbb4cbd6658dcb010d28f065d863ee3b8a374fe4092f6ef9bbf7`.

## Requirement Matrix

| Bounty expectation | Current status | Evidence | Still needed |
| --- | --- | --- | --- |
| Graphed can submit a campaign through a clean API | Proven locally | `POST /campaigns`, OpenAPI, service smoke, `npm run proof:bounty-local` | Private deployment endpoint and API key for a real pilot |
| Vetted Instagram profile list is preserved | Proven locally, private data pending | Profile-object targets, strict `requireTargetProvenance`, approval workbench, proof metrics for vetted targets | Graphed's real creator list with source and fit rationale |
| Message/template and campaign settings are accepted | Proven locally | campaign schema, follow-up rules, sender pool, delay/limit settings, intake validator | Graphed-approved first-touch and optional follow-up copy |
| Sender account setup and management are part of the product | Partly proven | non-secret sender inventory, sender health, risk events, cooldown/lockout/reconnect states, sender-risk proof metrics | Private sender/provider credentials, recovery ownership, account operation outside git |
| Safe sending limits and throttling exist | Proven locally | per-sender daily limits, delay windows, managed sender health checks, readiness/execution refusal for unhealthy senders | Real operator limit policy for the selected sender accounts |
| Campaign execution can run without Graphed hosting browser automation | Proven locally for control plane | manual delivery adapter, managed-provider outcome contract, launch authorization gate, service smoke | Real manual operator or provider operating Instagram delivery |
| Duplicate and policy-blocked targets are handled | Proven locally | normalized handle dedupe, suppression records, policy-blocked target counts, tests | Real list hygiene during private pilot |
| Delivery and reply status are reportable | Proven locally for recorded evidence | manual evidence API, provider-reported outcomes, runtime webhooks, proof packs, proof packets, operator dashboard | Real sent/replied/failed/restricted evidence from the pilot |
| Graphed can receive callbacks or inspect status | Proven locally | signed runtime callbacks, dead-letter listing/replay, `GET /operator/dashboard`, proof-pack/proof-packet APIs | Graphed public HTTPS callback URL, if callback delivery is desired |
| Reporting is auditable after execution | Proven locally | `GET /campaigns/:id/proof-pack`, `GET /campaigns/:id/proof-packet`, canonical SHA-256, local proof dossier | Live proof pack exported from real pilot records |
| Product is not a one-off script or pitch deck | Proven locally | API service, JSON persistence, Docker/runtime config, runbooks, intake kit, smoke test | Operational ownership for live delivery |
| Product is reliable enough for ongoing client deployments | Partly proven | idempotency, storage, retries, dead-letter replay, auth gate, callback guard, dashboard | Monitoring, stronger production persistence, real incident history |
| Real pilot completes meaningful Instagram creator outreach | Not proven yet | Local rehearsal stops before fake live evidence by design | Low-volume real pilot with vetted creators, authorization, sender/provider ops, and outcome evidence |
| Public progress MMDX is live-verifiable | Blocked externally | preflight and dry-run pass; stable slug is embedded | Refresh Buildooor SPAPS auth, then run `npm run status:mmdx:publish` |

## Reviewer Path

1. Run `npm install`.
2. Run `npm run proof:bounty-local`.
3. Inspect [BOUNTY_SUBMISSION.md](BOUNTY_SUBMISSION.md) for the evaluator
   handoff.
4. Inspect [PILOT_INTAKE_KIT.md](PILOT_INTAKE_KIT.md) and
   [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md) for the private pilot path.
5. Treat [WIKI_DUEL_BOUNTY_READINESS.md](WIKI_DUEL_BOUNTY_READINESS.md) as the
   adversarial readiness assessment.

## Non-Claims

- No live Instagram DM has been sent from the public repo.
- No Graphed creator list has been contacted.
- No sender credentials, recovery material, session material, proxies, or
  private screenshots belong in git.
- No official Meta cold-DM compliance claim is made.
- No public Buildooor MMDX short link is live-verified while SPAPS auth returns
  401.
