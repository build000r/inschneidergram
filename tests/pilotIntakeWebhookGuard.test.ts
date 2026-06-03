import { describe, expect, it } from "vitest";
import {
  assertPilotIntakeKit,
  defaultPilotIntakePaths,
  loadPilotIntakeKit,
  parsePilotIntakeArgs,
  type PilotIntakeKit
} from "../scripts/validate-pilot-intake.js";

// These tests harden the live-pilot intake webhook destination guard
// (validateWebhookDestination -> isBlockedIpHost / isAllowedHost) and the
// CLI argument parser. The guard is a security boundary: the pilot-intake
// proof gate must refuse to ship a callback URL that points at a private,
// loopback, link-local, CGNAT, special-use, or multicast address, or at a
// host outside the configured allowlist. All assertions drive the exported
// public API only.

const validNow = new Date("2026-06-15T12:00:00.000Z");

const VALIDATION_FAILED_PREFIX = "Pilot intake validation failed:";
const BLOCKED_IP_MESSAGE =
  "webhook callbackUrl must not use a private, loopback, or special-use IP.";

async function baseKit(): Promise<PilotIntakeKit> {
  // Load the bundled, known-valid example kit, refreshing the example
  // authorization window so freshness checks pass at `validNow`.
  const kit = await loadPilotIntakeKit(defaultPilotIntakePaths, {
    now: validNow,
    refreshDefaultExampleAuthorization: true
  });
  // structuredClone so per-test mutations never leak between cases.
  return structuredClone(kit);
}

/**
 * Point the kit's callback at `host`, mirror it onto the campaign settings
 * (the validator requires settings.webhookUrl === webhook.callbackUrl), and
 * add `host` to the allowlist so an allowlist failure cannot mask the IP
 * guard signal we are actually testing.
 */
function withCallbackHost(kit: PilotIntakeKit, host: string): PilotIntakeKit {
  const url = `https://${host}/webhooks/pilot`;
  const next = structuredClone(kit);
  next.webhook.callbackUrl = url;
  next.webhook.allowedHosts = [host];
  next.campaignInput.settings.webhookUrl = url;
  return next;
}

