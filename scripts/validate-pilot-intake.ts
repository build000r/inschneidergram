import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import {
  createCampaign,
  createCampaignSchema,
  type CreateCampaignInput
} from "../src/domain/campaign.js";
import {
  launchAuthorizationSchema,
  validateLaunchAuthorizationFreshness
} from "../src/domain/launchAuthorization.js";
import { senderAccountSchema } from "../src/domain/sender.js";

export const defaultPilotIntakePaths = {
  campaign: "examples/live-pilot-campaign.example.json",
  senders: "examples/live-pilot-senders.example.json",
  authorization: "examples/live-pilot-launch-authorization.example.json",
  webhook: "examples/live-pilot-webhook.example.json"
};

export const pilotIntakeSendersFileSchema = z.object({
  senders: z.array(senderAccountSchema).min(1),
  privateInputsNotInGit: z.array(z.string().min(1)).min(1).default([])
});

export const pilotIntakeWebhookFileSchema = z.object({
  callbackUrl: z.string().url(),
  allowedHosts: z.array(z.string().min(1)).min(1),
  signingSecretOwner: z.string().min(1),
  expectedHeaders: z.array(z.string().min(1)).default([]),
  deadLetterPolicy: z.string().min(1).optional(),
  notes: z.string().min(1).optional()
});

export type PilotIntakePaths = typeof defaultPilotIntakePaths;
export type PilotIntakeSendersFile = z.infer<typeof pilotIntakeSendersFileSchema>;
export type PilotIntakeWebhookFile = z.infer<typeof pilotIntakeWebhookFileSchema>;
export type PilotIntakeLaunchAuthorization = z.infer<typeof launchAuthorizationSchema>;

export interface PilotIntakeKit {
  campaignInput: CreateCampaignInput;
  sendersInput: PilotIntakeSendersFile;
  launchAuthorization: PilotIntakeLaunchAuthorization;
  webhook: PilotIntakeWebhookFile;
}

async function main(): Promise<void> {
  const paths = parsePilotIntakeArgs(process.argv.slice(2));
  const kit = await loadPilotIntakeKit(paths);
  assertPilotIntakeKit(kit);

  const selectedSenders = selectedPilotSenderAccounts(
    kit.campaignInput,
    kit.sendersInput.senders
  );
  const validationCampaign = createPilotIntakeValidationCampaign(kit);

  console.log("Pilot intake validation passed.");
  console.log(`- campaign: ${kit.campaignInput.campaign}`);
  console.log(`- targets scheduled: ${validationCampaign.summary.scheduled}`);
  console.log(`- selected senders: ${selectedSenders.map((sender) => sender.id).join(", ")}`);
  console.log(`- delivery path: ${kit.launchAuthorization.deliveryPath}`);
  console.log(`- webhook: ${kit.webhook.callbackUrl}`);
}

export async function loadPilotIntakeKit(paths: PilotIntakePaths): Promise<PilotIntakeKit> {
  const campaignInput = parseWith(
    createCampaignSchema,
    await readJson(paths.campaign),
    "campaign"
  );
  const sendersInput = parseWith(
    pilotIntakeSendersFileSchema,
    await readJson(paths.senders),
    "senders"
  );
  const launchAuthorization = parseWith(
    launchAuthorizationSchema,
    await readJson(paths.authorization),
    "launch authorization"
  );
  const webhook = parseWith(
    pilotIntakeWebhookFileSchema,
    await readJson(paths.webhook),
    "webhook"
  );

  return {
    campaignInput,
    sendersInput,
    launchAuthorization,
    webhook
  };
}

export function assertPilotIntakeKit(kit: PilotIntakeKit): void {
  const errors = validateLivePilotKit(kit);

  if (errors.length > 0) {
    throw new Error(
      [
        "Pilot intake validation failed:",
        ...errors.map((error, index) => `${index + 1}. ${error}`)
      ].join("\n")
    );
  }
}

export function createPilotIntakeValidationCampaign(kit: PilotIntakeKit) {
  return createCampaign(
    {
      ...kit.campaignInput,
      settings: {
        ...kit.campaignInput.settings,
        senderAccounts: selectedPilotSenderAccounts(
          kit.campaignInput,
          kit.sendersInput.senders
        )
      }
    },
    new Date(kit.launchAuthorization.approvedAt)
  );
}

