import type { z } from "zod";
import {
  type EventCursor,
  eventCursorSchema,
  type GraphCursor,
  graphCursorSchema,
} from "@/lib/processes/contracts";

function encodeCursor<T>(schema: z.ZodType<T>, value: T): string {
  const validated = schema.parse(value);
  return Buffer.from(JSON.stringify(validated), "utf8").toString("base64url");
}

function decodeCursor<T>(schema: z.ZodType<T>, cursor: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new TypeError("Invalid process cursor");
  }
  return schema.parse(parsed);
}

export const encodeGraphCursor = (cursor: GraphCursor): string =>
  encodeCursor(graphCursorSchema, cursor);

export const decodeGraphCursor = (cursor: string): GraphCursor =>
  decodeCursor(graphCursorSchema, cursor);

export const encodeEventCursor = (cursor: EventCursor): string =>
  encodeCursor(eventCursorSchema, cursor);

export const decodeEventCursor = (cursor: string): EventCursor =>
  decodeCursor(eventCursorSchema, cursor);
