import { z } from "zod";

export type LaunchDeliveryPath = "manual" | "managed_provider";

export interface LaunchAuthorization {
  actor: string;
  deliveryPath: LaunchDeliveryPath;
  approvedTargetLimit: number;
  approvedAt: string;
  reference: string;
  evidenceUrl?: string;
  notes?: string;
}

export const launchAuthorizationSchema = z.object({
  actor: z.string().min(1).max(120),
  deliveryPath: z.enum(["manual", "managed_provider"]),
  approvedTargetLimit: z.number().int().min(1).max(1000),
  approvedAt: z.string().datetime(),
  reference: z.string().min(1).max(1000),
  evidenceUrl: z.string().min(1).max(2000).optional(),
  notes: z.string().min(1).max(1000).optional()
});
