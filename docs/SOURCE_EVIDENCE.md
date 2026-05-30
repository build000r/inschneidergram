# Source Evidence

Retrieved/rechecked: 2026-05-30

This file separates public external facts from operator-provided bounty
interpretation and local repo proof.

## Bounty Source

| Source | URL | Access result | How it is used |
| --- | --- | --- | --- |
| Graphed Notion bounty page | `https://www.notion.so/graphed/Request-for-Product-Instagram-Creator-Outreach-Platform-5K-Bounty-061576da0bd4499299f8e34f27908593` | HTTP 200 in earlier shell retrieval, but unauthenticated HTML only exposed Notion boot data and page id, not stable bounty body text. Rechecked from this run; the direct public URL still did not expose stable body text to the agent, and public search did not surface a reliable copy of the bounty body. | The requirements in `docs/BOUNTY_REQUIREMENTS.md` are treated as operator-provided bounty interpretation from the prompt and prior page access, not as independently extracted public text. |

The Notion page id visible in unauthenticated HTML is
`061576da-0bd4-4992-99f8-e34f27908593`. A reviewer who has access to the page
should compare it directly against `docs/BOUNTY_REQUIREMENTS.md` before treating
the local requirements doc as independently verified.

## Public Platform Sources

| Source | URL | Public evidence | Product implication |
| --- | --- | --- | --- |
| Meta for Developers, Instagram API with Instagram Login: Messaging | `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/` | Public HTML was reachable. Meta describes sending and receiving messages for Instagram professional accounts and says conversation sending starts only after the Instagram user messages the professional account; the app then has 24 hours to respond. The page also names webhook, token, permission, Standard/Advanced Access, and human-agent requirements. | Official API evidence supports inbox, reply, webhook, and human-agent patterns. It does not prove permission for arbitrary cold outbound creator-list DMs. |
| Meta for Developers, Instagram private replies | `https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies` | Public HTML was reachable. Meta documents private replies to comments, including one-message and seven-day limits for post/reel/ad comments, live-broadcast limits for live comments, and the need for an Instagram user response before continuing in the 24-hour messaging window. | Private-reply automation is a real official pattern, but it is comment-triggered/reply-bounded rather than general cold outreach. |
| Postman public Meta Instagram Send API folder | `https://www.postman.com/meta/instagram/folder/jb8vta5/send-api` | The URL returns HTTP 200 and is a public Meta workspace surface. The shell did not retrieve a stable body because Postman renders the useful content client-side. | Treat as an API-shape pointer only; use Meta developer docs above for citation-grade claim language. |
| Unipile public Instagram API page | `https://www.unipile.com/communication-api/messaging-api/instagram-api/` | Public HTML was reachable. The page positions Unipile around Instagram inbox management, connected accounts, realtime webhooks, provider account linking, and built-in proxy/quota management. The embedded metadata reported `dateModified` 2026-05-19. | Third-party provider products can be adapter candidates if the operator owns the account/platform risk behind this repo's delivery contract. |

## Public Product-Shape Sources

| Source | URL | Public evidence | Product implication |
| --- | --- | --- | --- |
| Waveloop public site | `https://waveloopai.com/` | Public HTML was reachable. Waveloop markets Instagram DM automation for creators and brands, comment-to-DM automation, Meta login/OAuth, no password sharing, no browser extensions, Graph webhooks, multi-account workspaces, and analytics. | Use as product-shape evidence for official-API, no-password, webhook, analytics, and account-safety positioning. Vendor claims are not compliance proof for this bounty's cold-outreach use case. |
| Lyncly public site | `https://www.lyncly.io/` | Public HTML was reachable. Lyncly markets Instagram comment-to-DM automation, campaign management, lead analytics, webhooks, rate limiting, official OAuth, and no password sharing. | Use as product-shape evidence that sampled public vendor surfaces emphasize OAuth, campaign analytics, dedupe, rate limiting, and fast webhook-driven responses. |
| DMFlow public site | `https://www.dmflow.live/` | Public HTML was reachable. DMFlow markets keyword-triggered Instagram DM automation, unified inbox, templates, DM activity analytics, official Meta API/OAuth language, messaging-window awareness, and manual inbox handoff. | Use as product-shape evidence for inbox, template, analytics, and policy-window framing. Do not copy vendor compliance claims into this repo. |

## Inaccessible or Weak Sources

| Source | Attempt | Result | Handling |
| --- | --- | --- | --- |
| ManyChat help, messaging windows | `https://help.manychat.com/hc/en-us/articles/23358636027932-Understanding-messaging-windows` | HTTP 403 from this shell. | Keep ManyChat-window wording out of strong public claims until the page is retrieved through an authorized browser or another citation-grade path. |
| ManyChat Instagram messaging-window help page | `https://help.manychat.com/hc/en-us/articles/14281208202652-Instagram-Messaging-Window` | Cloudflare challenge returned HTTP 403 from this shell. | Do not rely on this as citation-grade evidence in public docs until verified from an accessible source or manually captured by an authorized browser. |
| Unipile docs subdomain | `https://docs.unipile.com/` | DNS resolution failed from this shell. | Use the reachable public Unipile marketing/API page above instead. |

## Local Proof Sources

- `docs/proof/delivery-path-dry-run.md` records current local validation and
  explicitly excludes live Instagram delivery claims.
- `diagrams/inschneidergram-project-status.mmdx` is the repo-local status stack.
  Its public Buildooor short link is still blocked by `inschneidergram-j8b.7`.
- Beads issue `inschneidergram-j8b.3` covers live pilot evidence, and
  `inschneidergram-j8b.7` covers the public MMDX slug.
