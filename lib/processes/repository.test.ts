import { afterEach, describe, expect, it } from "vitest";
import { createDrizzleProcessRepository } from "@/lib/processes/repository";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe("createDrizzleProcessRepository", () => {
  it("reports an unavailable store without leaking database configuration", async () => {
    delete process.env.DATABASE_URL;
    const repository = createDrizzleProcessRepository();

    await expect(
      repository.readSnapshot({ ownerId: "owner-1", processId: "process-1" })
    ).rejects.toMatchObject({
      code: "process_store_unavailable",
      message: "Process memory is temporarily unavailable.",
    });
  });
});
