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

- `npm run proof:bounty-local:docker` passed on 2026-05-30.
- Provider bridge proof-packet hash:
  `8c740f38982b2ffd0bb99a99af0bbdbdbec5de83a844546fdd12b2fb35966f41`.
- Service smoke proof-packet hash:
  `fb6e085ddb9b6fcbb63126ebfc4ff660eddf45eb83ebabe47d2de65a61f0fa10`.
- MMDX dry-run target:
  `https://buildooor.com/mmdx/buildooor/mmdx-inschneidergram-project-status`.
- MMDX dry-run source hash:
  `b31bf0f5ea551b9d66bf771f1552d1a9114dc59a48b39bf4bd36193a09eef7ea`.
- MMDX live publish:
  `npm run status:mmdx:publish` passed with `live_verification=OK` on
  2026-05-30.

## Requirement Matrix

| Bounty expectation | Current status | Evidence | Still needed |
| --- | --- | --- | --- |
| Graphed can submit a campaign through a clean API | Proven locally | `POST /campaigns`, OpenAPI, service smoke, `npm run proof:bounty-local` | Private deployment endpoint and API key for a real pilot |
| Vetted Instagram profile list is preserved | Proven locally, private data pending | Profile-object targets, strict `requireTargetProvenance`, approval workbench, proof metrics for vetted targets | Graphed's real creator list with source and fit rationale |
| Message/template and campaign settings are accepted | Proven locally | campaign schema, follow-up rules, sender pool, delay/limit settings, intake validator | Graphed-approved first-touch and optional follow-up copy |
| Sender account setup and management are part of the product | Partly proven | non-secret sender inventory, sender health, risk events, cooldown/lockout/reconnect states, sender-risk proof metrics | Private sender/provider credentials, recovery ownership, account operation outside git |
| Safe sending limits and throttling exist | Proven locally | per-sender daily limits, delay windows, managed sender health checks, readiness/execution refusal for unhealthy senders | Real operator limit policy for the selected sender accounts |
| Campaign execution can run without Graphed hosting browser automation | Proven locally for control plane | manual delivery adapter, managed-provider outcome contract, launch authorization gate, service smoke, [DELIVERY_PATH_DECISION.md](DELIVERY_PATH_DECISION.md) | Real manual operator or provider operating Instagram delivery |
| Duplicate and policy-blocked targets are handled | Proven locally | normalized handle dedupe, suppression records, policy-blocked target counts, tests | Real list hygiene during private pilot |
| Delivery and reply status are reportable | Proven locally for recorded evidence | manual evidence API, provider-reported outcomes, runtime webhooks, proof packs, proof packets, operator dashboard | Real sent/replied/failed/restricted evidence from the pilot |
| Graphed can receive callbacks or inspect status | Proven locally | signed runtime callbacks, dead-letter listing/replay, `GET /operator/dashboard`, proof-pack/proof-packet APIs | Graphed public HTTPS callback URL, if callback delivery is desired |
| Reporting is auditable after execution | Proven locally | `GET /campaigns/:id/proof-pack`, `GET /campaigns/:id/proof-packet`, canonical SHA-256, local proof dossier | Live proof pack exported from real pilot records |
| Product is not a one-off script or pitch deck | Proven locally | API service, JSON persistence, Docker/runtime config, runbooks, intake kit, service smoke, and opt-in Docker-inclusive bounty proof | Operational ownership for live delivery |
| Product is reliable enough for ongoing client deployments | Partly proven | idempotency, storage, retries, dead-letter replay, auth gate, callback guard, dashboard | Monitoring, stronger production persistence, real incident history |
| Real pilot completes meaningful Instagram creator outreach | Not proven yet | Local rehearsal stops before fake live evidence by design | Low-volume real pilot with vetted creators, authorization, sender/provider ops, and outcome evidence |
| Public progress MMDX is live-verifiable | Proven live | stable slug is embedded; `npm run status:mmdx:publish` returned `live_verification=OK` | Rerun publish after status-stack edits |

## Reviewer Path

1. Run `npm install`.
2. Run `npm run proof:bounty-local`.
3. Inspect [BOUNTY_SUBMISSION.md](BOUNTY_SUBMISSION.md) for the evaluator
   handoff.
4. Inspect [PILOT_INTAKE_KIT.md](PILOT_INTAKE_KIT.md) and
   [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md) for the private pilot path.
5. Read [DELIVERY_PATH_DECISION.md](DELIVERY_PATH_DECISION.md) for the verified
   provider-landscape survey and why the pilot runs operator-run manual rather
   than an automated provider.
6. Treat [WIKI_DUEL_BOUNTY_READINESS.md](WIKI_DUEL_BOUNTY_READINESS.md) as the
   adversarial readiness assessment.

## Non-Claims

- No live Instagram DM has been sent from the public repo.
- No Graphed creator list has been contacted.
- No sender credentials, recovery material, session material, proxies, or
  private screenshots belong in git.
- No official Meta cold-DM compliance claim is made.
- Public Buildooor MMDX status is live-verified, but it is only project-status
  evidence, not live Instagram delivery proof.
