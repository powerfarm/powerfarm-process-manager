import { Client, neon } from "@neondatabase/serverless";
import {
  drizzle as drizzleHttp,
  type NeonHttpDatabase,
} from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import * as schema from "@/lib/db/schema";

let database: NeonHttpDatabase<typeof schema> | null = null;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb() {
  if (!database) {
    const url = process.env.DATABASE_URL?.trim();

    if (!url) {
      throw new Error(
        "DATABASE_URL is required. Add Neon to this Vercel project first."
      );
    }

    database = drizzleHttp({ client: neon(url), schema });
  }

  return database;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export function createTransactionalDatabase(url: string) {
  const client = new Client({ connectionString: url });
  const transactionalDatabase = drizzleServerless({ client, schema });

  return { client, database: transactionalDatabase };
}

export type DatabaseTransaction = Parameters<
  Parameters<
    ReturnType<typeof createTransactionalDatabase>["database"]["transaction"]
  >[0]
>[0];

export async function withDatabaseTransaction<T>(
  work: (transaction: DatabaseTransaction) => Promise<T>
): Promise<T> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Add Neon to this Vercel project first."
    );
  }

  const { client, database: transactionalDatabase } =
    createTransactionalDatabase(url);
  try {
    await client.connect();
    return await transactionalDatabase.transaction(work);
  } finally {
    await client.end();
  }
}

export async function isDatabaseSchemaReady() {
  const url = process.env.DATABASE_URL?.trim();

  if (!url) {
    return false;
  }

  try {
    const sql = neon(url);
    const rows = (await sql`
      select
        to_regclass('public.account') is not null as account_ready,
        to_regclass('public.chat') is not null as chat_ready,
        to_regclass('public.chat_event') is not null as chat_event_ready,
        to_regclass('public.session') is not null as session_ready,
        to_regclass('public."user"') is not null as user_ready,
        to_regclass('public.verification') is not null as verification_ready
    `) as unknown as [
      {
        readonly account_ready: boolean;
        readonly chat_event_ready: boolean;
        readonly chat_ready: boolean;
        readonly session_ready: boolean;
        readonly user_ready: boolean;
        readonly verification_ready: boolean;
      },
    ];
    const result = rows[0];
    const ready = Boolean(
      result?.account_ready &&
        result.chat_ready &&
        result.chat_event_ready &&
        result.session_ready &&
        result.user_ready &&
        result.verification_ready
    );

    return ready;
  } catch {
    return false;
  }
}

export async function isProcessSchemaReady() {
  const url = process.env.DATABASE_URL?.trim();

  if (!url) {
    return false;
  }

  try {
    const sql = neon(url);
    const rows = (await sql`
      select
        to_regclass('public.process') is not null as process_ready,
        to_regclass('public.process_node') is not null as process_node_ready,
        to_regclass('public.process_edge') is not null as process_edge_ready,
        to_regclass('public.process_event') is not null as process_event_ready,
        to_regclass('public.process_projection') is not null as process_projection_ready
    `) as unknown as [
      {
        readonly process_edge_ready: boolean;
        readonly process_event_ready: boolean;
        readonly process_node_ready: boolean;
        readonly process_projection_ready: boolean;
        readonly process_ready: boolean;
      },
    ];
    const result = rows[0];

    return Boolean(
      result?.process_ready &&
        result.process_node_ready &&
        result.process_edge_ready &&
        result.process_event_ready &&
        result.process_projection_ready
    );
  } catch {
    return false;
  }
}
