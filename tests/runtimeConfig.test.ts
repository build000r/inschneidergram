import { readRuntimeConfig } from "../src/runtimeConfig.js";

describe("runtime config", () => {
  it("uses conservative local defaults", () => {
    expect(readRuntimeConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3107,
      provider: "mock",
      storePath: ".data/campaigns.json",
      webhookSecret: undefined,
      apiKey: undefined,
      webhookAllowedHosts: []
    });
  });

  it("reads service runtime environment overrides", () => {
    expect(
      readRuntimeConfig({
        HOST: "0.0.0.0",
        PORT: "4107",
        INSCHNEIDERGRAM_PROVIDER: "managed",
        INSCHNEIDERGRAM_STORE_PATH: "/data/campaigns.json",
        INSCHNEIDERGRAM_WEBHOOK_SECRET: "service-webhook-secret",
        INSCHNEIDERGRAM_API_KEY: "service-api-key-long",
        INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS:
          "hooks.graphed.test, *.tenant-hooks.graphed.test"
      })
    ).toEqual({
      host: "0.0.0.0",
      port: 4107,
      provider: "managed",
      storePath: "/data/campaigns.json",
      webhookSecret: "service-webhook-secret",
      apiKey: "service-api-key-long",
      webhookAllowedHosts: ["hooks.graphed.test", "*.tenant-hooks.graphed.test"]
    });
  });

  it("requires strong secrets for non-loopback hosts", () => {
    expect(() => readRuntimeConfig({ HOST: "0.0.0.0" })).toThrow(
      "INSCHNEIDERGRAM_API_KEY must be set"
    );
    expect(() =>
      readRuntimeConfig({
        HOST: "0.0.0.0",
        INSCHNEIDERGRAM_API_KEY: "short",
        INSCHNEIDERGRAM_WEBHOOK_SECRET: "service-webhook-secret"
      })
    ).toThrow("INSCHNEIDERGRAM_API_KEY must be set to at least 16 characters");
    expect(() =>
      readRuntimeConfig({
        HOST: "0.0.0.0",
        INSCHNEIDERGRAM_API_KEY: "service-api-key-long"
      })
    ).toThrow("INSCHNEIDERGRAM_WEBHOOK_SECRET must be set");
  });

  it("requires strong secrets in production even on loopback", () => {
    expect(() => readRuntimeConfig({ NODE_ENV: "production" })).toThrow(
      "INSCHNEIDERGRAM_API_KEY must be set"
    );
  });

  it.each(["abc", "3107abc", "0", "65536", "-1", ""])(
    "rejects invalid PORT %j",
    (port) => {
      expect(() => readRuntimeConfig({ PORT: port })).toThrow(
        "PORT must be an integer between 1 and 65535"
      );
    }
  );
});
