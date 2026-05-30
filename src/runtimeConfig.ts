import { isIP } from "node:net";

export interface RuntimeConfig {
  host: string;
  port: number;
  provider: string;
  storePath: string;
  webhookSecret?: string;
  apiKey?: string;
  webhookAllowedHosts: string[];
}

export function readRuntimeConfig(
  env: Record<string, string | undefined> = process.env
): RuntimeConfig {
  const host = nonEmpty(env.HOST) ?? "127.0.0.1";
  const apiKey = nonEmpty(env.INSCHNEIDERGRAM_API_KEY);
  const webhookSecret = nonEmpty(env.INSCHNEIDERGRAM_WEBHOOK_SECRET);
  assertDeploymentSecrets({
    host,
    nodeEnv: nonEmpty(env.NODE_ENV),
    apiKey,
    webhookSecret
  });

  return {
    host,
    port: parsePort(env.PORT ?? "3107"),
    provider: nonEmpty(env.INSCHNEIDERGRAM_PROVIDER) ?? "mock",
    storePath: nonEmpty(env.INSCHNEIDERGRAM_STORE_PATH) ?? ".data/campaigns.json",
    webhookSecret,
    apiKey,
    webhookAllowedHosts: parseList(env.INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS)
  };
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`PORT must be an integer between 1 and 65535; received ${JSON.stringify(value)}`);
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535; received ${JSON.stringify(value)}`);
  }

  return port;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseList(value: string | undefined): string[] {
  return (
    nonEmpty(value)
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}

function assertDeploymentSecrets(input: {
  host: string;
  nodeEnv?: string;
  apiKey?: string;
  webhookSecret?: string;
}): void {
  if (input.nodeEnv !== "production" && isLoopbackHost(input.host)) {
    return;
  }

  assertStrongRuntimeSecret("INSCHNEIDERGRAM_API_KEY", input.apiKey);
  assertStrongRuntimeSecret("INSCHNEIDERGRAM_WEBHOOK_SECRET", input.webhookSecret);
}

function assertStrongRuntimeSecret(name: string, value: string | undefined): void {
  if (!value || value.length < 16) {
    throw new Error(
      `${name} must be set to at least 16 characters when NODE_ENV=production or HOST is non-loopback`
    );
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }
  if (normalized === "::1") {
    return true;
  }
  if (isIP(normalized) === 4) {
    return normalized.startsWith("127.");
  }

  return false;
}