function validateLivePilotKit(input: PilotIntakeKit): string[] {
  const errors: string[] = [];
  const { campaignInput, sendersInput, launchAuthorization, webhook } = input;

  if (!campaignInput.settings.requireTargetProvenance) {
    errors.push("settings.requireTargetProvenance must be true for a live pilot.");
  }

  const stringTargets = campaignInput.targets.filter((target) => typeof target === "string");
  if (stringTargets.length > 0) {
    errors.push("live pilot targets must be profile objects, not bare handles.");
  }

  const missingProvenance = campaignInput.targets
    .filter((target) => typeof target !== "string")
    .filter((target) => !target.source || !target.fitReason)
    .map((target) => target.target);
  if (missingProvenance.length > 0) {
    errors.push(
      `targets missing source or fitReason: ${missingProvenance.join(", ")}`
    );
  }

  const senderIds = new Set(sendersInput.senders.map((sender) => sender.id));
  const missingSenders = campaignInput.settings.senderPool.filter((id) => !senderIds.has(id));
  if (missingSenders.length > 0) {
    errors.push(
      `campaign settings.senderPool references unknown sender ids: ${missingSenders.join(", ")}`
    );
  }

  const selectedSenders = selectedPilotSenderAccounts(campaignInput, sendersInput.senders);
  if (selectedSenders.every((sender) => sender.status !== "healthy")) {
    errors.push("at least one selected sender must be healthy.");
  }

  if (launchAuthorization.deliveryPath !== "manual") {
    errors.push(
      "the first live pilot intake kit expects launchAuthorization.deliveryPath=manual."
    );
  }

  if (campaignInput.targets.length > launchAuthorization.approvedTargetLimit) {
    errors.push(
      `campaign has ${campaignInput.targets.length} target(s), but launch authorization only approves ${launchAuthorization.approvedTargetLimit}.`
    );
  }

  const launchAuthorizationFreshnessError =
    validateLaunchAuthorizationFreshness(launchAuthorization);
  if (launchAuthorizationFreshnessError) {
    errors.push(launchAuthorizationFreshnessError);
  }

  const campaignWebhookUrl = campaignInput.settings.webhookUrl;
  if (!campaignWebhookUrl) {
    errors.push("campaign settings.webhookUrl must be set for the live pilot callback.");
  } else if (campaignWebhookUrl !== webhook.callbackUrl) {
    errors.push("campaign settings.webhookUrl must match webhook.callbackUrl.");
  }

  errors.push(...validateWebhookDestination(webhook.callbackUrl, webhook.allowedHosts));

  try {
    const validationCampaign = createPilotIntakeValidationCampaign(input);
    if (validationCampaign.summary.blockedPolicy > 0) {
      errors.push(
        `campaign validation produced ${validationCampaign.summary.blockedPolicy} policy-blocked target(s).`
      );
    }
    if (validationCampaign.summary.skippedDuplicate > 0) {
      errors.push(
        `campaign validation produced ${validationCampaign.summary.skippedDuplicate} duplicate target(s).`
      );
    }
    if (validationCampaign.summary.scheduled === 0) {
      errors.push("campaign validation produced no scheduled targets.");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "campaign validation failed");
  }

  if (sendersInput.privateInputsNotInGit.length === 0) {
    errors.push("senders.privateInputsNotInGit must name the private credential boundary.");
  }

  return errors;
}

export function selectedPilotSenderAccounts(
  campaignInput: CreateCampaignInput,
  senders: z.infer<typeof senderAccountSchema>[]
): z.infer<typeof senderAccountSchema>[] {
  const requested = new Set(campaignInput.settings.senderPool);
  return senders.filter((sender) => requested.has(sender.id));
}

function validateWebhookDestination(rawUrl: string, allowedHosts: string[]): string[] {
  const errors: string[] = [];
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return ["webhook callbackUrl must be a valid absolute URL."];
  }

  if (url.protocol !== "https:") {
    errors.push("webhook callbackUrl must use https.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    errors.push("webhook callbackUrl must not use localhost.");
  }

  if (isBlockedIpHost(hostname)) {
    errors.push("webhook callbackUrl must not use a private, loopback, or special-use IP.");
  }

  if (!isAllowedHost(hostname, allowedHosts.map(normalizeAllowedHost))) {
    errors.push("webhook callbackUrl host must be present in allowedHosts.");
  }

  return errors;
}

function isAllowedHost(hostname: string, allowedHosts: string[]): boolean {
  return allowedHosts.some((allowedHost) => {
    if (allowedHost.startsWith("*.")) {
      const suffix = allowedHost.slice(1);
      return hostname.endsWith(suffix) && hostname !== allowedHost.slice(2);
    }

    return hostname === allowedHost;
  });
}

function normalizeAllowedHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("*.")) {
    return `*.${normalizeHostname(trimmed.slice(2))}`;
  }

  try {
    return normalizeHostname(new URL(trimmed).hostname);
  } catch {
    try {
      return normalizeHostname(new URL(`https://${trimmed}`).hostname);
    } catch {
      return normalizeHostname(trimmed.split("/", 1)[0] ?? trimmed);
    }
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/g, "");
}

function isBlockedIpHost(hostname: string): boolean {
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const octets = hostname.split(".").map(Number);
    const [first, second, third] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }

  if (ipVersion === 6) {
    return (
      hostname === "::" ||
      hostname === "::1" ||
      hostname.startsWith("::ffff:") ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe80:")
    );
  }

  return false;
}

async function readJson(path: string): Promise<unknown> {
  const absolute = resolve(path);
  try {
    return JSON.parse(await readFile(absolute, "utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to read ${path}: ${detail}`);
  }
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`${label} is invalid:\n${formatZodError(error)}`);
    }
    throw error;
  }
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
}

export function parsePilotIntakeArgs(argv: string[]): PilotIntakePaths {
  const paths = { ...defaultPilotIntakePaths };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    if (!isPathKey(key)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    paths[key] = value;
    index += 1;
  }

  return paths;
}

function isPathKey(value: string): value is keyof PilotIntakePaths {
  return (
    value === "campaign" ||
    value === "senders" ||
    value === "authorization" ||
    value === "webhook"
  );
}

function printHelpAndExit(): never {
  console.log(`Usage: npm run pilot:intake:validate -- [options]

Options:
  --campaign <path>       POST /campaigns body JSON
  --senders <path>        sender inventory JSON
  --authorization <path>  launchAuthorization JSON
  --webhook <path>        callback and allowlist JSON

Defaults:
  --campaign ${defaultPilotIntakePaths.campaign}
  --senders ${defaultPilotIntakePaths.senders}
  --authorization ${defaultPilotIntakePaths.authorization}
  --webhook ${defaultPilotIntakePaths.webhook}`);
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
