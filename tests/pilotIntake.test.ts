import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPilotIntakeKit,
  defaultPilotIntakePaths,
  loadPilotIntakeKit
} from "../scripts/validate-pilot-intake.js";
import {
  loadProviderBridgeFixture,
  providerBridgePath
} from "../scripts/managed-provider-bridge-rehearsal.js";

const afterStaticFixtureExpiry = new Date("2026-07-01T12:00:00.000Z");
const refreshedExpiry = "2026-07-08T12:00:00.000Z";

describe("pilot intake example fixtures", () => {
  it("refreshes the bundled public intake authorization window at runtime", async () => {
    const kit = await loadPilotIntakeKit(defaultPilotIntakePaths, {
      now: afterStaticFixtureExpiry
    });

    expect(kit.launchAuthorization).toMatchObject({
      deliveryPath: "manual",
      approvedAt: afterStaticFixtureExpiry.toISOString(),
      expiresAt: refreshedExpiry
    });
    expect(() =>
      assertPilotIntakeKit(kit, { now: afterStaticFixtureExpiry })
    ).not.toThrow();
  });

  it("does not refresh custom authorization files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inschneidergram-intake-"));
    try {
      const authorizationPath = join(dir, "authorization.json");
      await writeFile(
        authorizationPath,
        JSON.stringify(
          {
            actor: "Custom approver",
            deliveryPath: "manual",
            approvedTargetLimit: 3,
            approvedAt: "2026-05-30T09:00:00.000Z",
            expiresAt: "2026-06-06T09:00:00.000Z",
            reference: "custom-expired-approval",
            evidenceUrl: "https://docs.example.com/private-approval-ticket"
          },
          null,
          2
        )
      );

      const kit = await loadPilotIntakeKit(
        {
          ...defaultPilotIntakePaths,
          authorization: authorizationPath
        },
        { now: afterStaticFixtureExpiry }
      );

      expect(kit.launchAuthorization.expiresAt).toBe("2026-06-06T09:00:00.000Z");
      expect(() => assertPilotIntakeKit(kit, { now: afterStaticFixtureExpiry })).toThrow(
        /Launch authorization expired/
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refreshes the bundled managed-provider bridge authorization window", async () => {
    const fixture = await loadProviderBridgeFixture(providerBridgePath, {
      now: afterStaticFixtureExpiry
    });

    expect(fixture.launchAuthorization).toMatchObject({
      deliveryPath: "managed_provider",
      approvedAt: afterStaticFixtureExpiry.toISOString(),
      expiresAt: refreshedExpiry
    });
  });
});
