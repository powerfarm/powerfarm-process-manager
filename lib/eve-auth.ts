import type { AuthFn } from "eve/channels/auth";
import { auth } from "@/lib/auth";
import { getPasswordSessionFromHeaders } from "@/lib/password-auth";
import { getSetupStatus } from "@/lib/setup";

export const betterAuthEveAuth: AuthFn<Request> = async (request) => {
  const setupStatus = await getSetupStatus();

  if (!setupStatus.appReady || setupStatus.authMode !== "vercel") {
    return null;
  }

  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return null;
  }

  return {
    attributes: {
      email: session.user.email,
      name: session.user.name,
    },
    authenticator: "better-auth",
    issuer: "better-auth",
    principalId: session.user.id,
    principalType: "user",
    subject: session.user.email,
  };
};

export const passwordEveAuth: AuthFn<Request> = async (request) => {
  const setupStatus = await getSetupStatus();

  if (
    !setupStatus.appReady ||
    setupStatus.authMode !== "password" ||
    !getPasswordSessionFromHeaders(request.headers)
  ) {
    return null;
  }

  return {
    attributes: {
      email: "operator@marketing-room.local",
      name: "Marketing operator",
    },
    authenticator: "password",
    issuer: "marketing-room",
    principalId: "marketing-room-user",
    principalType: "user",
    subject: "marketing-room-user",
  };
};
