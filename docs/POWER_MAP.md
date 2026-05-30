# Power Map

## Starting Assumption

The obvious customer is "growth teams that want Instagram creator outreach."
The bounty narrows that: Graphed is the immediate buyer because Graphed operates
agents for those growth teams and needs a programmable service dependency.

## Money Chain

```text
Client growth team with campaign revenue at stake
  -> Graphed AI-agent operator
    -> Instagram creator outreach managed product
      -> Sender account operations and delivery infrastructure
        -> Instagram creator recipient
```

## Intermediaries

| Player | Cut or keep | Reason |
| --- | --- | --- |
| Graphed | Keep | They are the integration buyer and recurring usage channel. |
| Client growth team | Keep close | They are the budget source and define campaign success. |
| Generic lead-gen agency | Cut | Adds manual margin without owning the API reliability Graphed needs. |
| Unmanaged automation script | Cut | Pushes maintenance back to Graphed. |
| Delivery adapter/provider | Keep behind contract | Needed if it absorbs platform/account risk and returns statuses. |

## Wedge Question

"Can your agent start an Instagram creator campaign with one API call and get
delivery/reply status without anyone debugging sender accounts tomorrow?"

## First Product Surface

API-first service, with CLI/dev tooling as a secondary operator surface.

The bounty's sample interface is `POST /campaigns`, so a pure CLI would miss the
integration buyer. A CLI remains useful for operators and agents during pilot
work, but the product contract is HTTP plus webhooks/status.

## Position

Inschneidergram goes direct to agent-powered growth operators who need Instagram
creator outreach to behave like a managed API dependency instead of a fragile
social automation project.

## Revenue Path

Pilot campaign -> delivery/reply proof -> Graphed client deployment -> recurring
campaign volume and sender/account operations fee.
