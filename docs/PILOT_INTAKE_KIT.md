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

The example files use placeholder creator handles, sender ids, and approval
references. Replace them with private pilot values outside public artifacts.

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
real API state while keeping the live proof gap honest.

Expected default output includes:

```text
Readiness after execution: awaiting_manual_evidence
Pending manual evidence: 3
```

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
   `GET /campaigns/:id/proof-pack`.

## Sensitive Boundary

Never put sender credentials, recovery secrets, session material, proxy
configuration, screenshots, private approval docs, or private creator lists in
the public repo. The example files are shape references; live values should live
in the operator's private handoff system.
