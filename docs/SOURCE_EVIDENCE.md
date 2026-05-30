# Source Evidence

Retrieved: 2026-05-30

This file separates public external facts from operator-provided bounty
interpretation and local repo proof.

## Bounty Source

| Source | URL | Access result | How it is used |
| --- | --- | --- | --- |
| Graphed Notion bounty page | `https://www.notion.so/graphed/Request-for-Product-Instagram-Creator-Outreach-Platform-5K-Bounty-061576da0bd4499299f8e34f27908593` | HTTP 200, but unauthenticated HTML only exposes Notion boot data and page id, not stable bounty body text. | The requirements in `docs/BOUNTY_REQUIREMENTS.md` are treated as operator-provided bounty interpretation from the prompt and prior page access, not as independently extracted public text. |

The Notion page id visible in unauthenticated HTML is
`061576da-0bd4-4992-99f8-e34f27908593`. A reviewer who has access to the page
should compare it directly against `docs/BOUNTY_REQUIREMENTS.md` before treating
the local requirements doc as independently verified.

## Public Platform Sources

| Source | URL | Public evidence | Product implication |
| --- | --- | --- | --- |
| Meta for Developers, Instagram Messaging | `https://developers.facebook.com/docs/instagram-messaging/` | Meta describes the Instagram Messaging API as a way to build messaging solutions for Instagram Professional accounts at scale, including receiving and responding to customer messages and private replies. | Official APIs are oriented around professional-account inbox messaging and replies, not a blanket guarantee that arbitrary cold outbound creator DMs are allowed. |
| Postman public Meta Instagram API collection | `https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api` | The public collection is reachable and useful as an API surface reference for Meta-owned Instagram endpoints. | Use public API references for shape and terminology, but do not infer permission to send cold outreach. |
| Unipile public Instagram API page | `https://www.unipile.com/communication-api/messaging-api/instagram-api/` | Unipile publicly markets Instagram inbox/API capabilities, realtime webhooks, account linking, quota/proxy protection, and unified provider APIs. | Third-party provider products can be adapter candidates if the operator owns the account/platform risk behind the repo's delivery contract. |

## Inaccessible or Weak Sources

| Source | Attempt | Result | Handling |
| --- | --- | --- | --- |
| ManyChat help, messaging windows | `https://help.manychat.com/hc/en-us/articles/23358636027932-Understanding-messaging-windows` | A read-only audit agent identified this as a relevant source for messaging-window claims, but this shell did not independently retrieve the body. | Keep ManyChat-window wording out of strong public claims until the page is retrieved through an authorized browser or another citation-grade path. |
| ManyChat Instagram messaging-window help page | `https://help.manychat.com/hc/en-us/articles/14281208202652-Instagram-Messaging-Window` | Cloudflare challenge returned HTTP 403 from this shell. | Do not rely on this as citation-grade evidence in public docs until verified from an accessible source or manually captured by an authorized browser. |
| Waveloop / Lyncly / DMFlow public sites | `https://waveloopai.com/`, `https://www.lyncly.io/`, `https://www.dmflow.live/` | Identified by read-only audit as relevant competitor/product-shape examples; not independently retrieved in this patch. | Mention only as sampled inspiration, not as verified market coverage or compliance evidence. |
| Unipile docs subdomain | `https://docs.unipile.com/` | DNS resolution failed from this shell. | Use the reachable public Unipile marketing/API page above instead. |

## Local Proof Sources

- `docs/proof/delivery-path-dry-run.md` records current local validation and
  explicitly excludes live Instagram delivery claims.
- `diagrams/inschneidergram-project-status.mmdx` is the repo-local status stack.
  Its public Buildooor short link is still blocked by `inschneidergram-j8b.7`.
- Beads issue `inschneidergram-j8b.3` covers live pilot evidence, and
  `inschneidergram-j8b.7` covers the public MMDX slug.
