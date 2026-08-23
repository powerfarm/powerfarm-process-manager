import { Client } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { createTransactionalDatabase } from "@/lib/db/client";

describe("createTransactionalDatabase", () => {
  it("uses Neon's transaction-capable client instead of the HTTP driver", async () => {
    const transactional = createTransactionalDatabase(
      "postgresql://user:password@example.invalid/database"
    );

    expect(transactional.client).toBeInstanceOf(Client);
    expect(transactional.database.transaction).toBeTypeOf("function");
    await transactional.client.end();
  });
});
