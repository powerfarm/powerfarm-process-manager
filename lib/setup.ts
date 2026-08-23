import type { SetupStatus } from "@/lib/chat/types";
import {
  isDatabaseConfigured,
  isDatabaseSchemaReady,
  isProcessSchemaReady,
} from "@/lib/db/client";

const PASSWORD_ENV_KEY = "EVE_CHAT_PASSWORD";
const AUTH_ENV_KEYS = [
  "BETTER_AUTH_SECRET",
  "NEXT_PUBLIC_VERCEL_APP_CLIENT_ID",
  "VERCEL_APP_CLIENT_SECRET",
] as const;

const CONNECTION_ENV_KEYS = ["NOTION_CONNECTOR", "RESEND_CONNECTOR"] as const;

const RATE_LIMIT_ENV_GROUPS = [
  ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
] as const;

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim());
}

export function isAuthConfigured() {
  return AUTH_ENV_KEYS.every(hasEnv);
}

export function isPasswordConfigured() {
  return Boolean(process.env.EVE_CHAT_PASSWORD?.trim());
}

export function isRateLimitConfigured() {
  return RATE_LIMIT_ENV_GROUPS.some((group) => group.every(hasEnv));
}

export function getInitialSetupStatus(): SetupStatus {
  const databaseConfigured = isDatabaseConfigured();
  return computeSetupStatus({
    connectionsAvailable:
      isLocalDevelopment() || CONNECTION_ENV_KEYS.some(hasEnv),
    databaseConfigured,
    databaseSchemaReady: isDatabaseConfigured(),
    localDevelopment: isLocalDevelopment(),
    passwordReady: isPasswordConfigured(),
    processSchemaReady: databaseConfigured,
    rateLimitReady: isRateLimitConfigured(),
    vercelAuthReady: isAuthConfigured(),
  });
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const databaseConfigured = isDatabaseConfigured();
  const fullEnvironmentReady =
    databaseConfigured && isAuthConfigured() && isRateLimitConfigured();
  const [databaseSchemaReady, processSchemaReady] = await Promise.all([
    fullEnvironmentReady ? isDatabaseSchemaReady() : Promise.resolve(false),
    databaseConfigured ? isProcessSchemaReady() : Promise.resolve(false),
  ]);

  return computeSetupStatus({
    connectionsAvailable:
      isLocalDevelopment() || CONNECTION_ENV_KEYS.some(hasEnv),
    databaseConfigured,
    databaseSchemaReady,
    localDevelopment: isLocalDevelopment(),
    passwordReady: isPasswordConfigured(),
    processSchemaReady,
    rateLimitReady: isRateLimitConfigured(),
    vercelAuthReady: isAuthConfigured(),
  });
}

export async function isAppConfigured() {
  const status = await getSetupStatus();

  return status.appReady;
}

export function computeSetupStatus({
  connectionsAvailable,
  databaseConfigured,
  databaseSchemaReady,
  localDevelopment,
  passwordReady,
  processSchemaReady,
  rateLimitReady,
  vercelAuthReady,
}: {
  readonly connectionsAvailable: boolean;
  readonly databaseConfigured: boolean;
  readonly databaseSchemaReady: boolean;
  readonly localDevelopment: boolean;
  readonly passwordReady: boolean;
  readonly processSchemaReady: boolean;
  readonly rateLimitReady: boolean;
  readonly vercelAuthReady: boolean;
}): SetupStatus {
  const databaseReady = databaseConfigured && databaseSchemaReady;
  const processStoreReady = databaseConfigured && processSchemaReady;
  const fullEnvironmentReady =
    databaseConfigured && vercelAuthReady && rateLimitReady;

  if (fullEnvironmentReady) {
    return {
      appReady: databaseReady,
      authMode: "vercel",
      authReady: vercelAuthReady,
      connectionsAvailable,
      databaseConfigured,
      databaseReady,
      databaseSchemaReady,
      missing: databaseSchemaReady ? [] : ["database migrations"],
      processStoreReady,
      rateLimitReady,
      storageMode: "database",
    };
  }

  if (passwordReady || localDevelopment) {
    return {
      appReady: true,
      authMode: passwordReady ? "password" : "local-dev",
      authReady: true,
      connectionsAvailable,
      databaseConfigured,
      databaseReady,
      databaseSchemaReady,
      missing: [],
      processStoreReady,
      rateLimitReady,
      storageMode: "browser",
    };
  }

  return {
    appReady: false,
    authMode: "unconfigured",
    authReady: false,
    connectionsAvailable,
    databaseConfigured,
    databaseReady,
    databaseSchemaReady,
    missing: [
      PASSWORD_ENV_KEY,
      "or DATABASE_URL, Better Auth/Vercel OAuth, and Upstash configuration",
    ],
    processStoreReady,
    rateLimitReady,
    storageMode: "browser",
  };
}

function isLocalDevelopment() {
  return process.env.NODE_ENV === "development" && process.env.VERCEL !== "1";
}