function collectError(kit: PilotIntakeKit): string {
  try {
    assertPilotIntakeKit(kit, { now: validNow });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected assertPilotIntakeKit to throw, but it passed");
}

describe("pilot intake webhook destination guard - blocked IPv4 ranges", () => {
  const blocked: Array<[string, string]> = [
    ["this-network 0.0.0.0", "0.0.0.0"],
    ["private 10.x", "10.4.5.6"],
    ["loopback 127.x", "127.0.0.1"],
    ["CGNAT 100.64-127 low edge", "100.64.0.1"],
    ["CGNAT 100.64-127 high edge", "100.127.255.254"],
    ["link-local 169.254", "169.254.169.254"],
    ["private 172.16-31 low edge", "172.16.0.1"],
    ["private 172.16-31 high edge", "172.31.255.254"],
    ["IETF protocol 192.0.0", "192.0.0.9"],
    ["private 192.168", "192.168.1.1"],
    ["benchmark 198.18", "198.18.0.1"],
    ["benchmark 198.19", "198.19.0.1"],
    ["TEST-NET-2 198.51.100", "198.51.100.7"],
    ["TEST-NET-3 203.0.113", "203.0.113.7"],
    ["multicast 224+", "239.0.0.1"],
    ["reserved 240+", "255.255.255.255"]
  ];

  it.each(blocked)("rejects %s (%s)", async (_label, host) => {
    const message = collectError(withCallbackHost(await baseKit(), host));
    expect(message).toContain(VALIDATION_FAILED_PREFIX);
    expect(message).toContain(BLOCKED_IP_MESSAGE);
  });
});

describe("pilot intake webhook destination guard - blocked IPv6 ranges", () => {
  const blocked: Array<[string, string]> = [
    ["unspecified ::", "[::]"],
    ["loopback ::1", "[::1]"],
    ["IPv4-mapped ::ffff:", "[::ffff:10.0.0.1]"],
    ["unique-local fc", "[fc00::1]"],
    ["unique-local fd", "[fd12:3456::1]"],
    ["link-local fe80", "[fe80::1]"],
    // Regression: the proof-gate validator previously omitted the `ff`
    // multicast prefix that the runtime server guard already blocked, so the
    // intake gate could clear an IPv6 multicast callback the server would
    // reject. The validator must match the runtime guard for ff00::/8.
    ["multicast ff02", "[ff02::1]"],
    ["multicast ff05", "[ff05::1:3]"]
  ];

  it.each(blocked)("rejects %s (%s)", async (_label, host) => {
    const message = collectError(withCallbackHost(await baseKit(), host));
    expect(message).toContain(BLOCKED_IP_MESSAGE);
  });
});

describe("pilot intake webhook destination guard - protocol and host shape", () => {
  it("rejects a non-https callback URL", async () => {
    const kit = structuredClone(await baseKit());
    const url = "http://hooks.graphed.com/webhooks/pilot";
    kit.webhook.callbackUrl = url;
    kit.webhook.allowedHosts = ["hooks.graphed.com"];
    kit.campaignInput.settings.webhookUrl = url;
    const message = collectError(kit);
    expect(message).toContain("webhook callbackUrl must use https.");
  });

  it("rejects a localhost callback host", async () => {
    const message = collectError(withCallbackHost(await baseKit(), "localhost"));
    expect(message).toContain("webhook callbackUrl must not use localhost.");
  });

  it("rejects a *.localhost callback host", async () => {
    const message = collectError(
      withCallbackHost(await baseKit(), "api.localhost")
    );
    expect(message).toContain("webhook callbackUrl must not use localhost.");
  });

  it("rejects a callback host outside the configured allowlist", async () => {
    const kit = structuredClone(await baseKit());
    const url = "https://evil.attacker.example/webhooks/pilot";
    kit.webhook.callbackUrl = url;
    kit.webhook.allowedHosts = ["hooks.graphed.com"];
    kit.campaignInput.settings.webhookUrl = url;
    const message = collectError(kit);
    expect(message).toContain(
      "webhook callbackUrl host must be present in allowedHosts."
    );
  });
});

describe("pilot intake webhook destination guard - allowed public hosts", () => {
  it("accepts a public host that is exactly allowlisted", async () => {
    // The bundled default kit already uses an exact-match allowlist entry.
    const kit = await baseKit();
    expect(() => assertPilotIntakeKit(kit, { now: validNow })).not.toThrow();
  });

  it("accepts a public subdomain when a wildcard allowlist entry matches", async () => {
    const kit = structuredClone(await baseKit());
    const url = "https://client-a.tenant-hooks.graphed.com/events";
    kit.webhook.callbackUrl = url;
    kit.webhook.allowedHosts = ["*.tenant-hooks.graphed.com"];
    kit.campaignInput.settings.webhookUrl = url;
    expect(() => assertPilotIntakeKit(kit, { now: validNow })).not.toThrow();
  });

  it("does not let a wildcard allowlist entry match the bare apex", async () => {
    const kit = structuredClone(await baseKit());
    const url = "https://tenant-hooks.graphed.com/events";
    kit.webhook.callbackUrl = url;
    kit.webhook.allowedHosts = ["*.tenant-hooks.graphed.com"];
    kit.campaignInput.settings.webhookUrl = url;
    const message = collectError(kit);
    expect(message).toContain(
      "webhook callbackUrl host must be present in allowedHosts."
    );
  });

  it("treats a public, non-special-use IPv4 host as not blocked", async () => {
    // 8.8.8.8 is a real public address - the IP guard must not block it.
    // withCallbackHost adds the host to the allowlist, so with the IP guard
    // passing and the allowlist satisfied the whole kit should validate.
    const kit = withCallbackHost(await baseKit(), "8.8.8.8");
    expect(() => assertPilotIntakeKit(kit, { now: validNow })).not.toThrow();
  });
});

describe("parsePilotIntakeArgs", () => {
  it("returns the default paths when no arguments are passed", () => {
    expect(parsePilotIntakeArgs([])).toEqual(defaultPilotIntakePaths);
  });

  it("overrides each path key from its flag", () => {
    const paths = parsePilotIntakeArgs([
      "--campaign",
      "c.json",
      "--senders",
      "s.json",
      "--authorization",
      "a.json",
      "--webhook",
      "w.json"
    ]);
    expect(paths).toEqual({
      campaign: "c.json",
      senders: "s.json",
      authorization: "a.json",
      webhook: "w.json"
    });
  });

  it("throws on an unknown option", () => {
    expect(() => parsePilotIntakeArgs(["--mystery", "x"])).toThrow(
      /Unknown option: --mystery/
    );
  });

  it("throws on a positional argument that is not a flag", () => {
    expect(() => parsePilotIntakeArgs(["campaign.json"])).toThrow(
      /Unexpected argument: campaign\.json/
    );
  });

  it("throws when a flag is missing its value at end of argv", () => {
    expect(() => parsePilotIntakeArgs(["--campaign"])).toThrow(
      /Missing value for --campaign/
    );
  });

  it("throws when a flag value looks like another flag", () => {
    expect(() => parsePilotIntakeArgs(["--campaign", "--senders"])).toThrow(
      /Missing value for --campaign/
    );
  });
});
