# Wiki-Duel Bounty Readiness Report

Date: 2026-05-30

## Topic

Can the current public Inschneidergram repo win Graphed's Instagram Creator
Outreach Platform bounty, and is there any repo-side work left that materially
raises the odds before the external pilot and public status-link steps?

## Grounding

The Buildooor wiki does not currently have a direct `inschneidergram` concept
page, so the duel used adjacent parent-wiki concepts as the grounding brief.
The brief was prepended to the study prompts before repo inspection.

Concept pages and sources used:

- `quality-gates`: public claims with high error cost need freshness,
  authorization, provenance, and evidence gates.
- `skill-as-workflow`: operator control should be an API/CLI/workflow surface
  with replayable evidence, not a fragile admin UI.
- `proof-carrying-admin-execution`: the trust object is the replay packet or
  proof packet, not an agent claim.
- `professional-monetization` and `operator-portfolio`: public proof artifacts
  plus direct managed-service handoff are the commercial wedge.

## Duel Transport

No standalone `/dueling-idea-wizards` command was available in this session, so
the grounded duel used read-only subagents with the same wiki brief and opposed
roles.

The reviewed surfaces were `README.md`, `docs/BOUNTY_SUBMISSION.md`,
`docs/BOUNTY_REQUIREMENTS.md`, `docs/VISION.md`, `docs/PILOT_RUNBOOK.md`,
`docs/PILOT_INTAKE_KIT.md`, `docs/BUILD_VS_CLONE.md`,
`docs/DOMAIN_PLAN.md`, `docs/proof/delivery-path-dry-run.md`,
`diagrams/inschneidergram-project-status.mmdx`, `package.json`,
`scripts/bounty-local-proof.sh`, `src/server.ts`, and relevant tests/scripts.

## Result

| Role | Current confidence | Confidence after external blockers | Repo-side blocker found |
| --- | ---: | ---: | --- |
| Advocate Boyle | 72% | 96% | No hard blocker; asked for exact current-HEAD proof dossier |
| Skeptic Leibniz | 72% | 86% | No hard blocker; asked for canonical proof-packet export |
| Verifier Darwin | 94% before commit/report closeout | 97% after commit/report closeout | No code-side blocker; requested closeout, now completed in the public repo |

Consensus: the current public repo is conditionally bounty-ready after the
proof-packet batch, Beads sync, commit, push, and public remote verification.
It is not yet bounty-complete because decisive evidence is external: real
sender/provider operation, real Graphed creator targets, fresh launch
authorization for the private pilot, live delivery/reply evidence, and public
Buildooor MMDX publication.

## Strongest Affirmative Case

Inschneidergram is no longer a script or a pitch deck. It is a managed outreach
control plane with API intake, creator provenance, approval gates, sender-risk
state, launch authorization, execution records, manual/provider evidence,
signed webhooks, dead-letter replay, proof-pack export, canonical proof-packet
export, operator dashboard, intake validation, provider bridge rehearsal, and a
one-command local evaluator gate.

The repo stays honest about the remaining gap: it does not claim live Instagram
delivery, does not claim official cold-DM compliance, and does not put sender
credentials in git. That matches the wiki proof-packet doctrine better than a
fragile automation demo would.

## Skeptical Criticism and Resolution

The first skeptic pass argued that the public winning artifact was too
summary-and-pointer based. The proof pack showed the control plane could run,
but the trust object was not a self-contained replay packet with canonical
hashes over authorization, delivery attempts, webhook attempts, evidence
references, and source routes.

That critique produced the current hardening patch:

- `GET /campaigns/:id/proof-packet` exports `proof-packet/v1`.
- `GET /campaigns/:id/proof-pack` embeds the same `proofPacket`.
- The packet includes campaign targets, readiness gates, launch authorization,
  delivery attempts, webhook attempts, manual/provider evidence references,
  follow-up plan, proof pack, and source URLs.
- The packet includes `canonicalSha256` over stable canonical JSON.
- Credentials, webhook secret material, and private binary proof are not
  embedded.
- Launch packet, pilot handoff, operator dashboard, OpenAPI, provider bridge,
  service smoke, README, runbooks, proof dossier, and status MMDX now point to
  the canonical packet.

## Latest Local Proof

`npm run proof:bounty-local` passed on 2026-05-30 after the public closeout and
proof-dossier provenance refresh:

- TypeScript typecheck passed.
- Vitest passed: 14 files, 115 tests.
- Production build passed.
- Live pilot intake validation and API rehearsal passed.
- Managed-provider bridge rehearsal passed and exported proof-packet hash
  `47b01e03d40e9f42c79d40c3ac530db25e2406061d8078b93b7b26a5cba12509`.
- API-key service smoke passed and exported proof-packet hash
  `18e157adaf1c61d1a61fd19180e75c47c4740498f5c9f0aa8ba2e5baa7edd95d`.
- Manual pilot demo and mock proof-pack demo passed.
- Project-status MMDX preflight passed with 10 charts.
- MMDX dry-run passed for
  `https://buildooor.com/mmdx/buildooor/mmdx-inschneidergram-project-status`
  with source hash
  `ad74fa5a202e1b3ffed1d0ddb7b69df4986516570803caef800e8ed44a991dbc`.

## External Next Actions

1. Refresh Buildooor SPAPS auth: `npm run status:mmdx:login`.
2. Publish and verify the public status diagram:
   `npm run status:mmdx:publish`.
3. Choose the live pilot path, defaulting to operator-run managed manual unless
   a real managed provider is already available.
4. Collect private pilot inputs: vetted creator list, approved first-touch and
   optional follow-up copy, sender/provider access, callback URL, stop
   conditions, and launch authorization.
5. Validate and rehearse the private files:
   `npm run pilot:intake:validate -- ...` and
   `npm run pilot:intake:rehearse -- ...`.
6. Run one low-volume live manual/provider execution through the existing API.
7. Record real sent, replied, failed, restricted, opt-out, complaint, and sender
   health evidence. Replay webhook dead letters if any.
8. Publish the real `GET /campaigns/:id/proof-pack` output, matching
   `GET /campaigns/:id/proof-packet` hash, and verified Buildooor MMDX link.

## Repo Work Decision

No code-side blocker remains in the current tree. The proof-packet/report
closeout is complete: the relevant Beads were closed and synced, `main` was
committed and pushed, and the public remote now contains the work. The next
material confidence increase comes from external live pilot evidence and a
fresh authenticated Buildooor MMDX publish, not another local feature.

## Deferred Wiki Updates

None filed during this pass. A future wiki ingest could add this repo as a
child-scope source once a product-local or operator-portfolio concept page is
desired, but this duel stayed read-only by contract.
