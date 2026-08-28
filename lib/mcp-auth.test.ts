import { describe, expect, it } from "vitest";
import { createMcpUserAuth } from "@/lib/mcp-auth";

const authenticate = (token?: string, principalId?: string) =>
  createMcpUserAuth({ principalId, token });

const requestWithAuthorization = (authorization?: string) =>
  new Request("https://marketing-room.example/eve/v1/mcp", {
    headers: authorization ? { authorization } : undefined,
    method: "POST",
  });

describe("createMcpUserAuth", () => {
  it.each([
    { principalId: "marketing-room-user", token: undefined },
    { principalId: undefined, token: "secret-token" },
    { principalId: "marketing-room-user", token: "" },
  ])("fails closed when credentials are incomplete", async (credentials) => {
    const auth = authenticate(credentials.token, credentials.principalId);

    expect(
      await auth(requestWithAuthorization("Bearer secret-token"))
    ).toBeNull();
  });

  it.each([
    undefined,
    "Basic ZGFuOnNlY3JldA==",
    "Bearer wrong-token",
    "Bearer",
  ])(
    "rejects a missing or invalid bearer credential",
    async (authorization) => {
      const auth = authenticate("secret-token", "marketing-room-user");

      expect(await auth(requestWithAuthorization(authorization))).toBeNull();
    }
  );

  it("maps a valid bearer credential to the canonical process owner", async () => {
    const auth = authenticate("secret-token", "process-owner-123");

    expect(await auth(requestWithAuthorization("Bearer secret-token"))).toEqual(
      {
        attributes: { channel: "mcp" },
        authenticator: "mcp-bearer",
        issuer: "marketing-room",
        principalId: "process-owner-123",
        principalType: "user",
        subject: "process-owner-123",
      }
    );
  });

  it("does not accept caller-supplied identity headers", async () => {
    const auth = authenticate("secret-token", "canonical-owner");
    const request = new Request("https://marketing-room.example/eve/v1/mcp", {
      headers: {
        authorization: "Bearer secret-token",
        "x-principal-id": "attacker-controlled-owner",
      },
      method: "POST",
    });

    const result = await auth(request);

    expect(result).toMatchObject({ principalId: "canonical-owner" });
  });
});
