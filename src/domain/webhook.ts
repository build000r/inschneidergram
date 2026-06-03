import { createHmac, timingSafeEqual } from "node:crypto";

export function signWebhookPayload(payload: unknown, secret: string): string {
  const body = canonicalJson(payload);
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyWebhookSignature(
  payload: unknown,
  secret: string,
  signature: string
): boolean {
  const expected = Buffer.from(signWebhookPayload(payload, secret), "hex");
  const actual = Buffer.from(signature, "hex");

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

function canonicalJson(payload: unknown): string {
  return JSON.stringify(sortKeys(payload));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        // Locale-independent code-point ordering keeps the canonical form
        // (and therefore the HMAC signature) byte-stable across environments
        // and across any independent verifier. localeCompare would let ICU
        // collation / LANG reorder non-ASCII keys and break verification.
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entryValue]) => [key, sortKeys(entryValue)])
    );
  }

  return value;
}
