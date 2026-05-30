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
  return {
    host: nonEmpty(env.HOST) ?? "127.0.0.1",
    port: parsePort(env.PORT ?? "3107"),
    provider: nonEmpty(env.INSCHNEIDERGRAM_PROVIDER) ?? "mock",
    storePath: nonEmpty(env.INSCHNEIDERGRAM_STORE_PATH) ?? ".data/campaigns.json",
    webhookSecret: nonEmpty(env.INSCHNEIDERGRAM_WEBHOOK_SECRET),
    apiKey: nonEmpty(env.INSCHNEIDERGRAM_API_KEY),
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
