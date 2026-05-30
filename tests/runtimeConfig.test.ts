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
        INSCHNEIDERGRAM_WEBHOOK_SECRET: "secret",
        INSCHNEIDERGRAM_API_KEY: "service-api-key",
        INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS:
          "hooks.graphed.test, *.tenant-hooks.graphed.test"
      })
    ).toEqual({
      host: "0.0.0.0",
      port: 4107,
      provider: "managed",
      storePath: "/data/campaigns.json",
      webhookSecret: "secret",
      apiKey: "service-api-key",
      webhookAllowedHosts: ["hooks.graphed.test", "*.tenant-hooks.graphed.test"]
    });
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
