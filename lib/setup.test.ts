import { describe, expect, it } from "vitest";
import { computeSetupStatus } from "@/lib/setup";

const readyCapabilities = {
  connectionsAvailable: true,
  databaseConfigured: true,
  databaseSchemaReady: true,
  localDevelopment: false,
  passwordReady: false,
  processSchemaReady: true,
  rateLimitReady: true,
  vercelAuthReady: true,
} as const;

describe("computeSetupStatus", () => {
  it("keeps password auth and browser chat storage while enabling the process store", () => {
    const status = computeSetupStatus({
      ...readyCapabilities,
      passwordReady: true,
      rateLimitReady: false,
      vercelAuthReady: false,
    });

    expect(status.authMode).toBe("password");
    expect(status.storageMode).toBe("browser");
    expect(status.processStoreReady).toBe(true);
    expect(status.appReady).toBe(true);
  });

  it("does not report the process store ready without a database", () => {
    const status = computeSetupStatus({
      ...readyCapabilities,
      databaseConfigured: false,
      databaseSchemaReady: false,
      passwordReady: true,
      processSchemaReady: false,
    });

    expect(status.processStoreReady).toBe(false);
    expect(status.storageMode).toBe("browser");
  });

  it("keeps full Vercel mode dependent on auth, rate limiting, and chat schema", () => {
    const missingRateLimit = computeSetupStatus({
      ...readyCapabilities,
      rateLimitReady: false,
    });
    const migrated = computeSetupStatus(readyCapabilities);

    expect(missingRateLimit.authMode).toBe("unconfigured");
    expect(missingRateLimit.storageMode).toBe("browser");
    expect(migrated.authMode).toBe("vercel");
    expect(migrated.storageMode).toBe("database");
    expect(migrated.appReady).toBe(true);
  });

  it("reports a configured database whose process migration is missing", () => {
    const status = computeSetupStatus({
      ...readyCapabilities,
      passwordReady: true,
      processSchemaReady: false,
      rateLimitReady: false,
      vercelAuthReady: false,
    });

    expect(status.databaseConfigured).toBe(true);
    expect(status.processStoreReady).toBe(false);
    expect(status.appReady).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it("keeps local development in browser mode with process memory when migrated", () => {
    const status = computeSetupStatus({
      ...readyCapabilities,
      localDevelopment: true,
      rateLimitReady: false,
      vercelAuthReady: false,
    });

    expect(status.authMode).toBe("local-dev");
    expect(status.storageMode).toBe("browser");
    expect(status.processStoreReady).toBe(true);
  });
});
