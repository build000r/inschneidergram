# Live Pilot Intake Kit

This kit turns the external Graphed pilot inputs into JSON files that can be
validated against the same local schemas used by the API. It is meant to be
filled before a live pilot is created so missing sender, creator, authorization,
or webhook inputs fail locally instead of during launch.

## Files

| File | Purpose |
| --- | --- |
| `examples/live-pilot-campaign.example.json` | `POST /campaigns` body with profile-object targets, approved copy, sender pool, follow-ups, and callback URL |
| `examples/live-pilot-senders.example.json` | Non-secret sender inventory for `PUT /senders/:id`; credentials and session material stay outside git |
| `examples/live-pilot-launch-authorization.example.json` | `launchAuthorization` object required by manual execution |
| `examples/live-pilot-webhook.example.json` | Callback URL, allowlist host, signing-secret owner, and dead-letter policy |
| `examples/managed-provider-bridge.example.json` | Provider endpoint, managed-provider launch authorization, returned outcomes, reply assessments, and incidents for bridge rehearsal |

The example files use placeholder creator handles, sender ids, and approval
references. Replace them with private pilot values outside public artifacts.
The bundled public example authorization windows are refreshed at runtime by
the local proof and rehearsal commands so this repo's examples do not age out.
Private pilot authorization files passed with `--authorization` are not
refreshed; their `approvedAt`, `expiresAt`, reference, and evidence URL must be
real current operator inputs.

## Validate

Run the default example kit:

```bash
npm run pilot:intake:validate
```

Run a private filled kit:

```bash
npm run pilot:intake:validate -- \
  --campaign /path/to/live-pilot-campaign.json \
  --senders /path/to/live-pilot-senders.json \
  --authorization /path/to/live-pilot-launch-authorization.json \
  --webhook /path/to/live-pilot-webhook.json
```

The validator checks:

- `POST /campaigns` shape through `createCampaignSchema`
- profile-object targets only; no bare handles for live pilot intake
- `settings.requireTargetProvenance=true`
- every target has `source` and `fitReason`
- campaign sender ids exist in the sender inventory
- at least one selected sender is healthy
- manual delivery path for the first pilot
- target count is within `approvedTargetLimit`
- launch authorization has an approval evidence URL and an unexpired
  `expiresAt`
- campaign webhook URL matches the webhook file
- callback URL is HTTPS, non-local, and present in `allowedHosts`
- campaign scheduling produces no duplicate or policy-blocked targets
- the sender file names which private credential inputs stay out of git

Expected default output:

```text
Pilot intake validation passed.
- campaign: graphed_creator_outreach_live_pilot_001
- targets scheduled: 3
- selected senders: sender-graphed-manual-1
- delivery path: manual
- webhook: https://hooks.graphed.com/inschneidergram/events
```

## Rehearse API Handoff

After validation, run the intake through the API without sending or faking live
Instagram delivery:

```bash
npm run pilot:intake:rehearse
```

The rehearsal registers the selected non-secret senders, creates the campaign,
approves and claims the scheduled targets, posts a manual execution with the
validated `launchAuthorization`, fetches the handoff and operator dashboard,
and stops at `awaiting_manual_evidence`. It proves the intake files can become
real API state while keeping the live proof gap honest. Only the bundled
example authorization window is renewed for this local rehearsal; private kits
remain strict.

Expected default output includes:

```text
Readiness after execution: awaiting_manual_evidence
Pending manual evidence: 3
```

## Rehearse Provider Bridge

For a provider-operated path, run:

```bash
npm run pilot:provider-bridge
```

The provider bridge rehearsal builds a handoff payload with one send intent per
approved scheduled target, then posts fixture provider outcomes through
`adapter.kind=managed_provider`. It reaches `evidence_ready` only from
provider-reported outcomes that include event-specific message ids, reply text,
reasons, and non-empty evidence pointers; replacing the fixture with a real
provider endpoint still requires external provider access and permission. The
bundled provider bridge authorization window is renewed for this local rehearsal
only.

## Live Pilot Use

After validation passes:

1. Register each non-secret sender from the sender file with `PUT /senders/:id`.
2. Create the campaign with the validated campaign JSON.
3. Create the approval workbench and approve only the creators/copy covered by
   the launch authorization.
4. Check `GET /campaigns/:id/readiness` and
   `GET /campaigns/:id/pilot-handoff`.
5. Execute with `adapter.kind=manual` and the validated
   `launchAuthorization`.
6. Record manual evidence through
   `POST /campaigns/:id/executions/:executionId/manual-events`.
7. Replay webhook dead letters before publishing
   `GET /campaigns/:id/proof-pack` and the matching canonical
   `GET /campaigns/:id/proof-packet` hash.

## Sensitive Boundary

Never put sender credentials, recovery secrets, session material, proxy
configuration, screenshots, private approval docs, or private creator lists in
the public repo. The example files are shape references; live values should live
in the operator's private handoff system.
