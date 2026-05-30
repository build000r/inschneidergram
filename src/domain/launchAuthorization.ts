import { z } from "zod";

export type LaunchDeliveryPath = "manual" | "managed_provider";

export interface LaunchAuthorization {
  actor: string;
  deliveryPath: LaunchDeliveryPath;
  approvedTargetLimit: number;
  approvedAt: string;
  expiresAt?: string;
  reference: string;
  evidenceUrl?: string;
  notes?: string;
}

export const launchAuthorizationSchema = z.object({
  actor: z.string().min(1).max(120),
  deliveryPath: z.enum(["manual", "managed_provider"]),
  approvedTargetLimit: z.number().int().min(1).max(1000),
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  reference: z.string().min(1).max(1000),
  evidenceUrl: z.string().url().max(2000),
  notes: z.string().min(1).max(1000).optional()
});

export function validateLaunchAuthorizationFreshness(
  authorization: LaunchAuthorization,
  now: Date = new Date()
): string | null {
  if (!authorization.evidenceUrl) {
    return "Launch authorization evidenceUrl is required for manual and managed-provider execution";
  }

  if (!authorization.expiresAt) {
    return "Launch authorization expiresAt is required for manual and managed-provider execution";
  }

  const approvedAt = Date.parse(authorization.approvedAt);
  const expiresAt = Date.parse(authorization.expiresAt);
  const nowMs = now.getTime();
  const clockSkewMs = 5 * 60 * 1000;

  if (!Number.isFinite(approvedAt)) {
    return "Launch authorization approvedAt must be a valid date-time";
  }

  if (!Number.isFinite(expiresAt)) {
    return "Launch authorization expiresAt must be a valid date-time";
  }

  if (approvedAt > nowMs + clockSkewMs) {
    return "Launch authorization approvedAt is in the future";
  }

  if (expiresAt <= approvedAt) {
    return "Launch authorization expiresAt must be after approvedAt";
  }

  if (expiresAt <= nowMs) {
    return `Launch authorization expired at ${authorization.expiresAt}`;
  }

  return null;
}
