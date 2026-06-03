import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookSignature } from "../src/domain/webhook.js";

// The signed webhook contract relies on a single, deterministic canonical
// JSON form so any independent receiver can recompute the HMAC. Object-key
// ordering must therefore be locale-INDEPENDENT (stable code-point order),
// not driven by the host's ICU collation / LANG/LC_* environment. Campaign
// metadata is user-controlled and can carry non-ASCII keys, so a
// locale-sensitive sort can silently change the canonical form (and the
// signature) between environments and across verifier implementations.
describe("webhook HMAC canonicalization", () => {
  // Keys chosen so that JS String.prototype.localeCompare (ICU collation)
  // orders them differently from byte/code-point order in common locales:
  // code-point puts "_" (0x5F) after the uppercase letters and orders
  // "z" before "ä", whereas locale collation typically puts "_" first and
  // "ä" before "z".
  const dividingKeys = ["Z", "a", "A", "z", "_", "1", "ä", "Ä", "b", "B", "e", "é"];

  function payloadWithKeys(keys: string[]): Record<string, number> {
    const payload: Record<string, number> = {};
    keys.forEach((key, index) => {
      payload[key] = index;
    });
    return payload;
  }

  function codePointCanonical(payload: Record<string, number>): string {
    const ordered = Object.fromEntries(
      Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    );
    return JSON.stringify(ordered);
  }

  it("orders object keys by code point, not by locale collation", () => {
    const payload = payloadWithKeys(dividingKeys);
    const secret = "canonicalization-secret";

    const expectedCanonical = codePointCanonical(payload);
    const expectedSignature = createHmac("sha256", secret)
      .update(expectedCanonical)
      .digest("hex");

    // signWebhookPayload must produce the code-point-canonical HMAC. A
    // locale-sensitive sort would yield a different ordering (and signature)
    // for these keys, failing this assertion.
    expect(signWebhookPayload(payload, secret)).toBe(expectedSignature);
  });

  it("is insensitive to the original key insertion order", () => {
    const secret = "canonicalization-secret";
    // Identical key -> value mapping, only the insertion order differs.
    const forward = payloadWithKeys(dividingKeys);
    const reversed: Record<string, number> = {};
    for (const key of [...dividingKeys].reverse()) {
      reversed[key] = forward[key]!;
    }

    expect(signWebhookPayload(forward, secret)).toBe(
      signWebhookPayload(reversed, secret)
    );
  });

  it("round-trips nested non-ASCII metadata through verifyWebhookSignature", () => {
    const secret = "canonicalization-secret";
    const payload = {
      campaign: {
        metadata: payloadWithKeys(dividingKeys),
        nested: { "ßeta": 1, Alpha: 2, _trailing: 3 }
      }
    };

    const signature = signWebhookPayload(payload, secret);
    expect(verifyWebhookSignature(payload, secret, signature)).toBe(true);
  });
});
