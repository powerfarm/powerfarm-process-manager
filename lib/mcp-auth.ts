import { createHash, timingSafeEqual } from "node:crypto";
import { type AuthFn, extractBearerToken } from "eve/channels/auth";

/** Credentials that bind the private MCP endpoint to one application user. */
export interface McpUserAuthInput {
  readonly principalId?: string;
  readonly token?: string;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Creates the MCP route authenticator that maps one private bearer credential
 * to the canonical application user who owns process memory.
 */
export function createMcpUserAuth(input: McpUserAuthInput): AuthFn<Request> {
  const principalId = input.principalId?.trim();
  const configuredToken = input.token?.trim();

  if (!(principalId && configuredToken)) {
    return () => null;
  }

  const configuredDigest = digest(configuredToken);

  return (request) => {
    const bearerToken = extractBearerToken(
      request.headers.get("authorization")
    );

    if (
      !(bearerToken && timingSafeEqual(digest(bearerToken), configuredDigest))
    ) {
      return null;
    }

    return {
      attributes: { channel: "mcp" },
      authenticator: "mcp-bearer",
      issuer: "marketing-room",
      principalId,
      principalType: "user",
      subject: principalId,
    };
  };
}

/** Private MCP authentication configured from the deployment environment. */
export const mcpUserAuth = createMcpUserAuth({
  principalId: process.env.EVE_MCP_PRINCIPAL_ID,
  token: process.env.EVE_MCP_BEARER_TOKEN,
});
