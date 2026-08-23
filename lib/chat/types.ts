import type { ClientSessionState, MessageStreamEvent } from "eve/client";

export interface Viewer {
  readonly email: string;
  readonly id: string;
  readonly image: string | null;
  readonly name: string;
}

export type AuthMode = "local-dev" | "password" | "unconfigured" | "vercel";
export type StorageMode = "browser" | "database";

export interface ChatListItem {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface ChatListPage {
  readonly items: readonly ChatListItem[];
  readonly nextCursor: string | null;
}

export interface ActiveChat {
  readonly events: readonly MessageStreamEvent[];
  readonly id: string;
  readonly pendingUserMessage: string | null;
  readonly session: ClientSessionState | undefined;
  readonly title: string;
}

export interface SetupStatus {
  readonly appReady: boolean;
  readonly authMode: AuthMode;
  readonly authReady: boolean;
  readonly connectionsAvailable: boolean;
  readonly databaseConfigured: boolean;
  readonly databaseReady: boolean;
  readonly databaseSchemaReady: boolean;
  readonly missing: readonly string[];
  readonly processStoreReady: boolean;
  readonly rateLimitReady: boolean;
  readonly storageMode: StorageMode;
}
