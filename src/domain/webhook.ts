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
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entryValue]) => [key, sortKeys(entryValue)])
    );
  }

  return value;
}
